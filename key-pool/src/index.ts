/**
 * Hono 后端入口
 * 路由：/auth, /channels, /aggregate-keys, /stats, /health, /v1
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { ulid } from "ulid";

import { Bindings, Variables } from "./types";
import { createDb } from "./db";
import { setEncryptionSecret, decryptKey } from "./lib/password";
import {
  isCloudflareAigChannel,
  getAigProviderSegment,
  buildAigChatCompletionsUrl,
  buildAigHeaders,
} from "./lib/ai-gateway";
import { BusinessError } from "./lib/response";
import { stripTrailingV1 } from "./lib/url";

// 创建 Hono 实例
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// === 全局中间件 ===

// 跨域支持
app.use("*", cors());

// 日志记录
app.use("*", logger());

// 美化 JSON 输出
app.use("*", prettyJSON());

// 初始化 Context 变量 + 首次部署时自动建超级管理员
app.use("*", async (c, next) => {
  c.set("requestId", ulid());
  const db = createDb(c.env.DB);
  c.set("db", db);
  setEncryptionSecret(c.env.KEY_ENCRYPTION_KEY);
  await next();
});

// === 启动钩子：自动初始化超级管理员（仅在数据库为空时）===
let initPromise: Promise<void> | null = null;
async function ensureAdminInitialized(env: Bindings): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const db = createDb(env.DB);
      const { users } = await import("./db/schema");
      const { eq } = await import("drizzle-orm");
      const { hashPassword } = await import("./lib/password");
      
      // 检查是否已有任何用户
      const existing = await db.select().from(users).limit(1);
      if (existing.length > 0) {
        console.log("[Init] Users already exist, skipping admin initialization");
        return;
      }
      
      // 用 .dev.vars 里的 ADMIN_INIT_USERNAME + ADMIN_INIT_PASSWORD 创建超级管理员
      const username = env.ADMIN_INIT_USERNAME || "admin";
      const password = env.ADMIN_INIT_PASSWORD || "Admin@123456";
      const id = `u_admin_${Date.now().toString(36)}`;
      
      await db.insert(users).values({
        id,
        username,
        passwordHash: await hashPassword(password),
        role: "admin",
        displayName: "超级管理员",
        status: "active",
      });
      
      console.log(`[Init] ✅ Created initial admin user: ${username}`);
    } catch (err) {
      // 关键修复：初始化失败时重置 Promise，避免一次失败被永久缓存后
      // 导致整个 Worker 在温暖实例上永远返回 500；同时把真实错误抛出，
      // 让首次部署时“表不存在 / 绑定缺失”等问题能被直接看到，而不是被静默吞掉。
      console.error("[Init] Failed to initialize admin:", err);
      initPromise = null;
      throw err;
    }
  })();
  return initPromise;
}

// === 根路径 ===
app.get("/", (c) => {
  return c.json({
    name: "密钥池中转站 / Key Pool",
    version: "1.0.0",
    description: "聚合多厂商 API Key 的统一接口服务",
    endpoints: {
      auth: "/auth",
      channels: "/channels",
      aggregateKeys: "/aggregate-keys",
      stats: "/stats",
      health: "/health/states",
      playground: "/playground",
      v1: "/v1/chat/completions, /v1/models",
    },
  });
});

// 健康检查
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    requestId: c.get("requestId"),
    time: new Date().toISOString(),
  });
});

// === 路由注册 ===

// 动态导入路由以加快冷启动
import { authRouter } from "./routes/auth";
import { channelRouter } from "./routes/channels";
import { aggregateKeyRouter } from "./routes/aggregate-keys";
import { statsRouter } from "./routes/stats";
import { healthRouter } from "./routes/health";
import { playgroundRouter } from "./routes/playground";
import { relayRouter } from "./routes/relay";

app.route("/auth", authRouter);
app.route("/channels", channelRouter);
app.route("/aggregate-keys", aggregateKeyRouter);
app.route("/stats", statsRouter);
app.route("/health", healthRouter);
app.route("/playground", playgroundRouter);
app.route("/", relayRouter); // 包含 /v1/...

// === 错误处理 ===

app.onError((err, c) => {
  console.error(`[Error] Request ID: ${c.get("requestId")}`, err);
  
  if (err instanceof BusinessError) {
    return c.json({
      error: {
        message: err.message,
        type: err.errorType,
        request_id: c.get("requestId"),
      }
    }, err.statusCode as any);
  }
  
  if (err instanceof Error) {
    return c.json({
      error: {
        message: err.message,
        type: "internal_error",
        request_id: c.get("requestId")
      }
    }, 500);
  }
  
  return c.json({
    error: {
      message: "An unexpected error occurred",
      type: "internal_error",
      request_id: c.get("requestId")
    }
  }, 500);
});

app.notFound((c) => {
  return c.json({
    error: {
      message: "Resource not found",
      type: "invalid_request_error",
      request_id: c.get("requestId")
    }
  }, 404);
});

// === Workers 导出 ===
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    // 首次请求时自动初始化超级管理员（后续请求命中缓存）
    await ensureAdminInitialized(env);
    return app.fetch(request, env, ctx);
  },
  
  // Cloudflare Cron Triggers 处理器
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    console.log(`[Cron] Running scheduled task: ${event.cron}`);
    
    ctx.waitUntil((async () => {
      const db = createDb(env.DB);
      
      try {
        // 1. 对所有 disabled 状态的组合做轻量探测
        const { channels, channelKeys, channelModels } = await import("./db/schema");
        const { HealthService } = await import("./services/health.service");
        const { decryptKey } = await import("./lib/password");
        const { eq, and } = await import("drizzle-orm");
        
        const healthService = new HealthService(db, env.HEALTH_KV, env);
        const allStates = await healthService.listAllStates();
        const disabled = allStates.filter((s) => s.state.status === "disabled");
        
        console.log(`[Cron] Found ${disabled.length} disabled combinations to probe`);
        
        for (const s of disabled) {
          try {
            const [key] = await db.select().from(channelKeys).where(eq(channelKeys.id, s.keyId)).limit(1);
            const [model] = await db.select().from(channelModels).where(and(
              eq(channelModels.channelId, s.channelId),
              eq(channelModels.aliasName, s.modelAlias)
            )).limit(1);
            const [channel] = await db.select().from(channels).where(eq(channels.id, s.channelId)).limit(1);
            
            if (!key || !model || !channel) continue;
            
            const decryptedKey = await decryptKey(key.keyValue);
            const decryptedAigToken = key.aigToken ? await decryptKey(key.aigToken) : "";
            const realModel = `${model.prefix || ""}${model.realModel}${model.suffix || ""}`;
            const timeoutMs = channel.timeoutMs || 15000;

            let url: string;
            let requestHeaders: Record<string, string>;

            if (
              isCloudflareAigChannel(channel.type) &&
              channel.cfAccountId &&
              channel.cfGatewayId &&
              decryptedAigToken
            ) {
              const providerSegment = getAigProviderSegment(channel.type);
              url = buildAigChatCompletionsUrl(channel.cfAccountId, channel.cfGatewayId, providerSegment || "");
              requestHeaders = buildAigHeaders({
                providerKey: decryptedKey || undefined,
                cfAigToken: decryptedAigToken,
                byokMode: !!key.byokMode,
              });
            } else {
              url = `${stripTrailingV1(channel.baseUrl)}/v1/chat/completions`;
              requestHeaders = {
                "Authorization": `Bearer ${decryptedKey}`,
                "Content-Type": "application/json",
              };
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: requestHeaders,
                body: JSON.stringify({
                  model: realModel,
                  messages: [{ role: "user", content: "ping" }],
                  max_tokens: 1,
                }),
                signal: controller.signal,
              });
              
              if (res.ok) {
                await healthService.reset(s.channelId, s.keyId, s.modelAlias);
                console.log(`[Cron] Recovered: ${s.channelName} / ${s.keyMasked} / ${s.modelAlias}`);
              } else {
                console.log(`[Cron] Still disabled: ${s.channelName} / ${s.keyMasked} / ${s.modelAlias} (${res.status})`);
              }
            } catch (err) {
              console.log(`[Cron] Probe failed: ${s.channelName} / ${s.modelAlias}: ${err}`);
            } finally {
              clearTimeout(timeoutId);
            }
          } catch (err) {
            console.error(`[Cron] Error processing ${s.channelId}:${s.keyId}:${s.modelAlias}:`, err);
          }
        }
        
        console.log(`[Cron] Health check complete`);
      } catch (err) {
        console.error("[Cron] Fatal error:", err);
      }
    })());
  },
};
