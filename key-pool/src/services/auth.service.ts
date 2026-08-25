/**
 * 用户与鉴权服务
 */

import { eq, count } from "drizzle-orm";
import { DB } from "../db";
import { users, User, auditLogs, NewAuditLog } from "../db/schema";
import { generateId, hashPassword, verifyPassword } from "../lib/password";
import { signAccessToken, signRefreshToken, verifyToken, JwtPayload } from "../lib/jwt";
import { BusinessError, AuthError, NotFoundError } from "../lib/response";

export class AuthService {
  constructor(
    private db: DB,
    private jwtSecret: string
  ) {}

  /**
   * 用户登录
   */
  async login(username: string, password: string, clientIp?: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Omit<User, "passwordHash">;
  }> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    
    if (!user) {
      // 区分“系统尚未初始化（库里一个用户都没有）”与“用户名/密码错误”：
      // 首次部署若忘记跑远程 D1 迁移，管理员不会被创建，这里给出可操作的明确提示，
      // 而不是笼统的“用户名或密码错误”。
      const [{ count: userCount }] = await this.db
        .select({ count: count() })
        .from(users);
      if (Number(userCount) === 0) {
        throw new AuthError(
          "系统尚未初始化：未检测到任何用户。请确认已对 D1 执行迁移（wrangler d1 migrations apply key-pool-db --remote）且管理员初始化成功，再重试登录。"
        );
      }
      throw new AuthError("Invalid username or password");
    }
    
    if (user.status === "disabled") {
      throw new AuthError("Account is disabled");
    }
    
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AuthError("Invalid username or password");
    }
    
    // 更新最后登录时间
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    
    const accessToken = await signAccessToken(
      { sub: user.id, username: user.username, role: user.role as "admin" | "user" },
      this.jwtSecret
    );
    const refreshToken = await signRefreshToken(
      { sub: user.id, username: user.username, role: user.role as "admin" | "user" },
      this.jwtSecret
    );
    
    await this.recordAudit(user.id, user.username, "user.login", "user", user.id, clientIp);
    
    const { passwordHash, ...userWithoutPassword } = user;
    return { accessToken, refreshToken, user: userWithoutPassword as any };
  }

  /**
   * 注册用户
   */
  async register(input: {
    username: string;
    password: string;
    displayName?: string;
    email?: string;
    role?: "admin" | "user";
  }, actorId?: string, actorUsername?: string, clientIp?: string): Promise<User> {
    if (!input.username || input.username.length < 3) {
      throw new BusinessError("Username must be at least 3 characters");
    }
    if (!input.password || input.password.length < 6) {
      throw new BusinessError("Password must be at least 6 characters");
    }
    
    // 检查是否已存在
    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.username, input.username))
      .limit(1);
    
    if (existing.length > 0) {
      throw new BusinessError("Username already exists");
    }
    
    const id = generateId("u");
    const passwordHash = await hashPassword(input.password);
    
    await this.db.insert(users).values({
      id,
      username: input.username,
      passwordHash,
      role: input.role || "user",
      displayName: input.displayName || null,
      email: input.email || null,
      status: "active",
    });
    
    await this.recordAudit(
      actorId || id,
      actorUsername || input.username,
      "user.register",
      "user",
      id,
      clientIp,
      { role: input.role || "user" }
    );
    
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  /**
   * 刷新 token
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await verifyToken(refreshToken, this.jwtSecret);
    if (!payload || payload.type !== "refresh") {
      throw new AuthError("Invalid refresh token");
    }
    
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    
    if (!user || user.status !== "active") {
      throw new AuthError("User not found or disabled");
    }
    
    const accessToken = await signAccessToken(
      { sub: user.id, username: user.username, role: user.role as "admin" | "user" },
      this.jwtSecret
    );
    const newRefreshToken = await signRefreshToken(
      { sub: user.id, username: user.username, role: user.role as "admin" | "user" },
      this.jwtSecret
    );
    
    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * 修改密码
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError("User not found");
    
    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) {
      throw new AuthError("Current password is incorrect");
    }
    
    const newHash = await hashPassword(newPassword);
    await this.db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * 管理员重置密码
   */
  async resetPassword(userId: string, newPassword: string, actorId: string, actorUsername: string, clientIp?: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError("User not found");
    
    const newHash = await hashPassword(newPassword);
    await this.db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    
    await this.recordAudit(actorId, actorUsername, "user.reset_password", "user", userId, clientIp);
  }

  /**
   * 启用/禁用用户
   */
  async setUserStatus(userId: string, status: "active" | "disabled", actorId: string, actorUsername: string, clientIp?: string): Promise<void> {
    await this.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, userId));
    
    await this.recordAudit(actorId, actorUsername, "user.change_status", "user", userId, clientIp, { status });
  }

  /**
   * 删除用户
   */
  async deleteUser(userId: string, actorId: string, actorUsername: string, clientIp?: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, userId));
    await this.recordAudit(actorId, actorUsername, "user.delete", "user", userId, clientIp);
  }

  /**
   * 列出所有用户
   */
  async listUsers(): Promise<Omit<User, "passwordHash">[]> {
    const rows = await this.db.select().from(users);
    return rows.map(({ passwordHash, ...rest }) => rest as any);
  }

  /**
   * 记录审计日志
   */
  async recordAudit(
    actorId: string | null,
    actorUsername: string | null,
    action: string,
    targetType: string | null,
    targetId: string | null,
    clientIp?: string,
    detail?: any
  ): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        id: generateId("al"),
        actorId,
        actorUsername,
        action,
        targetType,
        targetId,
        detail: detail ? JSON.stringify(detail) : null,
        clientIp: clientIp || null,
      });
    } catch (err) {
      console.error("Failed to write audit log:", err);
    }
  }
}
