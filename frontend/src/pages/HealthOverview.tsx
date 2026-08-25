import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, RefreshCw, Zap, Power } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface HealthState {
  channelId: string;
  channelName: string;
  keyId: string;
  keyMasked: string;
  modelAlias: string;
  state: {
    status: "healthy" | "cooling" | "disabled";
    failureCount: number;
    coolingUntil: number;
    lastErrorType?: string;
    lastErrorMessage?: string;
  };
}

const STATUS_MAP = {
  healthy: { label: "🟢 健康", badge: "badge-healthy" },
  cooling: { label: "🟡 冷却中", badge: "badge-cooling" },
  disabled: { label: "🔴 已禁用", badge: "badge-disabled" },
};

export default function HealthOverview() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data: states, isLoading } = useQuery({
    queryKey: ["health-states"],
    queryFn: async () => {
      const res = await api.get("/health/states");
      return res.data.data as HealthState[];
    },
  });

  const resetMut = useMutation({
    mutationFn: async (s: HealthState) => {
      await api.post("/health/reset", {
        channelId: s.channelId,
        keyId: s.keyId,
        modelAlias: s.modelAlias,
      });
    },
    onSuccess: () => {
      toast.success("已重置为健康状态");
      queryClient.invalidateQueries({ queryKey: ["health-states"] });
    },
  });

  const probeMut = useMutation({
    mutationFn: async () => {
      const res = await api.post("/health/probe-disabled");
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success(`探测完成：成功 ${data.results.filter((r: any) => r.status === "recovered").length} / 总 ${data.probed}`);
      queryClient.invalidateQueries({ queryKey: ["health-states"] });
    },
  });

  const filtered = filter === "all" ? states : states?.filter((s) => s.state.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Heart className="w-7 h-7 text-pink-500" />
            健康状态总览
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            所有「渠道 + Key + 模型」组合的实时健康状态
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="healthy">🟢 健康</option>
            <option value="cooling">🟡 冷却中</option>
            <option value="disabled">🔴 已禁用</option>
          </select>
          <button
            onClick={() => probeMut.mutate()}
            disabled={probeMut.isPending}
            className="btn-secondary flex items-center gap-1"
          >
            <Zap className={`w-4 h-4 ${probeMut.isPending ? "animate-pulse" : ""}`} />
            探测已禁用
          </button>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["health-states"] })}
            className="btn-ghost"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : filtered && filtered.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-pink-100">
                <th className="py-2 px-2">渠道</th>
                <th className="py-2 px-2">Key</th>
                <th className="py-2 px-2">模型</th>
                <th className="py-2 px-2">状态</th>
                <th className="py-2 px-2">失败次数</th>
                <th className="py-2 px-2">剩余冷却</th>
                <th className="py-2 px-2">最后错误</th>
                <th className="py-2 px-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const statusInfo = STATUS_MAP[s.state.status];
                const remainingCooling = Math.max(0, Math.round((s.state.coolingUntil - Date.now()) / 1000));
                return (
                  <tr key={i} className="border-b border-pink-50">
                    <td className="py-2 px-2 font-medium">{s.channelName}</td>
                    <td className="py-2 px-2"><code className="text-xs">{s.keyMasked}</code></td>
                    <td className="py-2 px-2"><code className="text-xs">{s.modelAlias}</code></td>
                    <td className="py-2 px-2">
                      <span className={`badge ${statusInfo.badge}`}>{statusInfo.label}</span>
                    </td>
                    <td className="py-2 px-2">{s.state.failureCount}</td>
                    <td className="py-2 px-2 text-xs">
                      {s.state.status === "cooling" && remainingCooling > 0 ? `${remainingCooling}s` : "—"}
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-500 max-w-[200px] truncate" title={s.state.lastErrorMessage}>
                      {s.state.lastErrorType || "—"}
                    </td>
                    <td className="py-2 px-2">
                      {s.state.status !== "healthy" && (
                        <button
                          onClick={() => resetMut.mutate(s)}
                          className="btn-ghost text-xs flex items-center gap-1"
                        >
                          <Power className="w-3 h-3" />
                          重置
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-12 text-gray-400">
            {filter === "all" ? "暂无组合" : `没有${STATUS_MAP[filter as keyof typeof STATUS_MAP]?.label || ""}的组合`}
          </div>
        )}
      </div>
    </div>
  );
}
