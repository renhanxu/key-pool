/**
 * 数据库连接（Drizzle ORM + Cloudflare D1）
 */

import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DB = DrizzleD1Database<typeof schema>;

/**
 * 创建 Drizzle 数据库实例
 * @param d1 Cloudflare D1 数据库绑定
 */
export function createDb(d1: D1Database): DB {
  return drizzle(d1, { schema });
}

export { schema };
