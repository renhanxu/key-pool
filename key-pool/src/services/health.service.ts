/**
 * 健康状态管理服务（基于 Cloudflare KV）
 * 核心：实现智能选择、故障转移、冷却机制
 */

import { DB } from "../db";
import { Bindings } from "../types";
import { channelHealthState, channelKeys, channels, channelModels } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/password";

export type HealthStatus = "healthy" | "cooling" | "disabled";
export type ErrorType = "timeout" | "rate_limit" | "auth_fail" | "server_error" | "bad_request" | "not_found" | "success" | "unknown";

/**
 * KV 中存储的健康状态结构
 */
export interface HealthState {
  status: HealthStatus;
  failureCount: number;
  coolingUntil: number; // ms timestamp
  lastErrorType?: ErrorType;
  lastErrorMessage?: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

/**
 * 组合标识 KV key
 */
export function makeHealthKvKey(channelId: string, keyId: string, modelAlias: string): string {
  return `health:${channelId}:${keyId}:${modelAlias}`;
}

export class HealthService {
  constructor(
    private db: DB,
    private kv: KVNamespace,
    private env: Bindings
  ) {}

  /**
   * 获取单个组合的健康状态
   */
  async getState(channelId: string, keyId: string, modelAlias: string): Promise<HealthState> {
    const kvKey = makeHealthKvKey(channelId, keyId, modelAlias);
    const raw = await this.kv.get(kvKey);
    
    if (!raw) {
      return { status: "healthy", failureCount: 0, coolingUntil: 0 };
    }
    
    const state = JSON.parse(raw) as HealthState;
    
    // 自动恢复：如果 cooling 期间已过，恢复 healthy
    if (state.status === "cooling" && state.coolingUntil < Date.now()) {
      const newState: HealthState = {
        ...state,
        status: "healthy",
        coolingUntil: 0,
      };
      await this.kv.put(kvKey, JSON.stringify(newState));
      return newState;
    }
    
    return state;
  }

  /**
   * 标记成功
   */
  async markSuccess(channelId: string, keyId: string, modelAlias: string): Promise<void> {
    const kvKey = makeHealthKvKey(channelId, keyId, modelAlias);
    const newState: HealthState = {
      status: "healthy",
      failureCount: 0,
      coolingUntil: 0,
      lastSuccessAt: Date.now(),
    };
    await this.kv.put(kvKey, JSON.stringify(newState));
    
    // 异步同步到 D1（fire and forget）
    this.db
      .update(channelHealthState)
      .set({
        status: "healthy",
        failureCount: 0,
        coolingUntil: null,
        lastSuccessAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(channelHealthState.channelId, channelId),
        eq(channelHealthState.keyId, keyId),
        eq(channelHealthState.modelAlias, modelAlias)
      ))
      .run()
      .catch(() => {});
  }

  /**
   * 标记失败
   * 401/403 鉴权失败：直接 disabled（不可恢复，需要人工介入）
   * 其它失败：触发冷却机制
   */
  async markFailure(
    channelId: string,
    keyId: string,
    modelAlias: string,
    errorType: ErrorType,
    errorMessage?: string
  ): Promise<HealthState> {
    const old = await this.getState(channelId, keyId, modelAlias);
    const now = Date.now();
    
    // 鉴权失败：直接 disabled
    if (errorType === "auth_fail") {
      const newState: HealthState = {
        status: "disabled",
        failureCount: old.failureCount + 1,
        coolingUntil: 0,
        lastErrorType: errorType,
        lastErrorMessage: errorMessage,
        lastFailureAt: now,
      };
      await this.kv.put(makeHealthKvKey(channelId, keyId, modelAlias), JSON.stringify(newState));
      this.syncToDb(channelId, keyId, modelAlias, newState).catch(() => {});
      return newState;
    }
    
    // 临时故障：触发冷却
    const newFailureCount = old.failureCount + 1;
    const baseSeconds = parseInt(this.env.COOLING_BASE_SECONDS || "30", 10);
    const maxSeconds = parseInt(this.env.COOLING_MAX_SECONDS || "1800", 10);
    const threshold = parseInt(this.env.COOLING_FAILURE_THRESHOLD || "5", 10);
    
    // 指数退避
    let coolingSeconds = baseSeconds;
    for (let i = 1; i < newFailureCount; i++) {
      coolingSeconds = Math.min(coolingSeconds * 2, maxSeconds);
    }
    
    const coolingUntil = now + coolingSeconds * 1000;
    
    let newStatus: HealthStatus = "cooling";
    if (newFailureCount >= threshold) {
      newStatus = "disabled";
    }
    
    const newState: HealthState = {
      status: newStatus,
      failureCount: newFailureCount,
      coolingUntil: newStatus === "cooling" ? coolingUntil : 0,
      lastErrorType: errorType,
      lastErrorMessage: errorMessage,
      lastFailureAt: now,
    };
    
    await this.kv.put(makeHealthKvKey(channelId, keyId, modelAlias), JSON.stringify(newState));
    this.syncToDb(channelId, keyId, modelAlias, newState).catch(() => {});
    
    return newState;
  }

  /**
   * 同步到 D1（仅用于历史查看）
   */
  private async syncToDb(
    channelId: string,
    keyId: string,
    modelAlias: string,
    state: HealthState
  ): Promise<void> {
    const id = `${channelId}_${keyId}_${modelAlias}`;
    
    // upsert
    const existing = await this.db
      .select()
      .from(channelHealthState)
      .where(and(
        eq(channelHealthState.channelId, channelId),
        eq(channelHealthState.keyId, keyId),
        eq(channelHealthState.modelAlias, modelAlias)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      await this.db
        .update(channelHealthState)
        .set({
          status: state.status,
          failureCount: state.failureCount,
          coolingUntil: state.coolingUntil ? new Date(state.coolingUntil) : null,
          lastErrorType: state.lastErrorType || null,
          lastErrorMessage: state.lastErrorMessage || null,
          lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt) : null,
          lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(channelHealthState.id, existing[0].id));
    } else {
      await this.db.insert(channelHealthState).values({
        id,
        channelId,
        keyId,
        modelAlias,
        status: state.status,
        failureCount: state.failureCount,
        coolingUntil: state.coolingUntil ? new Date(state.coolingUntil) : null,
        lastErrorType: state.lastErrorType || null,
        lastErrorMessage: state.lastErrorMessage || null,
        lastSuccessAt: state.lastSuccessAt ? new Date(state.lastFailureAt!) : null,
        lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt) : null,
      });
    }
  }

  /**
   * 列出所有组合的当前健康状态
   */
  async listAllStates(): Promise<Array<{
    channelId: string;
    channelName: string;
    keyId: string;
    keyMasked: string;
    modelAlias: string;
    state: HealthState;
  }>> {
    // 获取所有启用的渠道、Key、模型
    const channelRows = await this.db.select().from(channels).where(eq(channels.status, "enabled"));
    const result: Array<{
      channelId: string;
      channelName: string;
      keyId: string;
      keyMasked: string;
      modelAlias: string;
      state: HealthState;
    }> = [];
    
    for (const ch of channelRows) {
      const keyRows = await this.db
        .select()
        .from(channelKeys)
        .where(and(
          eq(channelKeys.channelId, ch.id),
          eq(channelKeys.status, "enabled")
        ));
      const modelRows = await this.db
        .select()
        .from(channelModels)
        .where(and(
          eq(channelModels.channelId, ch.id),
          eq(channelModels.enabled, true)
        ));
      
      for (const key of keyRows) {
        for (const model of modelRows) {
          const state = await this.getState(ch.id, key.id, model.aliasName);
          result.push({
            channelId: ch.id,
            channelName: ch.name,
            keyId: key.id,
            keyMasked: key.keyMasked,
            modelAlias: model.aliasName,
            state,
          });
        }
      }
    }
    
    return result;
  }

  /**
   * 手动重置某个组合为 healthy
   */
  async reset(channelId: string, keyId: string, modelAlias: string): Promise<void> {
    await this.markSuccess(channelId, keyId, modelAlias);
  }

  /**
   * 智能选择：过滤可用的组合，按权重加权随机选一个
   */
  async selectHealthy(
    candidates: Array<{
      channelId: string;
      keyId: string;
      modelAlias: string;
      weight: number;
    }>
  ): Promise<{ channelId: string; keyId: string; modelAlias: string } | null> {
    if (candidates.length === 0) return null;
    
    // 批量获取所有候选的状态
    const states = await Promise.all(
      candidates.map((c) => this.getState(c.channelId, c.keyId, c.modelAlias))
    );
    
    // 过滤 healthy
    const healthy = candidates.filter((_, i) => states[i].status === "healthy");
    if (healthy.length === 0) return null;
    
    // 加权随机
    const totalWeight = healthy.reduce((sum, c) => sum + c.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const candidate of healthy) {
      pick -= candidate.weight;
      if (pick <= 0) return candidate;
    }
    
    return healthy[0];
  }
}
