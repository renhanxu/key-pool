/**
 * 聚合密钥 API 路由
 */

import { Hono } from "hono";
import { z } from "zod";
import { Bindings, Variables } from "../types";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { AggregateKeyService } from "../services/aggregate-key.service";
import { ok, NotFoundError } from "../lib/response";

export const aggregateKeyRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const bindingSchema = z.object({
  channelId: z.string().min(1),
  modelAlias: z.string().min(1),
  fallbackModels: z.array(z.string()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  ipWhitelist: z.array(z.string()).optional(),
  qpsLimit: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  // 管理员可指定归属用户；省略则归属于创建者（管理员自己）
  ownerId: z.string().optional(),
  // 共享密钥：对所有用户可见可用
  isShared: z.boolean().optional(),
  bindings: z.array(bindingSchema).min(1),
});

// === 创建聚合密钥（仅管理员）===
// 说明：为降低项目复杂度，密钥的创建/绑定统一由管理员完成；
// 普通用户登录后只能看到「自己被绑定的密钥」或「共享密钥」。
aggregateKeyRouter.post("/", requireAuth, requireAdmin, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const input = createSchema.parse(body);

  // 归属：若指定 ownerId 且当前为管理员，则归属该用户；否则归属创建者
  const ownerId = input.ownerId && user.role === "admin" ? input.ownerId : user.id;
  const isShared = user.role === "admin" ? (input.isShared ?? false) : false;

  const service = new AggregateKeyService(c.get("db"));
  const key = await service.create({
    ownerId,
    name: input.name,
    ipWhitelist: input.ipWhitelist,
    qpsLimit: input.qpsLimit,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    note: input.note,
    isShared,
    bindings: input.bindings,
  });

  // 返回时附带原始 key value（仅此一次）
  return c.json(ok({ ...key, key_value_plain: key.keyValue }, c.get("requestId")), 201);
});

// === 列出聚合密钥 ===
aggregateKeyRouter.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const service = new AggregateKeyService(c.get("db"));
  const list = await service.listByOwner(user.id, user.role === "admin");
  return c.json(ok(list, c.get("requestId")));
});

// === 获取详情 ===
aggregateKeyRouter.get("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  
  const service = new AggregateKeyService(c.get("db"));
  const key = await service.getById(id);
  if (!key) throw new NotFoundError("Aggregate key not found", c.get("requestId"));
  
  // 权限校验：非管理员只能看自己的，或被标记为共享的密钥
  if (user.role !== "admin" && key.ownerId !== user.id && !key.isShared) {
    return c.json({ error: { message: "Forbidden", type: "permission_error" } }, 403);
  }
  
  const bindings = await service.listBindings(id);
  return c.json(ok({ ...key, bindings }, c.get("requestId")));
});

// === 更新 ===
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  ipWhitelist: z.array(z.string()).optional(),
  qpsLimit: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  status: z.enum(["enabled", "disabled"]).optional(),
  note: z.string().max(500).optional(),
  isShared: z.boolean().optional(),
  ownerId: z.string().optional(),
  bindings: z.array(bindingSchema).optional(),
});

aggregateKeyRouter.put("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const body = await c.req.json();
  const input = updateSchema.parse(body);
  
  const service = new AggregateKeyService(c.get("db"));
  const existing = await service.getById(id);
  if (!existing) throw new NotFoundError("Aggregate key not found", c.get("requestId"));
  
  if (user.role !== "admin" && existing.ownerId !== user.id) {
    return c.json({ error: { message: "Forbidden", type: "permission_error" } }, 403);
  }

  // 普通用户不允许修改归属与共享开关（防止越权把自己的密钥设为公共）
  const isShared = user.role === "admin" ? input.isShared : undefined;
  const ownerId = user.role === "admin" ? input.ownerId : undefined;

  const updated = await service.update(id, {
    name: input.name,
    ipWhitelist: input.ipWhitelist,
    qpsLimit: input.qpsLimit,
    expiresAt: input.expiresAt === null ? null : input.expiresAt ? new Date(input.expiresAt) : undefined,
    status: input.status,
    note: input.note,
    isShared,
    ownerId,
    bindings: input.bindings,
  });
  
  return c.json(ok(updated, c.get("requestId")));
});

// === 删除 ===
aggregateKeyRouter.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  
  const service = new AggregateKeyService(c.get("db"));
  const existing = await service.getById(id);
  if (!existing) throw new NotFoundError("Aggregate key not found", c.get("requestId"));
  
  if (user.role !== "admin" && existing.ownerId !== user.id) {
    return c.json({ error: { message: "Forbidden", type: "permission_error" } }, 403);
  }
  
  await service.delete(id);
  return c.json(ok({ deleted: true }, c.get("requestId")));
});
