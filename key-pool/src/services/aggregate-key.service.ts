/**
 * 聚合密钥管理服务
 */

import { eq, and, desc, or } from "drizzle-orm";
import { DB } from "../db";
import {
  aggregateKeys,
  aggregateKeyBindings,
  channels,
  channelKeys,
  channelModels,
  users,
  AggregateKey,
  NewAggregateKey,
} from "../db/schema";
import { generateId, generateAggregateKey, maskKey } from "../lib/password";
import { BusinessError, NotFoundError, ConflictError } from "../lib/response";

export interface CreateAggregateKeyInput {
  ownerId: string;
  name: string;
  ipWhitelist?: string[];
  qpsLimit?: number;
  expiresAt?: Date;
  note?: string;
  isShared?: boolean;
  bindings: Array<{
    channelId: string;
    modelAlias: string;
    fallbackModels?: string[];
  }>;
}

export interface UpdateAggregateKeyInput {
  name?: string;
  ipWhitelist?: string[];
  qpsLimit?: number;
  expiresAt?: Date | null;
  status?: "enabled" | "disabled";
  note?: string;
  isShared?: boolean;
  ownerId?: string;
  bindings?: Array<{
    channelId: string;
    modelAlias: string;
    fallbackModels?: string[];
  }>;
}

export interface AggregateKeyWithOwner extends AggregateKey {
  ownerUsername: string | null;
}

export class AggregateKeyService {
  constructor(private db: DB) {}

  /**
   * 创建聚合密钥
   */
  async create(input: CreateAggregateKeyInput): Promise<AggregateKey> {
    if (input.bindings.length === 0) {
      throw new BusinessError("At least one binding is required");
    }
    
    const id = generateId("ak");
    const keyValue = generateAggregateKey();
    const keyMasked = maskKey(keyValue);
    
    await this.db.insert(aggregateKeys).values({
      id,
      ownerId: input.ownerId,
      name: input.name,
      keyValue,
      keyMasked,
      ipWhitelist: input.ipWhitelist ? JSON.stringify(input.ipWhitelist) : null,
      qpsLimit: input.qpsLimit ?? 60,
      expiresAt: input.expiresAt || null,
      status: "enabled",
      isShared: input.isShared ?? false,
      note: input.note || null,
    });
    
    // 批量插入绑定关系
    for (const b of input.bindings) {
      await this.db.insert(aggregateKeyBindings).values({
        id: generateId("ab"),
        aggregateKeyId: id,
        channelId: b.channelId,
        modelAlias: b.modelAlias,
        fallbackModels: b.fallbackModels ? JSON.stringify(b.fallbackModels) : null,
        enabled: true,
      });
    }
    
    const result = await this.getById(id);
    if (!result) throw new NotFoundError("Aggregate key not found after creation");
    return result;
  }

  /**
   * 根据 ID 获取
   */
  async getById(id: string): Promise<AggregateKey | null> {
    const [row] = await this.db
      .select()
      .from(aggregateKeys)
      .where(eq(aggregateKeys.id, id))
      .limit(1);
    return row || null;
  }

  /**
   * 根据 keyValue 获取（用于鉴权）
   */
  async getByKeyValue(keyValue: string): Promise<AggregateKey | null> {
    const [row] = await this.db
      .select()
      .from(aggregateKeys)
      .where(eq(aggregateKeys.keyValue, keyValue))
      .limit(1);
    return row || null;
  }

  /**
   * 列出聚合密钥
   * - 管理员：返回全部（含 ownerUsername）
   * - 普通用户：返回「自己的」+「共享给所有人的」
   */
  async listByOwner(
    ownerId: string,
    isAdmin = false
  ): Promise<AggregateKeyWithOwner[]> {
    const base = this.db
      .select()
      .from(aggregateKeys)
      .leftJoin(users, eq(aggregateKeys.ownerId, users.id));

    const rows = isAdmin
      ? await base.orderBy(desc(aggregateKeys.createdAt))
      : await base
          .where(
            or(
              eq(aggregateKeys.ownerId, ownerId),
              eq(aggregateKeys.isShared, true)
            )
          )
          .orderBy(desc(aggregateKeys.createdAt));

    return rows.map((r) => ({
      ...r.aggregate_keys,
      ownerUsername: r.users?.username ?? null,
    }));
  }

  /**
   * 更新聚合密钥
   */
  async update(id: string, input: UpdateAggregateKeyInput): Promise<AggregateKey> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError("Aggregate key not found");
    
    const updateData: Partial<NewAggregateKey> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.ipWhitelist !== undefined) updateData.ipWhitelist = JSON.stringify(input.ipWhitelist);
    if (input.qpsLimit !== undefined) updateData.qpsLimit = input.qpsLimit;
    if (input.expiresAt !== undefined) updateData.expiresAt = input.expiresAt;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.note !== undefined) updateData.note = input.note;
    if (input.isShared !== undefined) updateData.isShared = input.isShared;
    if (input.ownerId !== undefined) updateData.ownerId = input.ownerId;
    
    await this.db.update(aggregateKeys).set(updateData).where(eq(aggregateKeys.id, id));
    
    // 更新绑定
    if (input.bindings) {
      // 删除旧绑定
      await this.db
        .delete(aggregateKeyBindings)
        .where(eq(aggregateKeyBindings.aggregateKeyId, id));
      
      // 插入新绑定
      for (const b of input.bindings) {
        await this.db.insert(aggregateKeyBindings).values({
          id: generateId("ab"),
          aggregateKeyId: id,
          channelId: b.channelId,
          modelAlias: b.modelAlias,
          fallbackModels: b.fallbackModels ? JSON.stringify(b.fallbackModels) : null,
          enabled: true,
        });
      }
    }
    
    const result = await this.getById(id);
    if (!result) throw new NotFoundError("Aggregate key not found after update");
    return result;
  }

  /**
   * 删除
   */
  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError("Aggregate key not found");
    await this.db.delete(aggregateKeys).where(eq(aggregateKeys.id, id));
  }

  /**
   * 列出绑定关系
   */
  async listBindings(aggregateKeyId: string) {
    return await this.db
      .select()
      .from(aggregateKeyBindings)
      .where(eq(aggregateKeyBindings.aggregateKeyId, aggregateKeyId));
  }

  /**
   * 列出所有可用组合（用于请求转发）
   * 返回聚合密钥绑定的所有 (channel, model) 组合
   */
  async listAvailableCombinations(aggregateKeyId: string) {
    return await this.db
      .select({
        binding: aggregateKeyBindings,
        channel: channels,
        model: channelModels,
      })
      .from(aggregateKeyBindings)
      .innerJoin(channels, eq(aggregateKeyBindings.channelId, channels.id))
      .innerJoin(channelModels, and(
        eq(channelModels.channelId, aggregateKeyBindings.channelId),
        eq(channelModels.aliasName, aggregateKeyBindings.modelAlias)
      ))
      .where(and(
        eq(aggregateKeyBindings.aggregateKeyId, aggregateKeyId),
        eq(aggregateKeyBindings.enabled, true),
        eq(channels.status, "enabled"),
        eq(channelModels.enabled, true)
      ));
  }
}
