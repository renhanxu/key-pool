/**
 * 测试台（Playground）路由
 * 选择密钥+模型，发起测试请求，支持流式
 */

import { Hono } from "hono";
import { z } from "zod";
import { Bindings, Variables } from "../types";
import { requireAuth } from "../middleware/auth";
import { HealthService } from "../services/health.service";
import { decryptKey } from "../lib/password";
import { stripTrailingV1 } from "../lib/url";
import {
  isCloudflareAigChannel,
  getAigProviderSegment,
  buildAigChatCompletionsUrl,
  buildAigHeaders,
} from "../lib/ai-gateway";
import { ok, NotFoundError, BusinessError } from "../lib/response";
import { channels, channelKeys, channelModels, channelHealthState } from "../db/schema";
import { eq, and } from "drizzle-orm";

export const playgroundRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// === 测试请求（不走聚合密钥，直接用渠道 key 测试）===
playgroundRouter.post("/test", requireAuth, async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    channelId: z.string().min(1),
    modelAlias: z.string().min(1),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).min(1),
    stream: z.boolean().optional().default(false),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).optional(),
  });
  
  const input = schema.parse(body);
  const db = c.get("db");
  
  // 1. 获取渠道
  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);
  
  if (!channel) throw new NotFoundError("Channel not found", c.get("requestId"));
  
  // 2. 获取模型映射
  const [model] = await db
    .select()
    .from(channelModels)
    .where(and(
      eq(channelModels.channelId, input.channelId),
      eq(channelModels.aliasName, input.modelAlias)
    ))
    .limit(1);
  
  if (!model) throw new NotFoundError("Model not found in channel", c.get("requestId"));
  
  // 3. 选择第一个可用的 Key
  const keys = await db
    .select()
    .from(channelKeys)
    .where(and(
      eq(channelKeys.channelId, input.channelId),
      eq(channelKeys.status, "enabled")
    ));
  
  if (keys.length === 0) throw new BusinessError("No enabled keys", 400, "validation_error", c.get("requestId"));
  
  // 优先选择 healthy 的 key
  const healthService = new HealthService(db, c.env.HEALTH_KV, c.env);
  let selectedKey = null;
  for (const k of keys) {
    const state = await healthService.getState(channel.id, k.id, input.modelAlias);
    if (state.status === "healthy") {
      selectedKey = k;
      break;
    }
  }
  if (!selectedKey) selectedKey = keys[0]; // fallback 到第一个
  
  // 4. 构造请求（支持 Cloudflare AI Gateway 模式）
  const decryptedKey = await decryptKey(selectedKey.keyValue);
  const decryptedAigToken = selectedKey.aigToken ? await decryptKey(selectedKey.aigToken) : "";
  const customHeaders = channel.customHeaders ? JSON.parse(channel.customHeaders) : {};
  const realModel = `${model.prefix || ""}${model.realModel}${model.suffix || ""}`;

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
      byokMode: !!selectedKey.byokMode,
      extraHeaders: customHeaders,
    });
  } else {
    url = `${stripTrailingV1(channel.baseUrl)}/v1/chat/completions`;
    requestHeaders = {
      "Authorization": `Bearer ${decryptedKey}`,
      "Content-Type": "application/json",
      ...customHeaders,
    };
  }
  
  const requestBody: any = {
    model: realModel,
    messages: input.messages,
    stream: input.stream,
  };
  if (input.temperature !== undefined) requestBody.temperature = input.temperature;
  if (input.maxTokens !== undefined) requestBody.max_tokens = input.maxTokens;
  
  const timeoutMs = channel.timeoutMs || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (!res.ok) {
      const text = await res.text();
      return c.json({
        success: false,
        error: {
          statusCode: res.status,
          message: text.slice(0, 500),
        },
        latencyMs,
        usedKeyMasked: selectedKey.keyMasked,
      }, res.status as any);
    }
    
    if (input.stream) {
      // 流式：直接透传 SSE
      const headers = new Headers();
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      headers.set("Connection", "keep-alive");
      headers.set("X-Latency-Ms", String(latencyMs));
      headers.set("X-Used-Key", selectedKey.keyMasked);
      return new Response(res.body, { status: 200, headers });
    }

    // 非流式：先按文本读取，避免上游返回空体 / 非 JSON 时
    // 直接 await res.json() 抛错，进而把 500 的 JSON 当空体返回给前端
    // （这也是“Unexpected end of JSON input”在 CF 上出现的根因之一）。
    const rawText = await res.text();
    if (!rawText || rawText.trim().length === 0) {
      return c.json({
        success: false,
        error: {
          statusCode: res.status,
          message: "上游返回了空响应（可能是模型超时或网关异常）",
          type: "upstream_empty",
        },
        latencyMs,
        usedKeyMasked: selectedKey.keyMasked,
      }, 502);
    }

    let json: any;
    try {
      json = JSON.parse(rawText);
    } catch {
      return c.json({
        success: false,
        error: {
          statusCode: res.status,
          message: "上游返回了非 JSON 响应：" + rawText.slice(0, 300),
          type: "upstream_invalid",
        },
        latencyMs,
        usedKeyMasked: selectedKey.keyMasked,
      }, 502);
    }

    return c.json(ok({
      response: json,
      latencyMs,
      usedKeyMasked: selectedKey.keyMasked,
    }, c.get("requestId")));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({
      success: false,
      error: {
        message: errorMsg,
        type: errorMsg.includes("abort") ? "timeout" : "network_error",
      },
      latencyMs: Date.now() - startTime,
    }, 500);
  } finally {
    clearTimeout(timeoutId);
  }
});

// === 查询某个组合的健康状态 ===
playgroundRouter.get("/health", requireAuth, async (c) => {
  const channelId = c.req.query("channelId");
  const keyId = c.req.query("keyId");
  const modelAlias = c.req.query("modelAlias");
  
  if (!channelId || !keyId || !modelAlias) {
    throw new BusinessError("channelId, keyId, modelAlias are required", 400, "validation_error", c.get("requestId"));
  }
  
  const healthService = new HealthService(c.get("db"), c.env.HEALTH_KV, c.env);
  const state = await healthService.getState(channelId, keyId, modelAlias);
  
  return c.json(ok(state, c.get("requestId")));
});

// === 列出所有渠道及其 Key、Model（供前端下拉选择）===
playgroundRouter.get("/combinations", requireAuth, async (c) => {
  const db = c.get("db");
  const channelRows = await db.select().from(channels).where(eq(channels.status, "enabled"));
  const result = [];
  
  for (const ch of channelRows) {
    const keyRows = await db
      .select()
      .from(channelKeys)
      .where(and(eq(channelKeys.channelId, ch.id), eq(channelKeys.status, "enabled")));
    const modelRows = await db
      .select()
      .from(channelModels)
      .where(and(eq(channelModels.channelId, ch.id), eq(channelModels.enabled, true)));
    
    for (const k of keyRows) {
      for (const m of modelRows) {
        result.push({
          channelId: ch.id,
          channelName: ch.name,
          keyId: k.id,
          keyMasked: k.keyMasked,
          modelAlias: m.aliasName,
          realModel: m.realModel,
        });
      }
    }
  }
  
  return c.json(ok(result, c.get("requestId")));
});
