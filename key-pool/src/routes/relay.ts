/**
 * OpenAI 兼容的请求转发路由
 * 路径：/v1/chat/completions, /v1/models
 * 鉴权：使用聚合密钥（Bearer sk-xxxx）而非 JWT
 */

import { Hono } from "hono";
import { Bindings, Variables } from "../types";
import { AggregateKeyService } from "../services/aggregate-key.service";
import { RelayService } from "../services/relay.service";
import { HealthService } from "../services/health.service";
import { BusinessError, UpstreamError } from "../lib/response";
import { decryptKey } from "../lib/password";
import { channels, channelModels, aggregateKeyBindings, channelKeys } from "../db/schema";
import { eq, and, or } from "drizzle-orm";

export const relayRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * 鉴权：使用聚合密钥
 */
relayRouter.use("/v1/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: { message: "Missing Authorization header", type: "authentication_error" } }, 401);
  }
  
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json({ error: { message: "Invalid Authorization format", type: "authentication_error" } }, 401);
  }
  
  const aggregateKey = match[1];
  const service = new AggregateKeyService(c.get("db"));
  const key = await service.getByKeyValue(aggregateKey);
  
  if (!key) {
    return c.json({ error: { message: "Invalid aggregate key", type: "authentication_error" } }, 401);
  }
  
  if (key.status !== "enabled") {
    return c.json({ error: { message: "Aggregate key is disabled", type: "authentication_error" } }, 403);
  }
  
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return c.json({ error: { message: "Aggregate key has expired", type: "authentication_error" } }, 403);
  }
  
  // IP 白名单校验
  if (key.ipWhitelist) {
    try {
      const whitelist = JSON.parse(key.ipWhitelist) as string[];
      const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "";
      if (whitelist.length > 0 && !whitelist.includes(clientIp)) {
        return c.json({ error: { message: "IP not in whitelist", type: "permission_error" } }, 403);
      }
    } catch {}
  }
  
  c.set("user", {
    id: key.ownerId,
    username: "aggregate-key",
    role: "user",
  });
  c.set("aggregateKeyId", key.id);
  c.set("ownerId", key.ownerId);
  
  await next();
});

// === /v1/models ===
relayRouter.get("/v1/models", async (c) => {
  const aggregateKeyId = c.get("aggregateKeyId") as string;
  const service = new AggregateKeyService(c.get("db"));
  const combinations = await service.listAvailableCombinations(aggregateKeyId);
  
  const modelSet = new Set<string>();
  const data = [];
  for (const combo of combinations) {
    if (!modelSet.has(combo.model.aliasName)) {
      modelSet.add(combo.model.aliasName);
      data.push({
        id: combo.model.aliasName,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: combo.channel.type,
      });
    }
  }
  
  return c.json({
    object: "list",
    data,
  });
});

// === /v1/chat/completions ===
relayRouter.post("/v1/chat/completions", async (c) => {
  const aggregateKeyId = c.get("aggregateKeyId") as string;
  const ownerId = c.get("ownerId") as string | undefined;
  const body = await c.req.json() as any;
  
  if (!body.model) {
    return c.json({ error: { message: "model is required", type: "invalid_request_error" } }, 400);
  }
  
  const isStream = body.stream === true;
  const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || undefined;
  const userAgent = c.req.header("User-Agent") || undefined;
  
  const healthService = new HealthService(c.get("db"), c.env.HEALTH_KV, c.env);
  const relayService = new RelayService(c.get("db"), c.env, healthService);
  
  try {
    const response = await relayService.relayChatCompletions({
      aggregateKeyId,
      ownerId,
      modelAlias: body.model,
      body,
      isStream,
      clientIp,
      userAgent,
    });
    return response;
  } catch (err) {
    if (err instanceof UpstreamError) {
      return c.json({
        error: {
          message: err.message,
          type: "upstream_error",
        }
      }, 502);
    }
    throw err;
  }
});
