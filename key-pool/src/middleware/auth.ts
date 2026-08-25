/**
 * 鉴权中间件
 */

import { MiddlewareHandler } from "hono";
import { Bindings, Variables } from "../types";
import { AuthError, ForbiddenError } from "../lib/response";
import { extractBearerToken, verifyToken } from "../lib/jwt";

/**
 * 必须登录中间件
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c, next) => {
  const requestId = c.get("requestId");
  
  // 优先从 Authorization 头获取
  const authHeader = c.req.header("Authorization");
  let token = extractBearerToken(authHeader);
  
  // 其次从 query 获取（用于 SSE / 直接 curl）
  if (!token) {
    token = c.req.query("token") || null;
  }
  
  if (!token) {
    throw new AuthError("Missing authentication token", requestId);
  }
  
  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload) {
    throw new AuthError("Invalid or expired token", requestId);
  }
  
  c.set("user", {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
  });
  
  await next();
};

/**
 * 必须管理员中间件
 */
export const requireAdmin: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c, next) => {
  const user = c.get("user");
  const requestId = c.get("requestId");
  
  if (!user || user.role !== "admin") {
    throw new ForbiddenError("Admin access required", requestId);
  }
  
  await next();
};
