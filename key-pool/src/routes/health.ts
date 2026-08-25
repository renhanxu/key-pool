/**
 * 健康状态总览 API
 */

import { Hono } from "hono";
import { Bindings, Variables } from "../types";
import { requireAuth } from "../middleware/auth";
import { HealthService } from "../services/health.service";
import { ok, NotFoundError } from "../lib/response";
import { channels, channelKeys, channelModels } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { stripTrailingV1 } from "../lib/url";
import {
  isCloudflareAigChannel,
  getAigProviderSegment,
  buildAigChatCompletionsUrl,
  buildAigHeaders,
} from "../lib/ai-gateway";
import { decryptKey } from "../lib/password";

export const healthRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * 列出所有组合的健康状态
 */
healthRouter.get("/states", requireAuth, async (c) => {
  const healthService = new HealthService(c.get("db"), c.env.HEALTH_KV, c.env);
  const states = await healthService.listAllStates();
  return c.json(ok(states, c.get("requestId")));
});

/**
 * 重置某个组合为 healthy
 */
healthRouter.post("/reset", requireAuth, async (c) => {
  const body = await c.req.json();
  const { channelId, keyId, modelAlias } = body;
  
  if (!channelId || !keyId || !modelAlias) {
    return c.json({ error: { message: "channelId, keyId, modelAlias are required" } }, 400);
  }
  
  const healthService = new HealthService(c.get("db"), c.env.HEALTH_KV, c.env);
  await healthService.reset(channelId, keyId, modelAlias);
  
  return c.json(ok({ reset: true }, c.get("requestId")));
});

/**
 * 触发定时健康探测
 */
healthRouter.post("/probe-disabled", requireAuth, async (c) => {
  const db = c.get("db");
  const healthService = new HealthService(db, c.env.HEALTH_KV, c.env);
  
  // 获取所有 disabled 的组合
  const allStates = await healthService.listAllStates();
  const disabled = allStates.filter((s) => s.state.status === "disabled");
  
  const results = [];
  for (const s of disabled) {
    try {
      // 取一个 key
      const [key] = await db
        .select()
        .from(channelKeys)
        .where(eq(channelKeys.id, s.keyId))
        .limit(1);
      
      const [model] = await db
        .select()
        .from(channelModels)
        .where(and(
          eq(channelModels.channelId, s.channelId),
          eq(channelModels.aliasName, s.modelAlias)
        ))
        .limit(1);
      
      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, s.channelId))
        .limit(1);
      
      if (!key || !model || !channel) continue;
      
      // 构造一个轻量请求
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
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });
        
        if (res.ok) {
          await healthService.reset(s.channelId, s.keyId, s.modelAlias);
          results.push({ ...s, probed: true, status: "recovered" });
        } else {
          results.push({ ...s, probed: true, status: "still_disabled", statusCode: res.status });
        }
      } catch (err) {
        results.push({ ...s, probed: true, status: "still_disabled", error: String(err) });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      results.push({ ...s, probed: false, error: String(err) });
    }
  }
  
  return c.json(ok({ probed: results.length, results }, c.get("requestId")));
});
