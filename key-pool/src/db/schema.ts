/**
 * Drizzle ORM Schema（适配 Cloudflare D1 / SQLite）
 * 数据库表结构：用户、渠道、渠道密钥、模型映射、聚合密钥、绑定关系、健康状态、请求日志、统计、审计日志
 */

import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ============================================================
// 1. 用户表 users
// ============================================================
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    displayName: text("display_name"),
    email: text("email"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    usernameIdx: uniqueIndex("users_username_idx").on(t.username),
    roleIdx: index("users_role_idx").on(t.role),
  })
);

// ============================================================
// 2. 渠道表 channels（厂商渠道基本信息）
// ============================================================
export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type", {
      enum: [
        "openai",
        "anthropic",
        "gemini",
        "azure",
        "cloudflare-workers-ai",
        "cloudflare-aig-openai", // 通过 Cloudflare AI Gateway 走 OpenAI
        "cloudflare-aig-anthropic", // 通过 Cloudflare AI Gateway 走 Anthropic
        "cloudflare-aig-gemini", // 通过 Cloudflare AI Gateway 走 Gemini
        "cloudflare-aig-compat", // Cloudflare AI Gateway 统一接口（Unified API）：/v1/{account_id}/default/compat
        "custom",
      ],
    }).notNull(),
    baseUrl: text("base_url").notNull(),
    // Cloudflare AI Gateway 专属字段
    cfAccountId: text("cf_account_id"), // Cloudflare 账户 ID
    cfGatewayId: text("cf_gateway_id"), // AI Gateway 名称（自定义）
    groupTag: text("group_tag"),
    weight: integer("weight").notNull().default(100),
    priority: integer("priority").notNull().default(0),
    qpsLimit: integer("qps_limit").default(60),
    concurrentLimit: integer("concurrent_limit").default(10),
    timeoutMs: integer("timeout_ms").default(30000),
    status: text("status", { enum: ["enabled", "disabled", "deleted"] })
      .notNull()
      .default("enabled"),
    customHeaders: text("custom_headers"), // JSON 字符串
    extraConfig: text("extra_config"), // JSON 字符串（如 Azure 的 deployment 名等）
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    typeIdx: index("channels_type_idx").on(t.type),
    statusIdx: index("channels_status_idx").on(t.status),
    groupIdx: index("channels_group_idx").on(t.groupTag),
  })
);

// ============================================================
// 3. 渠道 Key 表 channel_keys（一个渠道下可有多个 Key，每个 Key 可独立账户）
// ============================================================
export const channelKeys = sqliteTable(
  "channel_keys",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    // 提供商账户标识（用于 UI 展示和运维，如 "主账户-A"、"备账户"）
    providerLabel: text("provider_label"),
    // 真实 API Key（加密存储）
    keyValue: text("key_value").notNull(),
    keyMasked: text("key_masked").notNull(), // 仅展示前后几位
    // Cloudflare AI Gateway Token（用于 cf-aig-authorization 头）
    aigToken: text("aig_token"), // 加密存储
    aigTokenMasked: text("aig_token_masked"),
    // 每个 Key 自己所属的 Cloudflare 账户 / Gateway（用于「多账户统一」：同一渠道下不同 Key 可归属不同 CF 账户）
    // 为空时回退到渠道级别的 cfAccountId / cfGatewayId
    cfAccountId: text("cf_account_id"),
    cfGatewayId: text("cf_gateway_id"),
    // BYOK 模式：true = 该 provider 的 Key 已存到 Cloudflare（请求时只发 cf-aig-authorization，不再发 Authorization: Bearer）
    byokMode: integer("byok_mode", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["enabled", "disabled"] })
      .notNull()
      .default("enabled"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    channelIdx: index("channel_keys_channel_idx").on(t.channelId),
    statusIdx: index("channel_keys_status_idx").on(t.status),
  })
);

// ============================================================
// 4. 渠道模型映射 channel_models
// ============================================================
export const channelModels = sqliteTable(
  "channel_models",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    aliasName: text("alias_name").notNull(), // 对外展示名（用户可见）
    realModel: text("real_model").notNull(), // 真实请求使用的 model 名
    prefix: text("prefix"), // 请求时拼接的前缀（如 workers-ai/@cf/）
    suffix: text("suffix"), // 请求时拼接的后缀
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    channelIdx: index("channel_models_channel_idx").on(t.channelId),
    aliasIdx: index("channel_models_alias_idx").on(t.aliasName),
    uniqueAlias: uniqueIndex("channel_models_channel_alias_idx").on(
      t.channelId,
      t.aliasName
    ),
  })
);

// ============================================================
// 5. 聚合密钥表 aggregate_keys
// ============================================================
export const aggregateKeys = sqliteTable(
  "aggregate_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyValue: text("key_value").notNull().unique(), // sk-xxxx
    keyMasked: text("key_masked").notNull(),
    ipWhitelist: text("ip_whitelist"), // JSON 数组字符串
    qpsLimit: integer("qps_limit").default(60),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["enabled", "disabled"] })
      .notNull()
      .default("enabled"),
    isShared: integer("is_shared", { mode: "boolean" })
      .notNull()
      .default(false), // 共享密钥：对所有用户可见可用
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    ownerIdx: index("aggregate_keys_owner_idx").on(t.ownerId),
    keyIdx: uniqueIndex("aggregate_keys_value_idx").on(t.keyValue),
    statusIdx: index("aggregate_keys_status_idx").on(t.status),
  })
);

// ============================================================
// 6. 聚合密钥绑定关系 aggregate_key_bindings
// ============================================================
export const aggregateKeyBindings = sqliteTable(
  "aggregate_key_bindings",
  {
    id: text("id").primaryKey(),
    aggregateKeyId: text("aggregate_key_id")
      .notNull()
      .references(() => aggregateKeys.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    modelAlias: text("model_alias").notNull(), // 绑定的模型别名（来自 channelModels.aliasName）
    fallbackModels: text("fallback_models"), // JSON 数组：等效降级模型别名列表
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    aggIdx: index("agg_bindings_agg_idx").on(t.aggregateKeyId),
    channelIdx: index("agg_bindings_channel_idx").on(t.channelId),
    uniqueBind: uniqueIndex("agg_bindings_unique_idx").on(
      t.aggregateKeyId,
      t.channelId,
      t.modelAlias
    ),
  })
);

// ============================================================
// 7. 渠道健康状态 channel_health_state
// 注：实际实时状态存在 KV（高频读写），这里存最近一次的快照用于历史查看
// ============================================================
export const channelHealthState = sqliteTable(
  "channel_health_state",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    keyId: text("key_id")
      .notNull()
      .references(() => channelKeys.id, { onDelete: "cascade" }),
    modelAlias: text("model_alias").notNull(),
    status: text("status", {
      enum: ["healthy", "cooling", "disabled"],
    })
      .notNull()
      .default("healthy"),
    failureCount: integer("failure_count").notNull().default(0),
    coolingUntil: integer("cooling_until", { mode: "timestamp_ms" }),
    lastErrorType: text("last_error_type"),
    lastErrorMessage: text("last_error_message"),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
    lastFailureAt: integer("last_failure_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    compositeIdx: uniqueIndex("health_composite_idx").on(
      t.channelId,
      t.keyId,
      t.modelAlias
    ),
    statusIdx: index("health_status_idx").on(t.status),
  })
);

// ============================================================
// 8. 请求日志 request_logs
// ============================================================
export const requestLogs = sqliteTable(
  "request_logs",
  {
    id: text("id").primaryKey(),
    aggregateKeyId: text("aggregate_key_id").references(() => aggregateKeys.id, {
      onDelete: "set null",
    }),
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    channelId: text("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),
    channelKeyId: text("channel_key_id").references(() => channelKeys.id, {
      onDelete: "set null",
    }),
    modelAlias: text("model_alias"),
    realModel: text("real_model"),
    isStream: integer("is_stream", { mode: "boolean" }).notNull().default(false),
    statusCode: integer("status_code"),
    errorType: text("error_type"), // timeout / rate_limit / auth_fail / server_error / bad_request / not_found / success
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    totalTokens: integer("total_tokens").default(0),
    durationMs: integer("duration_ms"),
    ttfbMs: integer("ttfb_ms"),
    clientIp: text("client_ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    aggIdx: index("request_logs_agg_idx").on(t.aggregateKeyId),
    ownerIdx: index("request_logs_owner_idx").on(t.ownerId),
    channelIdx: index("request_logs_channel_idx").on(t.channelId),
    statusIdx: index("request_logs_status_idx").on(t.statusCode),
    createdAtIdx: index("request_logs_created_at_idx").on(t.createdAt),
  })
);

// ============================================================
// 9. 用量统计预聚合表 usage_stats
// ============================================================
export const usageStats = sqliteTable(
  "usage_stats",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket").notNull(), // 时间桶，格式如 2026-08-25-14 (小时) 或 2026-08-25 (天)
    granularity: text("granularity", { enum: ["hour", "day"] }).notNull(),
    aggregateKeyId: text("aggregate_key_id").references(() => aggregateKeys.id, {
      onDelete: "cascade",
    }),
    channelId: text("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    modelAlias: text("model_alias"),
    requestCount: integer("request_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    avgDurationMs: integer("avg_duration_ms").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    bucketIdx: index("usage_stats_bucket_idx").on(t.bucket, t.granularity),
    aggIdx: index("usage_stats_agg_idx").on(t.aggregateKeyId),
    channelIdx: index("usage_stats_channel_idx").on(t.channelId),
  })
);

// ============================================================
// 10. 审计日志 audit_logs
// ============================================================
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorUsername: text("actor_username"),
    action: text("action").notNull(), // create_channel / delete_user / ...
    targetType: text("target_type"), // channel / user / aggregate_key
    targetId: text("target_id"),
    detail: text("detail"), // JSON 字符串
    clientIp: text("client_ip"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    actorIdx: index("audit_logs_actor_idx").on(t.actorId),
    actionIdx: index("audit_logs_action_idx").on(t.action),
    createdAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
  })
);

// ============================================================
// 类型导出
// ============================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

export type ChannelKey = typeof channelKeys.$inferSelect;
export type NewChannelKey = typeof channelKeys.$inferInsert;

export type ChannelModel = typeof channelModels.$inferSelect;
export type NewChannelModel = typeof channelModels.$inferInsert;

export type AggregateKey = typeof aggregateKeys.$inferSelect;
export type NewAggregateKey = typeof aggregateKeys.$inferInsert;

export type AggregateKeyBinding = typeof aggregateKeyBindings.$inferSelect;
export type NewAggregateKeyBinding = typeof aggregateKeyBindings.$inferInsert;

export type ChannelHealthState = typeof channelHealthState.$inferSelect;
export type NewChannelHealthState = typeof channelHealthState.$inferInsert;

export type RequestLog = typeof requestLogs.$inferSelect;
export type NewRequestLog = typeof requestLogs.$inferInsert;

export type UsageStat = typeof usageStats.$inferSelect;
export type NewUsageStat = typeof usageStats.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
