/**
 * 工具函数 - 加密 / 随机字符串 / 密钥脱敏
 */

import bcrypt from "bcryptjs";

/**
 * 哈希密码
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * 生成随机字符串（默认 32 字符 URL-safe）
 */
export function randomString(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * 生成聚合密钥：sk-xxxx 格式
 */
export function generateAggregateKey(): string {
  return `sk-${randomString(48)}`;
}

/**
 * 生成 ID
 */
export function generateId(prefix?: string): string {
  // 使用 ulid（按时间排序）
  // 简化版本，使用 crypto.randomUUID
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/**
 * 密钥脱敏：仅展示前 4 位 + 后 4 位
 */
export function maskKey(key: string): string {
  if (!key || key.length <= 8) return "****";
  return `${key.slice(0, 4)}${"*".repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

/**
 * API Key / AIG Token 加密存储
 *
 * 使用 Web Crypto AES-GCM（256-bit）加密，密钥由环境变量 KEY_ENCRYPTION_KEY
 * 经 SHA-256 派生。若未配置 KEY_ENCRYPTION_KEY，则降级为 base64（仅避免明文，
 * 不安全，会在日志中告警）。建议生产环境务必通过 `wrangler secret put KEY_ENCRYPTION_KEY`
 * 设置一个足够随机的密钥。
 *
 * 存储格式：`aes:<base64(iv + ciphertext)>` 或旧格式 `b64:<base64>`（兼容历史数据）。
 */

let ENCRYPTION_SECRET: string | undefined;

/** 由 index.ts 在每次请求时注入（来自 c.env.KEY_ENCRYPTION_KEY） */
export function setEncryptionSecret(secret?: string): void {
  ENCRYPTION_SECRET = secret;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function aesEncrypt(plaintext: string): Promise<string> {
  const key = await deriveKey(ENCRYPTION_SECRET!);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.length);
  return "aes:" + bytesToBase64(buf);
}

async function aesDecrypt(payload: string): Promise<string> {
  const buf = base64ToBytes(payload);
  const iv = buf.slice(0, 12);
  const data = buf.slice(12);
  const key = await deriveKey(ENCRYPTION_SECRET!);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}

export async function encryptKey(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  if (!ENCRYPTION_SECRET) {
    console.warn("[encryptKey] KEY_ENCRYPTION_KEY 未配置，降级为 base64（不安全，仅用于本地开发）");
    return "b64:" + bytesToBase64(new TextEncoder().encode(plaintext));
  }
  return await aesEncrypt(plaintext);
}

export async function decryptKey(ciphertext: string): Promise<string> {
  if (!ciphertext) return "";
  try {
    if (ciphertext.startsWith("aes:")) {
      if (!ENCRYPTION_SECRET) {
        console.warn("[decryptKey] KEY_ENCRYPTION_KEY 未配置，无法解密 aes 格式");
        return "";
      }
      return await aesDecrypt(ciphertext.slice(4));
    }
    // 兼容旧 base64 格式（含 "b64:" 前缀或无前缀）
    const b64 = ciphertext.startsWith("b64:") ? ciphertext.slice(4) : ciphertext;
    return new TextDecoder().decode(base64ToBytes(b64));
  } catch (err) {
    console.error("[decryptKey] 解密失败：", err);
    return "";
  }
}
