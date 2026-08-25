/**
 * 全局类型定义
 */

import { Context } from "hono";
import { DB } from "./db";

/**
 * Cloudflare Workers 环境变量
 */
export interface Bindings {
  // 数据库
  DB: D1Database;
  
  // KV 存储
  HEALTH_KV: KVNamespace;
  
  // 环境变量 (.dev.vars)
  JWT_SECRET: string;
  KEY_ENCRYPTION_KEY?: string;
  ADMIN_INIT_PASSWORD: string;
  ADMIN_INIT_USERNAME: string;
  
  // 逻辑配置
  LOG_LEVEL: string;
  DEFAULT_TIMEOUT_MS: string;
  COOLING_BASE_SECONDS: string;
  COOLING_MAX_SECONDS: string;
  COOLING_FAILURE_THRESHOLD: string;
  HEALTH_CHECK_INTERVAL_MINUTES: string;
}

/**
 * Hono 变量（中间件传递）
 */
export interface Variables {
  db: DB;
  user: {
    id: string;
    username: string;
    role: "admin" | "user";
  };
  requestId: string;
  aggregateKeyId?: string;
  ownerId?: string;
}

/**
 * Hono 上下文
 */
export type HonoContext = Context<{ Bindings: Bindings; Variables: Variables }>;
