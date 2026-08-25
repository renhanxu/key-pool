-- ============================================================
-- 初始迁移脚本 - 密钥池中转站数据库表结构
-- 适配 Cloudflare D1（SQLite）
-- ============================================================

-- 1. 用户表 users
CREATE TABLE IF NOT EXISTS `users` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `username` TEXT NOT NULL,
  `password_hash` TEXT NOT NULL,
  `role` TEXT NOT NULL DEFAULT 'user',
  `display_name` TEXT,
  `email` TEXT,
  `status` TEXT NOT NULL DEFAULT 'active',
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `last_login_at` INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_idx` ON `users` (`username`);
CREATE INDEX IF NOT EXISTS `users_role_idx` ON `users` (`role`);

-- 2. 渠道表 channels
CREATE TABLE IF NOT EXISTS `channels` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `base_url` TEXT NOT NULL,
  `cf_account_id` TEXT,
  `cf_gateway_id` TEXT,
  `group_tag` TEXT,
  `weight` INTEGER NOT NULL DEFAULT 100,
  `priority` INTEGER NOT NULL DEFAULT 0,
  `qps_limit` INTEGER DEFAULT 60,
  `concurrent_limit` INTEGER DEFAULT 10,
  `timeout_ms` INTEGER DEFAULT 30000,
  `status` TEXT NOT NULL DEFAULT 'enabled',
  `custom_headers` TEXT,
  `extra_config` TEXT,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS `channels_type_idx` ON `channels` (`type`);
CREATE INDEX IF NOT EXISTS `channels_status_idx` ON `channels` (`status`);
CREATE INDEX IF NOT EXISTS `channels_group_idx` ON `channels` (`group_tag`);

-- 3. 渠道 Key 表 channel_keys
CREATE TABLE IF NOT EXISTS `channel_keys` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `channel_id` TEXT NOT NULL,
  `provider_label` TEXT,
  `key_value` TEXT NOT NULL,
  `key_masked` TEXT NOT NULL,
  `aig_token` TEXT,
  `aig_token_masked` TEXT,
  `byok_mode` INTEGER NOT NULL DEFAULT 0,
  `status` TEXT NOT NULL DEFAULT 'enabled',
  `note` TEXT,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS `channel_keys_channel_idx` ON `channel_keys` (`channel_id`);
CREATE INDEX IF NOT EXISTS `channel_keys_status_idx` ON `channel_keys` (`status`);

-- 4. 渠道模型映射 channel_models
CREATE TABLE IF NOT EXISTS `channel_models` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `channel_id` TEXT NOT NULL,
  `alias_name` TEXT NOT NULL,
  `real_model` TEXT NOT NULL,
  `prefix` TEXT,
  `suffix` TEXT,
  `enabled` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS `channel_models_channel_idx` ON `channel_models` (`channel_id`);
CREATE INDEX IF NOT EXISTS `channel_models_alias_idx` ON `channel_models` (`alias_name`);
CREATE UNIQUE INDEX IF NOT EXISTS `channel_models_channel_alias_idx` ON `channel_models` (`channel_id`, `alias_name`);

-- 5. 聚合密钥表 aggregate_keys
CREATE TABLE IF NOT EXISTS `aggregate_keys` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `owner_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `key_value` TEXT NOT NULL UNIQUE,
  `key_masked` TEXT NOT NULL,
  `ip_whitelist` TEXT,
  `qps_limit` INTEGER DEFAULT 60,
  `expires_at` INTEGER,
  `status` TEXT NOT NULL DEFAULT 'enabled',
  `note` TEXT,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS `aggregate_keys_owner_idx` ON `aggregate_keys` (`owner_id`);
CREATE INDEX IF NOT EXISTS `aggregate_keys_status_idx` ON `aggregate_keys` (`status`);

-- 6. 聚合密钥绑定关系 aggregate_key_bindings
CREATE TABLE IF NOT EXISTS `aggregate_key_bindings` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `aggregate_key_id` TEXT NOT NULL,
  `channel_id` TEXT NOT NULL,
  `model_alias` TEXT NOT NULL,
  `fallback_models` TEXT,
  `enabled` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`aggregate_key_id`) REFERENCES `aggregate_keys`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS `agg_bindings_agg_idx` ON `aggregate_key_bindings` (`aggregate_key_id`);
CREATE INDEX IF NOT EXISTS `agg_bindings_channel_idx` ON `aggregate_key_bindings` (`channel_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `agg_bindings_unique_idx` ON `aggregate_key_bindings` (`aggregate_key_id`, `channel_id`, `model_alias`);

-- 7. 渠道健康状态 channel_health_state
CREATE TABLE IF NOT EXISTS `channel_health_state` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `channel_id` TEXT NOT NULL,
  `key_id` TEXT NOT NULL,
  `model_alias` TEXT NOT NULL,
  `status` TEXT NOT NULL DEFAULT 'healthy',
  `failure_count` INTEGER NOT NULL DEFAULT 0,
  `cooling_until` INTEGER,
  `last_error_type` TEXT,
  `last_error_message` TEXT,
  `last_success_at` INTEGER,
  `last_failure_at` INTEGER,
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`key_id`) REFERENCES `channel_keys`(`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS `health_composite_idx` ON `channel_health_state` (`channel_id`, `key_id`, `model_alias`);
CREATE INDEX IF NOT EXISTS `health_status_idx` ON `channel_health_state` (`status`);

-- 8. 请求日志 request_logs
CREATE TABLE IF NOT EXISTS `request_logs` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `aggregate_key_id` TEXT,
  `owner_id` TEXT,
  `channel_id` TEXT,
  `channel_key_id` TEXT,
  `model_alias` TEXT,
  `real_model` TEXT,
  `is_stream` INTEGER NOT NULL DEFAULT 0,
  `status_code` INTEGER,
  `error_type` TEXT,
  `error_message` TEXT,
  `input_tokens` INTEGER DEFAULT 0,
  `output_tokens` INTEGER DEFAULT 0,
  `total_tokens` INTEGER DEFAULT 0,
  `duration_ms` INTEGER,
  `ttfb_ms` INTEGER,
  `client_ip` TEXT,
  `user_agent` TEXT,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`aggregate_key_id`) REFERENCES `aggregate_keys`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`channel_key_id`) REFERENCES `channel_keys`(`id`) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS `request_logs_agg_idx` ON `request_logs` (`aggregate_key_id`);
CREATE INDEX IF NOT EXISTS `request_logs_owner_idx` ON `request_logs` (`owner_id`);
CREATE INDEX IF NOT EXISTS `request_logs_channel_idx` ON `request_logs` (`channel_id`);
CREATE INDEX IF NOT EXISTS `request_logs_status_idx` ON `request_logs` (`status_code`);
CREATE INDEX IF NOT EXISTS `request_logs_created_at_idx` ON `request_logs` (`created_at`);

-- 9. 用量统计预聚合表 usage_stats
CREATE TABLE IF NOT EXISTS `usage_stats` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `bucket` TEXT NOT NULL,
  `granularity` TEXT NOT NULL,
  `aggregate_key_id` TEXT,
  `channel_id` TEXT,
  `model_alias` TEXT,
  `request_count` INTEGER NOT NULL DEFAULT 0,
  `success_count` INTEGER NOT NULL DEFAULT 0,
  `failure_count` INTEGER NOT NULL DEFAULT 0,
  `input_tokens` INTEGER NOT NULL DEFAULT 0,
  `output_tokens` INTEGER NOT NULL DEFAULT 0,
  `total_tokens` INTEGER NOT NULL DEFAULT 0,
  `avg_duration_ms` INTEGER NOT NULL DEFAULT 0,
  `updated_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`aggregate_key_id`) REFERENCES `aggregate_keys`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS `usage_stats_bucket_idx` ON `usage_stats` (`bucket`, `granularity`);
CREATE INDEX IF NOT EXISTS `usage_stats_agg_idx` ON `usage_stats` (`aggregate_key_id`);
CREATE INDEX IF NOT EXISTS `usage_stats_channel_idx` ON `usage_stats` (`channel_id`);

-- 10. 审计日志 audit_logs
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `actor_id` TEXT,
  `actor_username` TEXT,
  `action` TEXT NOT NULL,
  `target_type` TEXT,
  `target_id` TEXT,
  `detail` TEXT,
  `client_ip` TEXT,
  `created_at` INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS `audit_logs_actor_idx` ON `audit_logs` (`actor_id`);
CREATE INDEX IF NOT EXISTS `audit_logs_action_idx` ON `audit_logs` (`action`);
CREATE INDEX IF NOT EXISTS `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);
