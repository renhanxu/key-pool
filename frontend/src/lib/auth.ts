/**
 * 当前登录用户信息（含角色）
 * 用于在 UI 上区分管理员 / 普通用户，控制「创建密钥 / 归属分配 / 共享开关 / 按用户统计」等专属能力。
 * 注意：仅做 UI 展示与交互开关；真正的权限校验永远在后端。
 */

import { useState, useEffect } from "react";
import { api } from "./api";

export interface CurrentUser {
  id: string;
  username: string;
  role: "admin" | "user";
  displayName: string | null;
  email: string | null;
}

const STORAGE_KEY = "current_user";

export function getStoredUser(): CurrentUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const res = await api.get("/auth/me");
  const u = res.data.data;
  const cu: CurrentUser = {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName ?? null,
    email: u.email ?? null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cu));
  return cu;
}

export function clearStoredUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(true);
      fetchCurrentUser()
        .then(setUser)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  return {
    user,
    isAdmin: user?.role === "admin",
    loading,
    refresh: fetchCurrentUser,
  };
}
