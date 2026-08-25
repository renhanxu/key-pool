/**
 * URL 规范化小工具
 *
 * 问题背景：用户在配置渠道 baseUrl 时，常按厂商文档直接填成
 * `https://openrouter.ai/api/v1` 或 `https://api.openai.com/v1`（即已经带 /v1）。
 * 而下游拼接一直用 `${baseUrl}/v1/chat/completions` 这种写法，
 * 于是会变成 `.../v1/v1/chat/completions` → 404。
 *
 * 这里统一在拼接前去掉结尾可能存在的 /v1 段，确保无论 baseUrl 是否带 /v1，
 * 最终都只出现一次 /v1。
 */
export function stripTrailingV1(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/i, "").replace(/\/$/, "");
}
