/**
 * 鉴权 API 路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { Bindings, Variables } from "../types";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { AuthService } from "../services/auth.service";
import { ok, paginated, NotFoundError, BusinessError } from "../lib/response";
import { eq, desc, count } from "drizzle-orm";
import { users, auditLogs } from "../db/schema";

export const authRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// === 登录 ===
authRouter.post("/login", async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });
  const input = schema.parse(body);
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  
  const result = await service.login(input.username, input.password, clientIp);
  return c.json(ok(result, c.get("requestId")));
});

// === 刷新 token ===
authRouter.post("/refresh", async (c) => {
  const body = await c.req.json();
  const schema = z.object({ refreshToken: z.string().min(1) });
  const input = schema.parse(body);
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const result = await service.refresh(input.refreshToken);
  return c.json(ok(result, c.get("requestId")));
});

// === 当前用户信息 ===
authRouter.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const [row] = await c.get("db")
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  
  if (!row) throw new NotFoundError("User not found", c.get("requestId"));
  
  const { passwordHash, ...safe } = row;
  return c.json(ok(safe, c.get("requestId")));
});

// === 修改自己的密码 ===
authRouter.post("/change-password", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const schema = z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(6),
  });
  const input = schema.parse(body);
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  await service.changePassword(user.id, input.oldPassword, input.newPassword);
  
  return c.json(ok({ changed: true }, c.get("requestId")));
});

// === 注册新用户（管理员）===
authRouter.post("/register", requireAuth, requireAdmin, async (c) => {
  const actor = c.get("user");
  const body = await c.req.json();
  const schema = z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(6),
    displayName: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(["admin", "user"]).optional(),
  });
  const input = schema.parse(body);
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  
  const newUser = await service.register(input, actor.id, actor.username, clientIp);
  const { passwordHash, ...safe } = newUser;
  return c.json(ok(safe, c.get("requestId")), 201);
});

// === 列出所有用户（管理员）===
authRouter.get("/users", requireAuth, requireAdmin, async (c) => {
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const list = await service.listUsers();
  return c.json(ok(list, c.get("requestId")));
});

// === 修改用户状态（管理员）===
authRouter.put("/users/:id/status", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const body = await c.req.json();
  const schema = z.object({ status: z.enum(["active", "disabled"]) });
  const input = schema.parse(body);
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  await service.setUserStatus(id, input.status, actor.id, actor.username, clientIp);
  
  return c.json(ok({ status: input.status }, c.get("requestId")));
});

// === 重置用户密码（管理员）===
authRouter.post("/users/:id/reset-password", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const body = await c.req.json();
  const schema = z.object({ newPassword: z.string().min(6) });
  const input = schema.parse(body);
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  await service.resetPassword(id, input.newPassword, actor.id, actor.username, clientIp);
  
  return c.json(ok({ reset: true }, c.get("requestId")));
});

// === 删除用户（管理员）===
authRouter.delete("/users/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  
  const service = new AuthService(c.get("db"), c.env.JWT_SECRET);
  const clientIp = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For");
  await service.deleteUser(id, actor.id, actor.username, clientIp);
  
  return c.json(ok({ deleted: true }, c.get("requestId")));
});

// === 审计日志（管理员）===
authRouter.get("/audit-logs", requireAuth, requireAdmin, async (c) => {
  const page = parseInt(c.req.query("page") || "1", 10);
  const pageSize = Math.min(parseInt(c.req.query("pageSize") || "50", 10), 200);
  
  const db = c.get("db");
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogs);
  const items = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  
  return c.json(paginated(items, Number(total), page, pageSize, c.get("requestId")));
});
