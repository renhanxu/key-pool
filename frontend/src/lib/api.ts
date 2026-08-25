/**
 * API 客户端
 * 本地开发：直连 wrangler dev 的 8787 端口
 * 生产环境：使用 VITE_API_BASE_URL 注入的真实后端域名
 */

import axios, { AxiosInstance } from "axios";

// 优先级：环境变量 > 本地 wrangler dev 默认端口
const baseURL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787";

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 60000,
});

// 请求拦截器：自动附带 JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401 自动跳转登录
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("current_user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  request_id?: string;
  error?: {
    message: string;
    type: string;
  };
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
