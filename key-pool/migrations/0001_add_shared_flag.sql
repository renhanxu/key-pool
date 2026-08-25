-- 0001 增加聚合密钥「共享」标志
-- 用于支持管理员把某个聚合密钥设置为对全平台所有用户可见（公共密钥）
ALTER TABLE aggregate_keys ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;
