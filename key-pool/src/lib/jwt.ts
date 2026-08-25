/**
 * JWT 工具
 */

import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: "admin" | "user";
  type: "access" | "refresh";
}

/**
 * 签名 access token（短期：2 小时）
 */
export async function signAccessToken(
  payload: Omit<JwtPayload, "type">,
  secret: string
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  return await new SignJWT({ ...payload, type: "access" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("2h")
    .setIssuer("key-pool")
    .sign(secretKey);
}

/**
 * 签名 refresh token（长期：7 天）
 */
export async function signRefreshToken(
  payload: Omit<JwtPayload, "type">,
  secret: string
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  return await new SignJWT({ ...payload, type: "refresh" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer("key-pool")
    .sign(secretKey);
}

/**
 * 验证 token
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: "key-pool",
    });
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 从 Authorization 头提取 token
 */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
