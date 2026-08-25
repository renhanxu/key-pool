/**
 * 通用 KV 限速中间件
 */

import { MiddlewareHandler } from "hono";
import { Bindings, Variables } from "../types";

/**
 * 基于 KV 的滑动窗口限速
 */
export function rateLimit(opts: {
  keyPrefix: string;
  windowSeconds: number;
  maxRequests: number;
}): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    // 优先用聚合密钥做限速
    const aggregateKey = c.req.header("Authorization")?.replace("Bearer ", "");
    const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    
    const key = `${opts.keyPrefix}:${aggregateKey || clientIp}`;
    const now = Math.floor(Date.now() / 1000);
    const bucketKey = `${key}:${Math.floor(now / opts.windowSeconds)}`;
    
    const current = parseInt((await c.env.HEALTH_KV.get(bucketKey)) || "0", 10);
    
    if (current >= opts.maxRequests) {
      return c.json(
        {
          error: {
            message: `Rate limit exceeded: ${opts.maxRequests} requests per ${opts.windowSeconds}s`,
            type: "rate_limit_error",
          }
        },
        429
      );
    }
    
    // 原子递增（用 put 带过期时间）
    await c.env.HEALTH_KV.put(bucketKey, String(current + 1), {
      expirationTtl: opts.windowSeconds * 2,
    });
    
    await next();
  };
}
