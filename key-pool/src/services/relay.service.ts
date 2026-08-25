/**
 * 请求转发核心服务（OpenAI 兼容）
 * - 智能选择
 * - 失败转移
 * - 流式/非流式
 * - 记录日志
 */

import { DB } from "../db";
import { Bindings } from "../types";
import { HealthService, ErrorType } from "./health.service";
import { AggregateKeyService } from "./aggregate-key.service";
import {
  isCloudflareAigChannel,
  isCloudflareAigCompatChannel,
  getAigProviderSegment,
  buildAigChatCompletionsUrl,
  buildAigCompatChatCompletionsUrl,
  buildAigHeaders,
} from "../lib/ai-gateway";
import { decryptKey } from "../lib/password";
import { stripTrailingV1 } from "../lib/url";
import { requestLogs } from "../db/schema";
import { generateId } from "../lib/password";
import {
  channels,
  channelKeys,
  channelModels,
  aggregateKeyBindings,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { UpstreamError } from "../lib/response";

interface RelayOptions {
  aggregateKeyId: string;
  ownerId?: string;
  modelAlias: string;
  body: any;
  isStream: boolean;
  clientIp?: string;
  userAgent?: string;
}

interface RelayAttemptResult {
  success: boolean;
  statusCode: number;
  errorType?: ErrorType;
  errorMessage?: string;
  channelId?: string;
  channelKeyId?: string;
  response?: Response;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  ttfbMs?: number;
}

export class RelayService {
  constructor(
    private db: DB,
    private env: Bindings,
    private healthService: HealthService
  ) {}

  /**
   * 转发聊天补全请求
   */
  async relayChatCompletions(opts: RelayOptions, visited: Set<string> = new Set()): Promise<Response> {
    // 防止降级模型形成环（A→B→A）导致无限递归
    if (visited.has(opts.modelAlias)) {
      throw new UpstreamError(`Fallback loop detected at model: ${opts.modelAlias}`);
    }
    visited.add(opts.modelAlias);

    const startTime = Date.now();
    const aggService = new AggregateKeyService(this.db);
    
    // 1. 获取聚合密钥的所有可用组合
    const combinations = await aggService.listAvailableCombinations(opts.aggregateKeyId);
    
    // 2. 过滤匹配 model alias 的组合
    const candidates = combinations.filter(
      (c) => c.binding.modelAlias === opts.modelAlias
    );
    
    if (candidates.length === 0) {
      // 尝试等效模型降级
      const fallback = await this.tryFallbackModels(opts, visited);
      if (!fallback) {
        throw new UpstreamError(`No available channel for model: ${opts.modelAlias}`);
      }
      return fallback;
    }
    
    // 3. 对每个组合，展开其所有可用的 Key
    const candidatesWithKeys: Array<{
      channelId: string;
      keyId: string;
      modelAlias: string;
      weight: number;
      baseUrl: string;
      realModel: string;
      prefix?: string;
      suffix?: string;
    }> = [];
    
    for (const c of candidates) {
      const keys = await this.db
        .select()
        .from(channelKeys)
        .where(and(
          eq(channelKeys.channelId, c.channel.id),
          eq(channelKeys.status, "enabled")
        ));
      
      for (const k of keys) {
        candidatesWithKeys.push({
          channelId: c.channel.id,
          keyId: k.id,
          modelAlias: c.model.aliasName,
          weight: c.channel.weight,
          baseUrl: c.channel.baseUrl,
          realModel: c.model.realModel,
          prefix: c.model.prefix || undefined,
          suffix: c.model.suffix || undefined,
        });
      }
    }
    
    if (candidatesWithKeys.length === 0) {
      throw new UpstreamError("No available keys for this model");
    }
    
    // 4. 智能选择：循环尝试，每次失败后从候选中剔除
    const maxRetries = 3;
    const tried = new Set<string>();
    const errors: Array<{ channelId: string; keyId: string; error: string; type: ErrorType }> = [];
    
    for (let i = 0; i < maxRetries; i++) {
      const remaining = candidatesWithKeys.filter(
        (c) => !tried.has(`${c.channelId}:${c.keyId}`)
      );
      if (remaining.length === 0) break;
      
      const picked = await this.healthService.selectHealthy(remaining);
      if (!picked) {
        // 全部不可用
        break;
      }
      
      tried.add(`${picked.channelId}:${picked.keyId}`);
      
      const candidate = candidatesWithKeys.find(
        (c) => c.channelId === picked.channelId && c.keyId === picked.keyId
      )!;
      
      // 5. 构造请求并发送
      const result = await this.tryRequest(opts, candidate);
      
      // 6. 更新健康状态
      if (result.success) {
        await this.healthService.markSuccess(
          candidate.channelId,
          candidate.keyId,
          candidate.modelAlias
        );
        
        // 记录日志
        await this.logRequest(opts, result, startTime);
        
        return result.response!;
      } else {
        await this.healthService.markFailure(
          candidate.channelId,
          candidate.keyId,
          candidate.modelAlias,
          result.errorType || "unknown",
          result.errorMessage
        );
        errors.push({
          channelId: candidate.channelId,
          keyId: candidate.keyId,
          error: result.errorMessage || "unknown",
          type: result.errorType || "unknown",
        });
      }
    }
    
    // 7. 所有候选都失败，尝试等效模型降级
    const fallback = await this.tryFallbackModels(opts, visited);
    if (fallback) return fallback;
    
    // 8. 返回聚合错误信息
    const errorDetail = errors.map((e) => `[${e.type}] ${e.error}`).join("; ");
    throw new UpstreamError(`All channels failed: ${errorDetail}`);
  }

  /**
   * 尝试用降级模型
   */
  private async tryFallbackModels(opts: RelayOptions, visited: Set<string>): Promise<Response | null> {
    // 获取当前模型的等效降级模型
    const bindings = await this.db
      .select()
      .from(aggregateKeyBindings)
      .where(and(
        eq(aggregateKeyBindings.aggregateKeyId, opts.aggregateKeyId),
        eq(aggregateKeyBindings.modelAlias, opts.modelAlias)
      ));
    
    const fallbackModels: string[] = [];
    for (const b of bindings) {
      if (b.fallbackModels) {
        try {
          const list = JSON.parse(b.fallbackModels) as string[];
          fallbackModels.push(...list);
        } catch {}
      }
    }
    
    if (fallbackModels.length === 0) return null;
    
    // 取第一个尚未访问过的降级模型，避免环
    const next = fallbackModels.find((m) => !visited.has(m));
    if (!next) return null;
    
    // 修改请求 body 用降级模型
    const newBody = { ...opts.body, model: next };
    
    return await this.relayChatCompletions({
      ...opts,
      modelAlias: next,
      body: newBody,
    }, visited);
  }

  /**
   * 实际发起一次请求
   */
  private async tryRequest(
    opts: RelayOptions,
    candidate: {
      channelId: string;
      keyId: string;
      modelAlias: string;
      baseUrl: string;
      realModel: string;
      prefix?: string;
      suffix?: string;
    }
  ): Promise<RelayAttemptResult> {
    // 获取解密后的 key
    const [keyRow] = await this.db
      .select()
      .from(channelKeys)
      .where(eq(channelKeys.id, candidate.keyId))
      .limit(1);
    
    if (!keyRow) {
      return {
        success: false,
        statusCode: 0,
        errorType: "unknown",
        errorMessage: "Key not found",
      };
    }
    
    const decryptedKey = keyRow.keyValue ? await decryptKey(keyRow.keyValue) : "";
    const decryptedAigToken = keyRow.aigToken ? await decryptKey(keyRow.aigToken) : "";
    
    // 构造实际请求的 model 字段
    const realModelName = `${candidate.prefix || ""}${candidate.realModel}${candidate.suffix || ""}`;
    const requestBody = { ...opts.body, model: realModelName };
    
    // 获取渠道配置
    const [channel] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, candidate.channelId))
      .limit(1);
    
    const customHeaders = channel?.customHeaders ? JSON.parse(channel.customHeaders) : {};
    
    // === 构造 URL 和 headers（支持 Cloudflare AI Gateway 模式）===
    let url: string;
    let requestHeaders: Record<string, string>;
    
    if (channel && isCloudflareAigCompatChannel(channel.type)) {
      // Cloudflare AI Gateway 统一接口（Unified API）：
      //   https://gateway.ai.cloudflare.com/v1/{account_id}/default/compat/chat/completions
      // 账户 ID 优先取「每把 Key 自己的」，否则回退到渠道级别
      const effectiveAccount = keyRow.cfAccountId || channel.cfAccountId;
      if (!effectiveAccount) {
        return {
          success: false,
          statusCode: 0,
          errorType: "auth_fail",
          errorMessage: "Missing Cloudflare account id (set it at channel level or per-key)",
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
        };
      }

      url = buildAigCompatChatCompletionsUrl(effectiveAccount);

      if (!decryptedAigToken) {
        return {
          success: false,
          statusCode: 0,
          errorType: "auth_fail",
          errorMessage: "Missing Cloudflare AI Gateway token (cf-aig-authorization) on this key",
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
        };
      }

      // 统一接口：gateway token 必带；若有厂商 Key 则以 Authorization 携带
      requestHeaders = buildAigHeaders({
        providerKey: decryptedKey || undefined,
        cfAigToken: decryptedAigToken,
        byokMode: !!keyRow.byokMode || !decryptedKey,
        extraHeaders: customHeaders,
      });
    } else if (
      channel &&
      isCloudflareAigChannel(channel.type) &&
      !isCloudflareAigCompatChannel(channel.type) &&
      (channel.cfAccountId || keyRow.cfAccountId) &&
      (channel.cfGatewayId || keyRow.cfGatewayId)
    ) {
      const providerSegment = getAigProviderSegment(channel.type);
      if (!providerSegment) {
        return {
          success: false,
          statusCode: 0,
          errorType: "unknown",
          errorMessage: `Unknown AI Gateway provider for type: ${channel.type}`,
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
        };
      }

      // 账户 / Gateway 优先取「每把 Key 自己的」，否则回退到渠道级别（支持多账户统一）
      const effectiveAccount = keyRow.cfAccountId || channel.cfAccountId;
      const effectiveGateway = keyRow.cfGatewayId || channel.cfGatewayId;

      if (!effectiveAccount || !effectiveGateway) {
        return {
          success: false,
          statusCode: 0,
          errorType: "auth_fail",
          errorMessage: "Missing Cloudflare account id / gateway id (set them at channel level or per-key)",
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
        };
      }

      // AI Gateway 模式：URL 形如 https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/{provider}/chat/completions
      url = buildAigChatCompletionsUrl(effectiveAccount, effectiveGateway, providerSegment);

      // headers：必带 cf-aig-authorization；BYOK 模式则不发 Authorization
      if (!decryptedAigToken) {
        return {
          success: false,
          statusCode: 0,
          errorType: "auth_fail",
          errorMessage: "Missing Cloudflare AI Gateway token (cf-aig-authorization) on this key",
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
        };
      }

      requestHeaders = buildAigHeaders({
        providerKey: decryptedKey || undefined,
        cfAigToken: decryptedAigToken,
        byokMode: !!keyRow.byokMode,
        extraHeaders: customHeaders,
      });
    } else {
      // 普通模式
      url = `${stripTrailingV1(candidate.baseUrl)}/v1/chat/completions`;
      requestHeaders = {
        "Authorization": `Bearer ${decryptedKey}`,
        "Content-Type": "application/json",
        ...customHeaders,
      };
    }
    
    const timeoutMs = channel?.timeoutMs || 30000;
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
      
      const ttfbMs = Date.now() - startTime;
      
      // 鉴权失败：直接 disabled
      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          statusCode: res.status,
          errorType: "auth_fail",
          errorMessage: `Auth failed: ${res.status}`,
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
          durationMs: Date.now() - startTime,
          ttfbMs,
        };
      }
      
      // 限流
      if (res.status === 429) {
        return {
          success: false,
          statusCode: 429,
          errorType: "rate_limit",
          errorMessage: "Rate limit",
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
          durationMs: Date.now() - startTime,
          ttfbMs,
        };
      }
      
      // 5xx
      if (res.status >= 500) {
        return {
          success: false,
          statusCode: res.status,
          errorType: "server_error",
          errorMessage: `Server error: ${res.status}`,
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
          durationMs: Date.now() - startTime,
          ttfbMs,
        };
      }
      
      // 其它非 2xx
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          statusCode: res.status,
          errorType: res.status === 400 ? "bad_request" : res.status === 404 ? "not_found" : "unknown",
          errorMessage: text.slice(0, 200),
          channelId: candidate.channelId,
          channelKeyId: candidate.keyId,
          durationMs: Date.now() - startTime,
          ttfbMs,
        };
      }
      
      // 成功：透传响应
      const durationMs = Date.now() - startTime;
      const headers = new Headers(res.headers);
      headers.set("X-Channel-Id", candidate.channelId);
      headers.set("X-Model-Used", realModelName);
      
      // 非流式：尝试提取 token 用量
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      
      if (!opts.isStream) {
        const cloned = res.clone();
        try {
          const json = await cloned.json() as any;
          if (json.usage) {
            inputTokens = json.usage.prompt_tokens || 0;
            outputTokens = json.usage.completion_tokens || 0;
            totalTokens = json.usage.total_tokens || 0;
          }
        } catch {}
      }
      
      return {
        success: true,
        statusCode: res.status,
        response: new Response(res.body, {
          status: res.status,
          headers,
        }),
        channelId: candidate.channelId,
        channelKeyId: candidate.keyId,
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        ttfbMs,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        statusCode: 0,
        errorType: errorMsg.includes("abort") ? "timeout" : "unknown",
        errorMessage: errorMsg,
        channelId: candidate.channelId,
        channelKeyId: candidate.keyId,
        durationMs: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 记录请求日志
   */
  private async logRequest(
    opts: RelayOptions,
    result: RelayAttemptResult,
    startTime: number
  ): Promise<void> {
    // 提取 token 用量（流式需要从 SSE 解析，这里简化处理）
    try {
      await this.db.insert(requestLogs).values({
        id: generateId("rl"),
        aggregateKeyId: opts.aggregateKeyId,
        ownerId: opts.ownerId || null,
        channelId: result.channelId || null,
        channelKeyId: result.channelKeyId || null,
        modelAlias: opts.modelAlias,
        realModel: opts.body.model,
        isStream: opts.isStream,
        statusCode: result.statusCode,
        errorType: result.success ? "success" : result.errorType || "unknown",
        errorMessage: result.errorMessage || null,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        totalTokens: result.totalTokens || 0,
        durationMs: result.durationMs || Date.now() - startTime,
        ttfbMs: result.ttfbMs || null,
        clientIp: opts.clientIp || null,
        userAgent: opts.userAgent || null,
      });
    } catch (err) {
      console.error("Failed to log request:", err);
    }
  }
}
