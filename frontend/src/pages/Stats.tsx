import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, BarChart3, Activity, PieChart, TrendingUp, Filter } from "lucide-react";
import { api } from "@/lib/api";
import { formatNumber, formatDate } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth";
import SearchableSelect from "@/components/SearchableSelect";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RPieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";

const RANGE_OPTIONS = [
  { value: "1h", label: "1 小时" },
  { value: "1d", label: "1 天" },
  { value: "3d", label: "3 天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

const PIE_COLORS = ["#FF8FAB", "#A8E6CF", "#D5A6E8", "#FFF3A0", "#B5DEFF", "#FFD3B6"];

export default function Stats() {
  const { isAdmin } = useCurrentUser();
  const [range, setRange] = useState("1d");
  const [page, setPage] = useState(1);

  // 筛选维度
  const [keyId, setKeyId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [userId, setUserId] = useState("");

  // 选项数据源
  const { data: keys } = useQuery({
    queryKey: ["aggregate-keys"],
    queryFn: async () => {
      const res = await api.get("/aggregate-keys");
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get("/channels");
      return res.data.data as Array<{ id: string; name: string; type: string }>;
    },
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get("/auth/users");
      return res.data.data as Array<{ id: string; username: string; displayName: string | null }>;
    },
    enabled: isAdmin,
  });

  // 维度筛选参数（除时间外）
  const dimParams = new URLSearchParams();
  if (keyId) dimParams.set("aggregateKeyId", keyId);
  if (channelId) dimParams.set("channelId", channelId);
  if (modelAlias) dimParams.set("modelAlias", modelAlias);
  if (isAdmin && userId) dimParams.set("userId", userId);
  const dim = dimParams.toString();

  const { data: overview } = useQuery({
    queryKey: ["stats-overview", range, dim],
    queryFn: async () => {
      const res = await api.get(`/stats/overview?range=${range}${dim ? `&${dim}` : ""}`);
      return res.data.data;
    },
  });

  const { data: timeline } = useQuery({
    queryKey: ["stats-timeline", range, dim],
    queryFn: async () => {
      const res = await api.get(`/stats/timeline?range=${range}&granularity=${range === "1h" ? "hour" : "day"}${dim ? `&${dim}` : ""}`);
      return res.data.data;
    },
  });

  const { data: errorTypes } = useQuery({
    queryKey: ["stats-by-error", range, dim],
    queryFn: async () => {
      const res = await api.get(`/stats/by-error-type?range=${range}${dim ? `&${dim}` : ""}`);
      return res.data.data;
    },
  });

  const { data: byModel } = useQuery({
    queryKey: ["stats-by-model", range, dim],
    queryFn: async () => {
      const res = await api.get(`/stats/by-model?range=${range}${dim ? `&${dim}` : ""}`);
      return res.data.data;
    },
  });

  const { data: logsData } = useQuery({
    queryKey: ["stats-logs", page, range, dim],
    queryFn: async () => {
      const res = await api.get(`/stats/logs?page=${page}&pageSize=20${dim ? `&${dim}` : ""}`);
      return res.data.data;
    },
  });

  const handleExport = () => {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const params = new URLSearchParams({ start, end });
    if (keyId) params.set("aggregateKeyId", keyId);
    if (channelId) params.set("channelId", channelId);
    if (modelAlias) params.set("modelAlias", modelAlias);
    if (isAdmin && userId) params.set("userId", userId);
    const url = `/stats/logs/export?${params.toString()}`;
    window.open(url, "_blank");
  };

  const resetFilters = () => {
    setKeyId("");
    setChannelId("");
    setModelAlias("");
    setUserId("");
  };

  const hasFilter = !!(keyId || channelId || modelAlias || (isAdmin && userId));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-pink-500" />
            用量统计
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-1">
            <Download className="w-4 h-4" />
            导出 CSV
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
          <Filter className="w-4 h-4 text-pink-500" />
          筛选维度
          {hasFilter && (
            <button onClick={resetFilters} className="btn-ghost text-xs text-pink-500">清空筛选</button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">按聚合密钥</label>
            <SearchableSelect
              value={keyId}
              onChange={(v) => { setKeyId(v); setPage(1); }}
              placeholder="全部密钥"
              options={(keys || []).map((k) => ({ value: k.id, label: k.name }))}
            />
          </div>
          <div>
            <label className="label">按渠道厂商</label>
            <SearchableSelect
              value={channelId}
              onChange={(v) => { setChannelId(v); setPage(1); }}
              placeholder="全部渠道"
              options={(channels || []).map((c) => ({ value: c.id, label: `${c.name} (${c.type})` }))}
            />
          </div>
          <div>
            <label className="label">按模型</label>
            <input
              list="model-options"
              className="input"
              value={modelAlias}
              onChange={(e) => { setModelAlias(e.target.value); setPage(1); }}
              placeholder="全部模型"
            />
            <datalist id="model-options">
              {(byModel || []).map((m: any) => (
                <option key={m.model} value={m.model} />
              ))}
            </datalist>
          </div>
          {isAdmin && (
            <div>
              <label className="label">按用户</label>
              <SearchableSelect
                value={userId}
                onChange={(v) => { setUserId(v); setPage(1); }}
                placeholder="全部用户"
                options={(users || []).map((u) => ({ value: u.id, label: u.displayName || u.username }))}
              />
            </div>
          )}
        </div>
      </div>

      {/* 总览卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card">
          <div className="text-sm text-gray-500">总请求</div>
          <div className="text-2xl font-bold mt-1">{formatNumber(overview?.total || 0)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-500">成功</div>
          <div className="text-2xl font-bold mt-1 text-green-600">{formatNumber(overview?.success || 0)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-500">失败</div>
          <div className="text-2xl font-bold mt-1 text-red-600">{formatNumber(overview?.failed || 0)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-500">成功率</div>
          <div className="text-2xl font-bold mt-1 text-pink-600">{overview?.successRate || 0}%</div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-500">Token 用量</div>
          <div className="text-2xl font-bold mt-1">{formatNumber(overview?.totalTokens || 0)}</div>
        </div>
      </div>

      {/* 趋势 + 错误类型 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-pink-500" />
            请求趋势
          </h2>
          {timeline && timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#FFE0EC" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" stroke="#FF8FAB" name="总请求" />
                <Line type="monotone" dataKey="success" stroke="#A8E6CF" name="成功" />
                <Line type="monotone" dataKey="failed" stroke="#FFB6B6" name="失败" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-400">暂无数据</div>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-pink-500" />
            错误类型分布
          </h2>
          {errorTypes && errorTypes.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <RPieChart>
                <Pie
                  data={errorTypes}
                  dataKey="count"
                  nameKey="errorType"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label
                >
                  {errorTypes.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RPieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-400">暂无数据</div>
          )}
        </div>
      </div>

      {/* Top 模型 */}
      {byModel && byModel.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-3">🏆 Top 模型（按请求数）</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byModel.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFE0EC" />
              <XAxis dataKey="model" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#FF8FAB" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 详细日志 */}
      <div className="card">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Activity className="w-5 h-5 text-pink-500" />
          请求日志
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-pink-100">
                <th className="py-2 px-2">时间</th>
                <th className="py-2 px-2">模型</th>
                <th className="py-2 px-2">状态</th>
                <th className="py-2 px-2">耗时</th>
                <th className="py-2 px-2">Token</th>
                <th className="py-2 px-2">错误类型</th>
              </tr>
            </thead>
            <tbody>
              {logsData?.items?.map((log: any) => (
                <tr key={log.id} className="border-b border-pink-50">
                  <td className="py-2 px-2 text-xs">{formatDate(log.createdAt)}</td>
                  <td className="py-2 px-2"><code className="text-xs">{log.modelAlias}</code></td>
                  <td className="py-2 px-2">
                    <span className={`badge ${log.statusCode >= 200 && log.statusCode < 300 ? "badge-healthy" : "badge-disabled"}`}>
                      {log.statusCode || "—"}
                    </span>
                  </td>
                  <td className="py-2 px-2">{log.durationMs}ms</td>
                  <td className="py-2 px-2">{log.totalTokens || 0}</td>
                  <td className="py-2 px-2 text-xs text-gray-500">{log.errorType || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {logsData && logsData.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn-ghost disabled:opacity-50"
            >
              ← 上一页
            </button>
            <span className="text-sm">第 {page} / {logsData.totalPages} 页</span>
            <button
              onClick={() => setPage(Math.min(logsData.totalPages, page + 1))}
              disabled={page >= logsData.totalPages}
              className="btn-ghost disabled:opacity-50"
            >
              下一页 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
