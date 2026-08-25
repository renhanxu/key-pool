/**
 * 渠道管理 API 路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { Bindings, Variables } from "../types";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { ChannelService } from "../services/channel.service";
import { fetchModels, probeChannelById } from "../services/probe.service";
import { decryptKey } from "../lib/password";
import { ok, paginated, BusinessError, NotFoundError } from "../lib/response";
import { eq } from "drizzle-orm";
import { channels, channelKeys } from "../db/schema";

export const channelRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// === 创建渠道 ===
channelRouter.post("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  
  const schema = z.object({
    name: z.string().min(1).max(100),
    type: z.enum([
      "openai",
      "anthropic",
      "gemini",
      "azure",
      "cloudflare-workers-ai",
      "cloudflare-aig-openai",
      "cloudflare-aig-anthropic",
      "cloudflare-aig-gemini",
      "cloudflare-aig-compat",
      "custom",
    ]),
    baseUrl: z.string().url().optional(),
    cfAccountId: z.string().optional(),
    cfGatewayId: z.string().optional(),
    groupTag: z.string().optional(),
    weight: z.number().int().min(1).max(1000).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    qpsLimit: z.number().int().min(1).optional(),
    concurrentLimit: z.number().int().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
    customHeaders: z.record(z.string()).optional(),
    extraConfig: z.record(z.any()).optional(),
    keys: z
      .array(
        z.union([
          z.string(),
          z.object({
            label: z.string().optional(),
            key: z.string().optional(),
            aigToken: z.string().optional(),
            byokMode: z.boolean().optional(),
            cfAccountId: z.string().optional(),
            cfGatewayId: z.string().optional(),
          }),
        ])
      )
      .min(1),
  });
  
  const input = schema.parse(body);
  const service = new ChannelService(c.get("db"));

  // AI Gateway 类型必须提供 Account ID 与 Gateway 名称
  if (
    (input.type === "cloudflare-aig-openai" ||
      input.type === "cloudflare-aig-anthropic" ||
      input.type === "cloudflare-aig-gemini") &&
    (!input.cfAccountId || !input.cfGatewayId)
  ) {
    throw new BusinessError(
      "Cloudflare AI Gateway 渠道必须填写 cfAccountId 和 cfGatewayId",
      400,
      "validation_error",
      c.get("requestId")
    );
  }

  // AI Gateway 统一接口（compat）只需 Account ID；Gateway 固定为 default
  if (input.type === "cloudflare-aig-compat" && !input.cfAccountId) {
    throw new BusinessError(
      "Cloudflare AI Gateway（compat）渠道必须填写 cfAccountId",
      400,
      "validation_error",
      c.get("requestId")
    );
  }

  const channel = await service.create(input);
  
  return c.json(ok(channel, c.get("requestId")));
});

// === 列出渠道 ===
channelRouter.get("/", requireAuth, async (c) => {
  const service = new ChannelService(c.get("db"));
  const status = c.req.query("status") as any;
  const type = c.req.query("type");
  const list = await service.list({ status, type });
  return c.json(ok(list, c.get("requestId")));
});

// === 获取渠道详情 ===
channelRouter.get("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const service = new ChannelService(c.get("db"));
  const channel = await service.getById(id);
  if (!channel) throw new NotFoundError("Channel not found", c.get("requestId"));
  
  const keys = await service.listKeys(id);
  const models = await service.listModels(id);
  
  return c.json(ok({ ...channel, keys, models }, c.get("requestId")));
});

// === 更新渠道 ===
channelRouter.put("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    baseUrl: z.string().url().optional(),
    cfAccountId: z.string().nullable().optional(),
    cfGatewayId: z.string().nullable().optional(),
    groupTag: z.string().optional(),
    weight: z.number().int().min(1).max(1000).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    qpsLimit: z.number().int().min(1).optional(),
    concurrentLimit: z.number().int().min(1).optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
    customHeaders: z.record(z.string()).optional(),
    extraConfig: z.record(z.any()).optional(),
    status: z.enum(["enabled", "disabled"]).optional(),
  });
  
  const input = schema.parse(body);
  const service = new ChannelService(c.get("db"));
  const channel = await service.update(id, input);
  
  return c.json(ok(channel, c.get("requestId")));
});

// === 删除渠道（软删除）===
channelRouter.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const service = new ChannelService(c.get("db"));
  await service.delete(id);
  return c.json(ok({ deleted: true }, c.get("requestId")));
});

// === 添加 Key ===
channelRouter.post("/:id/keys", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const schema = z.object({
    keys: z
      .array(
        z.union([
          z.string(),
          z.object({
            label: z.string().optional(),
            key: z.string().optional(),
            aigToken: z.string().optional(),
            byokMode: z.boolean().optional(),
            cfAccountId: z.string().optional(),
            cfGatewayId: z.string().optional(),
          }),
        ])
      )
      .min(1),
  });
  const input = schema.parse(body);
  
  const service = new ChannelService(c.get("db"));
  const added = await service.addKeys(id, input.keys);
  
  return c.json(ok({ added }, c.get("requestId")));
});

// === 删除 Key ===
channelRouter.delete("/:id/keys/:keyId", requireAuth, requireAdmin, async (c) => {
  const keyId = c.req.param("keyId");
  const service = new ChannelService(c.get("db"));
  await service.deleteKey(keyId);
  return c.json(ok({ deleted: true }, c.get("requestId")));
});

// === 启用/禁用 Key ===
channelRouter.put("/:id/keys/:keyId/toggle", requireAuth, requireAdmin, async (c) => {
  const keyId = c.req.param("keyId");
  const body = await c.req.json();
  const schema = z.object({ status: z.enum(["enabled", "disabled"]) });
  const { status } = schema.parse(body);
  
  const service = new ChannelService(c.get("db"));
  await service.toggleKey(keyId, status);
  return c.json(ok({ status }, c.get("requestId")));
});

// === 拉取模型列表 ===
channelRouter.post("/:id/fetch-models", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  
  const [channel] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) throw new NotFoundError("Channel not found", c.get("requestId"));
  
  const [firstKey] = await db
    .select()
    .from(channelKeys)
    .where(eq(channelKeys.channelId, id))
    .limit(1);
  
  if (!firstKey) throw new BusinessError("No keys in this channel", 400, "validation_error", c.get("requestId"));
  
  const decryptedKey = firstKey.keyValue ? await decryptKey(firstKey.keyValue) : "";
  const decryptedAigToken = firstKey.aigToken ? await decryptKey(firstKey.aigToken) : "";
  const customHeaders = channel.customHeaders ? JSON.parse(channel.customHeaders) : {};
  
  let models: string[] = [];
  try {
    models = await fetchModels(
      channel.baseUrl,
      decryptedKey,
      customHeaders,
      channel.timeoutMs || 30000,
      {
        channelType: channel.type,
        // 账户 / Gateway 优先取「每把 Key 自己的」，否则回退到渠道级别（多账户统一）
        cfAccountId: (firstKey as any)?.cfAccountId || channel.cfAccountId,
        cfGatewayId: (firstKey as any)?.cfGatewayId || channel.cfGatewayId,
        aigToken: decryptedAigToken,
        byokMode: !!firstKey.byokMode,
      }
    );
  } catch (err: any) {
    // 把上游厂商返回的错误翻译成对用户友好的提示，而不是抛出 500 + 原始堆栈
    const raw = String(err?.message || err);
    let hint = "请检查渠道的 baseUrl 与 Key 是否正确，或尝试在「渠道管理」中手动添加模型。";
    if (/401/.test(raw)) {
      hint = "厂商返回 401 未授权，请检查该渠道的 Key 是否有效（Key 无效时无法自动拉取）。";
    } else if (/403/.test(raw)) {
      hint = "厂商返回 403 禁止访问，请检查该渠道的 Key 权限。";
    } else if (/timeout|abort/i.test(raw)) {
      hint = "连接厂商超时，请检查网络或 baseUrl 是否正确。";
    }
    throw new BusinessError(
      `从厂商拉取模型失败：${hint}`,
      502,
      "upstream_error",
      c.get("requestId")
    );
  }
  
  return c.json(ok({ models }, c.get("requestId")));
});

// === 添加模型映射 ===
channelRouter.post("/:id/models", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const schema = z.object({
    models: z.array(z.object({
      aliasName: z.string().min(1),
      realModel: z.string().min(1),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    })).min(1),
  });
  const input = schema.parse(body);
  
  const service = new ChannelService(c.get("db"));
  const results = await service.addModels(id, input.models);
  
  return c.json(ok({ models: results }, c.get("requestId")));
});

// === 删除模型映射 ===
channelRouter.delete("/:id/models/:modelId", requireAuth, requireAdmin, async (c) => {
  const modelId = c.req.param("modelId");
  const service = new ChannelService(c.get("db"));
  await service.deleteModel(modelId);
  return c.json(ok({ deleted: true }, c.get("requestId")));
});

// === 测速 ===
channelRouter.post("/:id/probe", requireAuth, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const schema = z.object({ model: z.string().min(1) });
  const input = schema.parse(body);
  
  const result = await probeChannelById(c.get("db"), id, input.model);
  return c.json(ok(result, c.get("requestId")));
});
