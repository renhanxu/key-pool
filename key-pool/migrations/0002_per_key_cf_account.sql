-- ============================================================
-- 迁移 0002：为 channel_keys 增加每把 Key 独立的 Cloudflare 账户字段
-- 目的：支持「多账户统一」——同一个 Cloudflare 渠道（密钥池）下，
--       不同的 Key 可归属不同的 Cloudflare 账户 / Gateway，
--       避免每个 CF 账户都要新建一个密钥池。
-- ============================================================

ALTER TABLE `channel_keys` ADD COLUMN `cf_account_id` TEXT;
ALTER TABLE `channel_keys` ADD COLUMN `cf_gateway_id` TEXT;
CREATE INDEX IF NOT EXISTS `channel_keys_cf_account_idx` ON `channel_keys` (`cf_account_id`);
