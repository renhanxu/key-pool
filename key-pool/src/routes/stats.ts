/**
 * 用量统计 API
 */

import { Hono } from "hono";
import { z } from "zod";
import { Bindings, Variables } from "../types";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { ok, paginated, BusinessError } from "../lib/response";
import { requestLogs, channels, aggregateKeys } from "../db/schema";
import { and, eq, gte, lte, desc, sql, count } from "drizzle-orm";

export const statsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * 概览统计：总请求数 / 成功率 / Token 用量
 */
statsRouter.get("/overview", requireAuth, async (c) => {
  const user = c.get("user");
  const range = c.req.query("range") || "1d"; // 1h / 1d / 3d / 7d / 30d
  const customStart = c.req.query("start");
  const customEnd = c.req.query("end");
  
  const { startTime, endTime } = parseTimeRange(range, customStart, customEnd);
  
  const db = c.get("db");
  const conditions: any[] = [
    gte(requestLogs.createdAt, startTime),
    lte(requestLogs.createdAt, endTime),
  ];
  
  // 普通用户只能看自己
  if (user.role !== "admin") {
    conditions.push(eq(requestLogs.ownerId, user.id));
  }
  pushCommonFilters(conditions, user, c);
  
  const [summary] = await db
    .select({
      total: count(),
      success: sql<number>`SUM(CASE WHEN ${requestLogs.statusCode} >= 200 AND ${requestLogs.statusCode} < 300 THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${requestLogs.statusCode} < 200 OR ${requestLogs.statusCode} >= 300 THEN 1 ELSE 0 END)`,
      inputTokens: sql<number>`COALESCE(SUM(${requestLogs.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${requestLogs.outputTokens}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${requestLogs.totalTokens}), 0)`,
      avgDurationMs: sql<number>`COALESCE(AVG(${requestLogs.durationMs}), 0)`,
    })
    .from(requestLogs)
    .where(and(...conditions));
  
  return c.json(ok({
    range: { start: startTime, end: endTime, label: range },
    total: Number(summary?.total || 0),
    success: Number(summary?.success || 0),
    failed: Number(summary?.failed || 0),
    successRate: summary && summary.total > 0 
      ? Number(((Number(summary.success) / Number(summary.total)) * 100).toFixed(2))
      : 0,
    inputTokens: Number(summary?.inputTokens || 0),
    outputTokens: Number(summary?.outputTokens || 0),
    totalTokens: Number(summary?.totalTokens || 0),
    avgDurationMs: Math.round(Number(summary?.avgDurationMs || 0)),
  }, c.get("requestId")));
});

/**
 * 按时间维度分桶的统计
 */
statsRouter.get("/timeline", requireAuth, async (c) => {
  const user = c.get("user");
  const range = c.req.query("range") || "1d";
  const granularity = c.req.query("granularity") || "hour"; // hour / day
  
  const { startTime, endTime } = parseTimeRange(range);
  const db = c.get("db");
  const conditions: any[] = [
    gte(requestLogs.createdAt, startTime),
    lte(requestLogs.createdAt, endTime),
  ];
  
  if (user.role !== "admin") {
    conditions.push(eq(requestLogs.ownerId, user.id));
  }
  pushCommonFilters(conditions, user, c);
  
  // 按时间桶分组
  const bucketExpr = granularity === "day"
    ? sql<string>`strftime('%Y-%m-%d', datetime(${requestLogs.createdAt} / 1000, 'unixepoch'))`
    : sql<string>`strftime('%Y-%m-%d %H:00', datetime(${requestLogs.createdAt} / 1000, 'unixepoch'))`;
  
  const rows = await db
    .select({
      bucket: bucketExpr,
      total: count(),
      success: sql<number>`SUM(CASE WHEN ${requestLogs.statusCode} >= 200 AND ${requestLogs.statusCode} < 300 THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${requestLogs.statusCode} < 200 OR ${requestLogs.statusCode} >= 300 THEN 1 ELSE 0 END)`,
      totalTokens: sql<number>`COALESCE(SUM(${requestLogs.totalTokens}), 0)`,
    })
    .from(requestLogs)
    .where(and(...conditions))
    .groupBy(bucketExpr)
    .orderBy(bucketExpr);
  
  return c.json(ok(rows.map((r) => ({
    bucket: r.bucket,
    total: Number(r.total),
    success: Number(r.success),
    failed: Number(r.failed),
    totalTokens: Number(r.totalTokens),
  })), c.get("requestId")));
});

/**
 * 按错误类型分组
 */
statsRouter.get("/by-error-type", requireAuth, async (c) => {
  const user = c.get("user");
  const range = c.req.query("range") || "1d";
  
  const { startTime, endTime } = parseTimeRange(range);
  const db = c.get("db");
  const conditions: any[] = [
    gte(requestLogs.createdAt, startTime),
    lte(requestLogs.createdAt, endTime),
  ];
  
  if (user.role !== "admin") {
    conditions.push(eq(requestLogs.ownerId, user.id));
  }
  pushCommonFilters(conditions, user, c);
  
  const rows = await db
    .select({
      errorType: requestLogs.errorType,
      count: count(),
    })
    .from(requestLogs)
    .where(and(...conditions))
    .groupBy(requestLogs.errorType);
  
  return c.json(ok(rows.map((r) => ({
    errorType: r.errorType || "unknown",
    count: Number(r.count),
  })), c.get("requestId")));
});

/**
 * 按模型分组
 */
statsRouter.get("/by-model", requireAuth, async (c) => {
  const user = c.get("user");
  const range = c.req.query("range") || "1d";
  
  const { startTime, endTime } = parseTimeRange(range);
  const db = c.get("db");
  const conditions: any[] = [
    gte(requestLogs.createdAt, startTime),
    lte(requestLogs.createdAt, endTime),
  ];
  
  if (user.role !== "admin") {
    conditions.push(eq(requestLogs.ownerId, user.id));
  }
  pushCommonFilters(conditions, user, c);
  
  const rows = await db
    .select({
      modelAlias: requestLogs.modelAlias,
      count: count(),
      totalTokens: sql<number>`COALESCE(SUM(${requestLogs.totalTokens}), 0)`,
    })
    .from(requestLogs)
    .where(and(...conditions))
    .groupBy(requestLogs.modelAlias)
    .orderBy(desc(count()));
  
  return c.json(ok(rows.map((r) => ({
    model: r.modelAlias || "unknown",
    count: Number(r.count),
    totalTokens: Number(r.totalTokens),
  })), c.get("requestId")));
});

/**
 * 详细日志查询
 */
statsRouter.get("/logs", requireAuth, async (c) => {
  const user = c.get("user");
  const page = parseInt(c.req.query("page") || "1", 10);
  const pageSize = Math.min(parseInt(c.req.query("pageSize") || "20", 10), 100);
  const statusCode = c.req.query("statusCode");
  const channelId = c.req.query("channelId");
  const aggregateKeyId = c.req.query("aggregateKeyId");
  const startTime = c.req.query("start") ? new Date(c.req.query("start")!) : undefined;
  const endTime = c.req.query("end") ? new Date(c.req.query("end")!) : undefined;
  
  const db = c.get("db");
  const conditions: any[] = [];
  
  if (user.role !== "admin") {
    conditions.push(eq(requestLogs.ownerId, user.id));
  }
  pushCommonFilters(conditions, user, c);
  if (statusCode) conditions.push(eq(requestLogs.statusCode, parseInt(statusCode, 10)));
  if (channelId) conditions.push(eq(requestLogs.channelId, channelId));
  if (aggregateKeyId) conditions.push(eq(requestLogs.aggregateKeyId, aggregateKeyId));
  if (startTime) conditions.push(gte(requestLogs.createdAt, startTime));
  if (endTime) conditions.push(lte(requestLogs.createdAt, endTime));
  
  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(requestLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(requestLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(requestLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined),
  ]);
  
  return c.json(paginated(items, Number(total), page, pageSize, c.get("requestId")));
});

/**
 * 导出日志为 CSV
 */
statsRouter.get("/logs/export", requireAuth, async (c) => {
  const user = c.get("user");
  const startTime = c.req.query("start") ? new Date(c.req.query("start")!) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endTime = c.req.query("end") ? new Date(c.req.query("end")!) : new Date();
  
  const db = c.get("db");
  const conditions: any[] = [
    gte(requestLogs.createdAt, startTime),
    lte(requestLogs.createdAt, endTime),
  ];
  
  if (user.role !== "admin") {
    conditions.push(eq(requestLogs.ownerId, user.id));
  }
  pushCommonFilters(conditions, user, c);
  
  const logs = await db
    .select()
    .from(requestLogs)
    .where(and(...conditions))
    .orderBy(desc(requestLogs.createdAt))
    .limit(10000);
  
  // 构造 CSV
  const headers = [
    "ID", "Created At", "Aggregate Key ID", "Channel ID", "Model",
    "Status Code", "Error Type", "Input Tokens", "Output Tokens", "Total Tokens",
    "Duration (ms)", "TTFB (ms)", "Client IP", "User Agent"
  ];
  
  const rows = logs.map((l) => [
    l.id,
    new Date(l.createdAt).toISOString(),
    l.aggregateKeyId || "",
    l.channelId || "",
    l.modelAlias || "",
    String(l.statusCode || ""),
    l.errorType || "",
    String(l.inputTokens || 0),
    String(l.outputTokens || 0),
    String(l.totalTokens || 0),
    String(l.durationMs || 0),
    String(l.ttfbMs || 0),
    l.clientIp || "",
    l.userAgent || "",
  ]);
  
  const csv = [
    headers.join(","),
    ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="logs-${Date.now()}.csv"`);
  return c.body(csv);
});

/**
 * 通用筛选条件：聚合密钥 / 渠道 / 模型 / 用户（管理员）
 * 所有统计接口共用，支持按密钥、渠道、模型、用户维度下钻。
 */
function pushCommonFilters(conditions: any[], user: any, c: any) {
  const aggregateKeyId = c.req.query("aggregateKeyId");
  const channelId = c.req.query("channelId");
  const modelAlias = c.req.query("modelAlias");
  const userId = c.req.query("userId"); // 仅管理员可按用户维度查看

  // 管理员可按 userId 下钻；普通用户始终只看自己
  if (user.role === "admin" && userId) {
    conditions.push(eq(requestLogs.ownerId, userId));
  }
  if (aggregateKeyId) conditions.push(eq(requestLogs.aggregateKeyId, aggregateKeyId));
  if (channelId) conditions.push(eq(requestLogs.channelId, channelId));
  if (modelAlias) conditions.push(eq(requestLogs.modelAlias, modelAlias));
}

/**
 * 解析时间范围
 */
function parseTimeRange(range: string, customStart?: string | null, customEnd?: string | null): { startTime: Date; endTime: Date } {
  if (customStart && customEnd) {
    return {
      startTime: new Date(customStart),
      endTime: new Date(customEnd),
    };
  }
  
  const now = new Date();
  const ranges: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  
  const ms = ranges[range] || ranges["1d"];
  return {
    startTime: new Date(now.getTime() - ms),
    endTime: now,
  };
}
