/**
 * 渠道管理服务
 */

import { eq, and, desc, ne } from "drizzle-orm";
import { DB } from "../db";
import {
  channels,
  channelKeys,
  channelModels,
  Channel,
  NewChannel,
} from "../db/schema";
import { generateId, maskKey, encryptKey } from "../lib/password";
import { isCloudflareAigChannel } from "../lib/ai-gateway";
import { BusinessError, NotFoundError } from "../lib/response";

export interface CreateChannelKeyInput {
  label?: string;
  key?: string;
  aigToken?: string;
  byokMode?: boolean;
  cfAccountId?: string;
  cfGatewayId?: string;
}

export interface CreateChannelInput {
  name: string;
  type: Channel["type"];
  baseUrl?: string;
  cfAccountId?: string;
  cfGatewayId?: string;
  groupTag?: string;
  weight?: number;
  priority?: number;
  qpsLimit?: number;
  concurrentLimit?: number;
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
  extraConfig?: Record<string, any>;
  keys: Array<string | CreateChannelKeyInput>;
}

export interface UpdateChannelInput {
  name?: string;
  baseUrl?: string;
  cfAccountId?: string | null;
  cfGatewayId?: string | null;
  groupTag?: string;
  weight?: number;
  priority?: number;
  qpsLimit?: number;
  concurrentLimit?: number;
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
  extraConfig?: Record<string, any>;
  status?: Channel["status"];
}

export class ChannelService {
  constructor(private db: DB) {}

  /**
   * 创建渠道 + 批量录入 Key
   */
  async create(input: CreateChannelInput): Promise<Channel> {
    const channelId = generateId("ch");

    // baseUrl：AI Gateway 类型不需要真实 baseUrl，用网关域名占位；其它类型必填
    const isAig = isCloudflareAigChannel(input.type);
    const baseUrl = input.baseUrl?.trim() || (isAig ? "https://gateway.ai.cloudflare.com" : "");
    if (!baseUrl) {
      throw new BusinessError("baseUrl is required for non-AI-Gateway channels");
    }

    // 解析并去重 Key（支持字符串或对象形式）
    const parsedKeys: CreateChannelKeyInput[] = input.keys
      .map((k) => (typeof k === "string" ? { key: k } : k))
      .map((k) => ({
        label: k.label?.trim() || undefined,
        key: k.key?.trim() || undefined,
        aigToken: k.aigToken?.trim() || undefined,
        byokMode: !!k.byokMode,
        cfAccountId: k.cfAccountId?.trim() || undefined,
        cfGatewayId: k.cfGatewayId?.trim() || undefined,
      }));

    const validKeys = parsedKeys.filter((k) => k.key || k.aigToken || k.byokMode);
    if (validKeys.length === 0) {
      throw new BusinessError("At least one valid key (key / aigToken / byokMode) is required");
    }

    // 插入渠道
    await this.db.insert(channels).values({
      id: channelId,
      name: input.name,
      type: input.type,
      baseUrl,
      cfAccountId: input.cfAccountId || null,
      cfGatewayId: input.cfGatewayId || null,
      groupTag: input.groupTag || null,
      weight: input.weight ?? 100,
      priority: input.priority ?? 0,
      qpsLimit: input.qpsLimit ?? 60,
      concurrentLimit: input.concurrentLimit ?? 10,
      timeoutMs: input.timeoutMs ?? 30000,
      customHeaders: input.customHeaders ? JSON.stringify(input.customHeaders) : null,
      extraConfig: input.extraConfig ? JSON.stringify(input.extraConfig) : null,
      status: "enabled",
    });

    // 批量插入 Key
    const seen = new Set<string>();
    for (const k of validKeys) {
      const masked = k.key ? maskKey(k.key) : "(BYOK)";
      if (k.key && seen.has(masked)) continue;
      if (k.key) seen.add(masked);
      await this.db.insert(channelKeys).values({
        id: generateId("ck"),
        channelId,
        providerLabel: k.label || null,
        keyValue: k.key ? await encryptKey(k.key) : "",
        keyMasked: masked,
        aigToken: k.aigToken ? await encryptKey(k.aigToken) : null,
        aigTokenMasked: k.aigToken ? maskKey(k.aigToken) : null,
        cfAccountId: k.cfAccountId || null,
        cfGatewayId: k.cfGatewayId || null,
        byokMode: k.byokMode,
        status: "enabled",
      });
    }

    const result = await this.getById(channelId);
    if (!result) throw new NotFoundError("Channel not found after creation");
    return result;
  }

  /**
   * 根据 ID 获取渠道
   */
  async getById(id: string): Promise<Channel | null> {
    const [row] = await this.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    return row || null;
  }

  /**
   * 列出所有渠道
   */
  async list(filters: { status?: Channel["status"]; type?: string } = {}): Promise<Channel[]> {
    const conditions = [ne(channels.status, "deleted")];
    if (filters.status) {
      conditions.push(eq(channels.status, filters.status));
    }
    if (filters.type) {
      conditions.push(eq(channels.type, filters.type as any));
    }
    return await this.db
      .select()
      .from(channels)
      .where(and(...conditions))
      .orderBy(desc(channels.createdAt));
  }

  /**
   * 更新渠道
   */
  async update(id: string, input: UpdateChannelInput): Promise<Channel> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError("Channel not found");
    
    const updateData: Partial<NewChannel> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.baseUrl !== undefined) updateData.baseUrl = input.baseUrl;
    if (input.cfAccountId !== undefined) updateData.cfAccountId = input.cfAccountId;
    if (input.cfGatewayId !== undefined) updateData.cfGatewayId = input.cfGatewayId;
    if (input.groupTag !== undefined) updateData.groupTag = input.groupTag;
    if (input.weight !== undefined) updateData.weight = input.weight;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.qpsLimit !== undefined) updateData.qpsLimit = input.qpsLimit;
    if (input.concurrentLimit !== undefined) updateData.concurrentLimit = input.concurrentLimit;
    if (input.timeoutMs !== undefined) updateData.timeoutMs = input.timeoutMs;
    if (input.customHeaders !== undefined) updateData.customHeaders = JSON.stringify(input.customHeaders);
    if (input.extraConfig !== undefined) updateData.extraConfig = JSON.stringify(input.extraConfig);
    if (input.status !== undefined) updateData.status = input.status;
    
    await this.db.update(channels).set(updateData).where(eq(channels.id, id));
    
    const result = await this.getById(id);
    if (!result) throw new NotFoundError("Channel not found after update");
    return result;
  }

  /**
   * 软删除渠道
   */
  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError("Channel not found");
    
    await this.db.update(channels)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(eq(channels.id, id));
  }

  /**
   * 添加 Key（去重）
   * keys 接受字符串数组或对象数组，对象数组用于指定 provider 账户、aigToken、byokMode
   */
  async addKeys(
    channelId: string,
    keys: Array<
      string | { label?: string; key?: string; aigToken?: string; byokMode?: boolean; cfAccountId?: string; cfGatewayId?: string }
    >
  ): Promise<number> {
    const existing = await this.getById(channelId);
    if (!existing) throw new NotFoundError("Channel not found");
    
    const existingKeys = await this.db
      .select()
      .from(channelKeys)
      .where(eq(channelKeys.channelId, channelId));
    
    const existingSet = new Set(existingKeys.map((k) => k.keyMasked));
    let added = 0;
    
    for (const item of keys) {
      const isString = typeof item === "string";
      const key = isString ? item : item.key;
      const label = isString ? undefined : item.label;
      const aigToken = isString ? undefined : item.aigToken;
      const byokMode = isString ? false : !!item.byokMode;
      const cfAccountId = isString ? undefined : (item as any).cfAccountId?.trim() || undefined;
      const cfGatewayId = isString ? undefined : (item as any).cfGatewayId?.trim() || undefined;
      
      const trimmed = (key || "").trim();
      if (!trimmed && !byokMode) continue;
      
      // BYOK 模式下 key 可以为空（只用 aigToken）
      const masked = trimmed ? maskKey(trimmed) : "(BYOK)";
      if (trimmed && existingSet.has(masked)) continue;
      
      await this.db.insert(channelKeys).values({
        id: generateId("ck"),
        channelId,
        providerLabel: label || null,
        keyValue: trimmed ? await encryptKey(trimmed) : "",
        keyMasked: masked,
        aigToken: aigToken ? await encryptKey(aigToken) : null,
        aigTokenMasked: aigToken ? maskKey(aigToken) : null,
        cfAccountId: cfAccountId || null,
        cfGatewayId: cfGatewayId || null,
        byokMode,
        status: "enabled",
      });
      added++;
    }
    
    return added;
  }

  /**
   * 删除 Key
   */
  async deleteKey(keyId: string): Promise<void> {
    await this.db.delete(channelKeys).where(eq(channelKeys.id, keyId));
  }

  /**
   * 列出渠道下所有 Key
   */
  async listKeys(channelId: string) {
    return await this.db
      .select()
      .from(channelKeys)
      .where(eq(channelKeys.channelId, channelId));
  }

  /**
   * 添加模型映射
   */
  async addModel(
    channelId: string,
    model: { aliasName: string; realModel: string; prefix?: string; suffix?: string }
  ) {
    const existing = await this.getById(channelId);
    if (!existing) throw new NotFoundError("Channel not found");
    
    const id = generateId("cm");
    await this.db.insert(channelModels).values({
      id,
      channelId,
      aliasName: model.aliasName,
      realModel: model.realModel,
      prefix: model.prefix || null,
      suffix: model.suffix || null,
      enabled: true,
    });
    
    return { id, ...model };
  }

  /**
   * 批量添加模型映射
   */
  async addModels(
    channelId: string,
    models: Array<{ aliasName: string; realModel: string; prefix?: string; suffix?: string }>
  ) {
    const results = [];
    for (const m of models) {
      results.push(await this.addModel(channelId, m));
    }
    return results;
  }

  /**
   * 删除模型映射
   */
  async deleteModel(modelId: string): Promise<void> {
    await this.db.delete(channelModels).where(eq(channelModels.id, modelId));
  }

  /**
   * 列出渠道的模型映射
   */
  async listModels(channelId: string) {
    return await this.db
      .select()
      .from(channelModels)
      .where(eq(channelModels.channelId, channelId));
  }

  /**
   * 启用/禁用 Key
   */
  async toggleKey(keyId: string, status: "enabled" | "disabled"): Promise<void> {
    await this.db
      .update(channelKeys)
      .set({ status, updatedAt: new Date() })
      .where(eq(channelKeys.id, keyId));
  }
}
