/**
 * 渠道测速与模型列表拉取服务
 */

import { decryptKey } from "../lib/password";
import { DB } from "../db";
import { channels, channelKeys } from "../db/schema";
import { eq } from "drizzle-orm";
import { NotFoundError } from "../lib/response";
import {
  isCloudflareAigChannel,
  isCloudflareAigCompatChannel,
  getAigProviderSegment,
  buildAigModelsUrl,
  buildAigCompatModelsUrl,
  buildAigChatCompletionsUrl,
  buildAigCompatChatCompletionsUrl,
  buildAigHeaders,
} from "../lib/ai-gateway";
import { stripTrailingV1 } from "../lib/url";

/**
 * 调用渠道的 /v1/models 接口拉取模型列表
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  customHeaders: Record<string, string> = {},
  timeoutMs = 30000,
  options?: {
    channelType?: string;
    cfAccountId?: string | null;
    cfGatewayId?: string | null;
    aigToken?: string | null;
    byokMode?: boolean;
  }
): Promise<string[]> {
  let url = `${stripTrailingV1(baseUrl)}/v1/models`;
  let headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    ...customHeaders,
  };

  if (
    options?.channelType &&
    options.aigToken &&
    ((isCloudflareAigChannel(options.channelType) &&
      !isCloudflareAigCompatChannel(options.channelType) &&
      options.cfAccountId &&
      options.cfGatewayId) ||
      isCloudflareAigCompatChannel(options.channelType))
  ) {
    if (isCloudflareAigCompatChannel(options.channelType)) {
      // 统一接口（compat）：https://gateway.ai.cloudflare.com/v1/{account_id}/default/compat/models
      if (options.cfAccountId) {
        url = buildAigCompatModelsUrl(options.cfAccountId);
        headers = buildAigHeaders({
          providerKey: apiKey || undefined,
          cfAigToken: options.aigToken,
          byokMode: !!options.byokMode || !apiKey,
          extraHeaders: customHeaders,
        });
      }
    } else {
      const providerSegment = getAigProviderSegment(options.channelType!);
      if (providerSegment) {
        url = buildAigModelsUrl(options.cfAccountId!, options.cfGatewayId!, providerSegment);
        headers = buildAigHeaders({
          providerKey: apiKey || undefined,
          cfAigToken: options.aigToken,
          byokMode: !!options.byokMode,
          extraHeaders: customHeaders,
        });
      }
    }
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch models: ${res.status} ${text.slice(0, 200)}`);
    }
    
    const data = (await res.json()) as { data: Array<{ id: string }> };
    return data.data.map((m) => m.id);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 测速：返回延迟（ms）和 TTFB（ms）
 */
export async function probeChannel(
  baseUrl: string,
  apiKey: string,
  model: string,
  customHeaders: Record<string, string> = {},
  timeoutMs = 30000,
  options?: { skipAuthHeader?: boolean }
): Promise<{ latencyMs: number; ttfbMs: number; statusCode: number }> {
  const url = `${stripTrailingV1(baseUrl)}/v1/chat/completions`;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders,
  };
  if (!options?.skipAuthHeader && apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  let firstByteTime = 0;
  let statusCode = 0;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    
    firstByteTime = Date.now();
    statusCode = res.status;
    
    // 读取 body 但不消费
    await res.arrayBuffer();
    
    const latencyMs = Date.now() - startTime;
    const ttfbMs = firstByteTime - startTime;
    
    return { latencyMs, ttfbMs, statusCode };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return { latencyMs, ttfbMs: latencyMs, statusCode: 0 };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 测速服务：选择渠道中第一个可用 Key 来测速
 */
export async function probeChannelById(db: DB, channelId: string, modelAlias: string) {
  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  
  if (!channel) throw new NotFoundError("Channel not found");
  
  const [firstKey] = await db
    .select()
    .from(channelKeys)
    .where(eq(channelKeys.channelId, channelId))
    .limit(1);
  
  if (!firstKey) throw new NotFoundError("No keys in this channel");
  
  const decryptedKey = firstKey.keyValue ? await decryptKey(firstKey.keyValue) : "";
  const decryptedAigToken = firstKey.aigToken ? await decryptKey(firstKey.aigToken) : "";
  const customHeaders = channel.customHeaders ? JSON.parse(channel.customHeaders) : {};
  
  // AI Gateway 模式：拼 URL，加 cf-aig-authorization 头
  // 账户 / Gateway 优先取「每把 Key 自己的」，否则回退到渠道级别（支持多账户统一）
  const effectiveAccount = (firstKey as any)?.cfAccountId || channel.cfAccountId;
  const effectiveGateway = (firstKey as any)?.cfGatewayId || channel.cfGatewayId;

  if (
    isCloudflareAigCompatChannel(channel.type) &&
    effectiveAccount &&
    decryptedAigToken
  ) {
    return await probeChannel(
      buildAigCompatChatCompletionsUrl(effectiveAccount),
      decryptedKey,
      modelAlias,
      {
        ...customHeaders,
        "cf-aig-authorization": `Bearer ${decryptedAigToken}`,
      },
      channel.timeoutMs || 30000,
      { skipAuthHeader: !decryptedKey }
    );
  }

  if (
    isCloudflareAigChannel(channel.type) &&
    !isCloudflareAigCompatChannel(channel.type) &&
    effectiveAccount &&
    effectiveGateway &&
    decryptedAigToken
  ) {
    const providerSegment = getAigProviderSegment(channel.type);
    if (providerSegment) {
      return await probeChannel(
        buildAigChatCompletionsUrl(effectiveAccount, effectiveGateway, providerSegment),
        decryptedKey,
        modelAlias,
        {
          ...customHeaders,
          "cf-aig-authorization": `Bearer ${decryptedAigToken}`,
        },
        channel.timeoutMs || 30000,
        { skipAuthHeader: !!firstKey.byokMode }
      );
    }
  }
  
  return await probeChannel(
    channel.baseUrl,
    decryptedKey,
    modelAlias,
    customHeaders,
    channel.timeoutMs || 30000
  );
}
