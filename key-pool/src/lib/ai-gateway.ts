/**
 * Cloudflare AI Gateway URL 与请求头构造工具
 *
 * Cloudflare AI Gateway URL 格式：
 *   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/{provider}
 *
 * 鉴权模式（不同模式 header 不同）：
 *   1) 普通转发：Authorization: Bearer {openai_key} + cf-aig-authorization: Bearer {cf_token}
 *   2) BYOK（OpenAI Key 已存到 Cloudflare）：只需 cf-aig-authorization: Bearer {cf_token}
 *   3) Unified Billing（统一计费）：只需 cf-aig-authorization: Bearer {cf_token}
 *
 * Provider 段对照：
 *   - cloudflare-aig-openai → openai
 *   - cloudflare-aig-anthropic → anthropic
 *   - cloudflare-aig-gemini → google-ai-studio（或 gemini）
 */

export type CloudflareAigProvider =
  | "cloudflare-aig-openai"
  | "cloudflare-aig-anthropic"
  | "cloudflare-aig-gemini";

/**
 * 根据渠道类型获取 AI Gateway URL 中的 provider 段
 */
export function getAigProviderSegment(type: string): string | null {
  const map: Record<string, string> = {
    "cloudflare-aig-openai": "openai",
    "cloudflare-aig-anthropic": "anthropic",
    "cloudflare-aig-gemini": "google-ai-studio",
  };
  return map[type] || null;
}

/**
 * 构造 AI Gateway 的完整 base URL
 *   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/{provider}
 */
export function buildAigBaseUrl(
  cfAccountId: string,
  cfGatewayId: string,
  providerSegment: string
): string {
  return `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayId}/${providerSegment}`;
}

/**
 * 构造 AI Gateway 模式下请求 /v1/models 的 URL
 */
export function buildAigModelsUrl(
  cfAccountId: string,
  cfGatewayId: string,
  providerSegment: string
): string {
  return `${buildAigBaseUrl(cfAccountId, cfGatewayId, providerSegment)}/models`;
}

/**
 * 构造 AI Gateway 模式下请求 /v1/chat/completions 的 URL
 */
export function buildAigChatCompletionsUrl(
  cfAccountId: string,
  cfGatewayId: string,
  providerSegment: string
): string {
  return `${buildAigBaseUrl(cfAccountId, cfGatewayId, providerSegment)}/chat/completions`;
}

/**
 * 构造 AI Gateway 模式下的请求头
 *
 * @param providerKey  真实厂商的 API Key（如 OpenAI key）。BYOK 模式下可传 undefined
 * @param cfAigToken   Cloudflare API Token（cf-aig-authorization 头用）
 * @param byokMode     true 表示 OpenAI Key 已存在 Cloudflare，不发 Authorization
 * @param extraHeaders 自定义 header
 */
export function buildAigHeaders(opts: {
  providerKey?: string;
  cfAigToken: string;
  byokMode: boolean;
  extraHeaders?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "cf-aig-authorization": `Bearer ${opts.cfAigToken}`,
    ...(opts.extraHeaders || {}),
  };
  
  if (!opts.byokMode && opts.providerKey) {
    headers["Authorization"] = `Bearer ${opts.providerKey}`;
  }
  
  return headers;
}

/**
 * 判断渠道类型是否为 Cloudflare AI Gateway 的「统一接口（Unified API / compat）」
 * URL 形如 https://gateway.ai.cloudflare.com/v1/{account_id}/default/compat
 */
export function isCloudflareAigCompatChannel(type: string): boolean {
  return type === "cloudflare-aig-compat";
}

/**
 * 构造 compat 模式的基础 URL
 *   https://gateway.ai.cloudflare.com/v1/{account_id}/default/compat
 */
export function buildAigCompatBaseUrl(accountId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/default/compat`;
}

/**
 * compat 模式下请求 /v1/models 的 URL
 */
export function buildAigCompatModelsUrl(accountId: string): string {
  return `${buildAigCompatBaseUrl(accountId)}/models`;
}

/**
 * compat 模式下请求 /v1/chat/completions 的 URL
 */
export function buildAigCompatChatCompletionsUrl(accountId: string): string {
  return `${buildAigCompatBaseUrl(accountId)}/chat/completions`;
}

/**
 * 判断渠道类型是否使用 Cloudflare AI Gateway（含 compat 与按厂商分离的三种类型）
 */
export function isCloudflareAigChannel(type: string): boolean {
  return type.startsWith("cloudflare-aig-");
}
