import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Server,
  Key,
  Activity,
  TrendingUp,
  Heart,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatNumber, formatDate } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface StatsOverview {
  total: number;
  success: number;
  failed: number;
  successRate: number;
  totalTokens: number;
  avgDurationMs: number;
}

interface HealthSummary {
  total: number;
  healthy: number;
  cooling: number;
  disabled: number;
}

export default function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["stats-overview", "1d"],
    queryFn: async () => {
      const res = await api.get("/stats/overview?range=1d");
      return res.data.data as StatsOverview;
    },
  });

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get("/channels");
      return res.data.data as any[];
    },
  });

  const { data: aggKeys } = useQuery({
    queryKey: ["aggregate-keys"],
    queryFn: async () => {
      const res = await api.get("/aggregate-keys");
      return res.data.data as any[];
    },
  });

  const { data: health } = useQuery({
    queryKey: ["health-states"],
    queryFn: async () => {
      const res = await api.get("/health/states");
      const list = res.data.data as any[];
      const summary: HealthSummary = {
        total: list.length,
        healthy: list.filter((s) => s.state.status === "healthy").length,
        cooling: list.filter((s) => s.state.status === "cooling").length,
        disabled: list.filter((s) => s.state.status === "disabled").length,
      };
      return summary;
    },
  });

  const { data: timeline } = useQuery({
    queryKey: ["stats-timeline", "1d"],
    queryFn: async () => {
      const res = await api.get("/stats/timeline?range=1d&granularity=hour");
      return res.data.data as Array<{ bucket: string; total: number; success: number; failed: number }>;
    },
  });

  const statCards = [
    {
      title: "渠道数量",
      value: channels?.length || 0,
      icon: Server,
      color: "bg-macaron-mint/20 text-green-600",
      link: "/channels",
    },
    {
      title: "聚合密钥",
      value: aggKeys?.length || 0,
      icon: Key,
      color: "bg-pink-100 text-pink-600",
      link: "/aggregate-keys",
    },
    {
      title: "今日请求",
      value: stats?.total || 0,
      icon: Activity,
      color: "bg-macaron-sky/30 text-blue-600",
      link: "/stats",
    },
    {
      title: "成功率",
      value: `${stats?.successRate || 0}%`,
      icon: TrendingUp,
      color: "bg-macaron-lavender/30 text-purple-600",
      link: "/stats",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">概览</h1>
        <p className="text-sm text-gray-500 mt-1">
          欢迎回来！今天是 {formatDate(new Date())} 🌸
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              to={card.link}
              className="card hover:shadow-soft hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${card.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">{card.title}</div>
                  <div className="text-2xl font-bold text-gray-800">
                    {typeof card.value === "number" ? formatNumber(card.value) : card.value}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* 健康总览 + Token 用量 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-pink-500" />
            今日请求趋势
          </h2>
          {timeline && timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#FFE0EC" />
                <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="total" stroke="#FF8FAB" strokeWidth={2} name="总请求" />
                <Line type="monotone" dataKey="success" stroke="#A8E6CF" strokeWidth={2} name="成功" />
                <Line type="monotone" dataKey="failed" stroke="#FFB6B6" strokeWidth={2} name="失败" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-400">
              暂无请求数据
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Heart className="w-5 h-5 text-pink-500" />
            健康总览
          </h2>
          {health && health.total > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">🟢 健康</span>
                <span className="font-bold text-green-600">{health.healthy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">🟡 冷却中</span>
                <span className="font-bold text-yellow-600">{health.cooling}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">🔴 已禁用</span>
                <span className="font-bold text-red-600">{health.disabled}</span>
              </div>
              <div className="pt-2 border-t border-pink-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">总组合数</span>
                  <span className="font-medium">{health.total}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
              暂无组合
            </div>
          )}
        </div>
      </div>

      {/* 提示信息 */}
      <div className="card bg-gradient-to-r from-pink-50 to-yellow-50">
        <h3 className="font-semibold text-pink-600 mb-2">🌸 快速开始</h3>
        <ol className="text-sm space-y-1.5 text-gray-700 list-decimal list-inside">
          <li>在「渠道管理」中创建你的第一个渠道（如 OpenAI、Cloudflare Workers AI 等）</li>
          <li>录入 API Key 并拉取模型列表</li>
          <li>在「聚合密钥」中创建聚合密钥并绑定渠道+模型</li>
          <li>使用聚合密钥 <code className="px-1.5 py-0.5 bg-white rounded text-pink-600">sk-xxxx</code> 即可调用 <code className="px-1.5 py-0.5 bg-white rounded text-pink-600">/v1/chat/completions</code> 接口</li>
        </ol>
      </div>
    </div>
  );
}
