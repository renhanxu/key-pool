import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCw, Gauge, Edit, Key, Server } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, copyToClipboard } from "@/lib/utils";

interface Channel {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  cfAccountId?: string | null;
  cfGatewayId?: string | null;
  groupTag: string | null;
  weight: number;
  status: string;
  createdAt: number;
}

// 渠道厂商列表（预置渠道类型，与需求文档一致）
interface VendorPreset {
  type: string;
  name: string;
  baseUrl: string;
  desc: string;
}

const VENDOR_LIBRARY: VendorPreset[] = [
  { type: "openai", name: "OpenAI", baseUrl: "https://api.openai.com", desc: "GPT-4o / o1 / o3 等全系列" },
  { type: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", desc: "Claude 全系列" },
  { type: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com", desc: "Gemini 系列" },
  { type: "azure", name: "Azure OpenAI", baseUrl: "https://your-resource.openai.azure.com", desc: "Azure 托管的 OpenAI" },
  { type: "cloudflare-workers-ai", name: "Cloudflare Workers AI", baseUrl: "https://api.cloudflare.com", desc: "Cloudflare 边缘推理" },
  { type: "cloudflare-aig-openai", name: "CF AI Gateway · OpenAI", baseUrl: "https://gateway.ai.cloudflare.com", desc: "经 AI Gateway 转发 OpenAI" },
  { type: "cloudflare-aig-anthropic", name: "CF AI Gateway · Anthropic", baseUrl: "https://gateway.ai.cloudflare.com", desc: "经 AI Gateway 转发 Anthropic" },
  { type: "cloudflare-aig-gemini", name: "CF AI Gateway · Gemini", baseUrl: "https://gateway.ai.cloudflare.com", desc: "经 AI Gateway 转发 Gemini" },
  { type: "cloudflare-aig-compat", name: "CF AI Gateway · 统一接口(compat)", baseUrl: "https://gateway.ai.cloudflare.com", desc: "统一接口：经 default/compat 转发任意厂商" },
  { type: "custom", name: "自定义中转站", baseUrl: "https://", desc: "任意 OpenAI 兼容格式" },
];

export default function Channels() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createPreset, setCreatePreset] = useState<VendorPreset | null>(null);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const openCreate = (preset?: VendorPreset) => {
    setCreatePreset(preset ?? null);
    setShowCreate(true);
  };

  const { data: channels, isLoading } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get("/channels");
      return res.data.data as Channel[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/channels/${id}`);
    },
    onSuccess: () => {
      toast.success("渠道已删除");
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error?.message || "删除失败");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">渠道管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理你的 API 渠道，每个渠道可包含多个 API Key
          </p>
        </div>
        <button onClick={() => openCreate()} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          新建渠道
        </button>
      </div>

      {/* 渠道厂商列表 */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-1">渠道厂商</h2>
        <p className="text-xs text-gray-500 mb-3">选择一个厂商，快速创建对应类型的渠道</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {VENDOR_LIBRARY.map((v) => (
            <button
              key={v.type}
              onClick={() => openCreate(v)}
              className="text-left border border-pink-100 rounded-xl p-3 hover:border-pink-300 hover:bg-pink-50/40 transition-colors"
            >
              <div className="font-medium text-sm text-gray-800">{v.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">{v.desc}</div>
              <div className="text-[10px] text-pink-400 font-mono mt-1 truncate">{v.baseUrl}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : channels && channels.length > 0 ? (
          <div className="space-y-3">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="border-2 border-pink-100 rounded-xl p-4 hover:border-pink-300 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Server className="w-5 h-5 text-pink-500" />
                      <span className="font-semibold">{ch.name}</span>
                      <span className="badge badge-enabled">{ch.type}</span>
                      {ch.groupTag && <span className="badge bg-pink-50 text-pink-500">{ch.groupTag}</span>}
                      <span
                        className={`badge ${
                          ch.status === "enabled" ? "badge-enabled" : "badge-disabled-status"
                        }`}
                      >
                        {ch.status === "enabled" ? "已启用" : "已禁用"}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 truncate">
                      {ch.baseUrl}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      权重 {ch.weight} · 创建于 {formatDate(ch.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setDetailId(ch.id)}
                      className="btn-ghost"
                      title="查看详情"
                    >
                      <Key className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditing(ch)}
                      className="btn-ghost"
                      title="编辑"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`确定删除渠道 ${ch.name}？`)) {
                          deleteMut.mutate(ch.id);
                        }
                      }}
                      className="btn-ghost text-red-500 hover:bg-red-50"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Server className="w-12 h-12 text-pink-200 mx-auto mb-3" />
            <p className="text-gray-500">还没有渠道，点击右上角创建第一个吧 🌸</p>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateChannelDialog
          preset={createPreset}
          onClose={() => {
            setShowCreate(false);
            setCreatePreset(null);
          }}
          onSuccess={() => {
            setShowCreate(false);
            setCreatePreset(null);
            queryClient.invalidateQueries({ queryKey: ["channels"] });
          }}
        />
      )}

      {editing && (
        <EditChannelDialog
          channel={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["channels"] });
          }}
        />
      )}

      {detailId && (
        <ChannelDetailDialog
          channelId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// === 创建渠道对话框 ===
function CreateChannelDialog({
  onClose,
  onSuccess,
  preset,
}: {
  onClose: () => void;
  onSuccess: () => void;
  preset?: VendorPreset | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState(preset?.type ?? "openai");
  const [baseUrl, setBaseUrl] = useState(preset?.baseUrl ?? "https://api.openai.com");
  const [cfAccountId, setCFAccountId] = useState("");
  const [cfGatewayId, setCFGatewayId] = useState("");
  const [groupTag, setGroupTag] = useState("");
  const [weight, setWeight] = useState(100);
  const [keys, setKeys] = useState("");
  const [loading, setLoading] = useState(false);

  const isAigChannel = () => ["cloudflare-aig-openai", "cloudflare-aig-anthropic", "cloudflare-aig-gemini"].includes(type);
  const isAigCompatChannel = () => type === "cloudflare-aig-compat";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !baseUrl) {
      toast.error("请填写名称和 BaseURL");
      return;
    }
    if (isAigChannel() && (!cfAccountId || !cfGatewayId)) {
      toast.error("Cloudflare AI Gateway 需要填写 Account ID 和 Gateway ID");
      return;
    }
    if (isAigCompatChannel() && !cfAccountId) {
      toast.error("Cloudflare AI Gateway（compat）需要填写 Account ID");
      return;
    }
    const keyList = keys.split("\n").map((k) => k.trim()).filter(Boolean);
    if (keyList.length === 0) {
      toast.error("请至少添加一个 API Key");
      return;
    }
    setLoading(true);
    try {
      await api.post("/channels", {
        name,
        type,
        baseUrl,
        cfAccountId: cfAccountId || undefined,
        cfGatewayId: cfGatewayId || undefined,
        groupTag: groupTag || undefined,
        weight,
        keys: keyList,
      });
      toast.success("渠道创建成功 🌸");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">🌸 新建渠道</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">名称 *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI 主渠道" />
            </div>
            <div>
              <label className="label">类型 *</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="azure">Azure OpenAI</option>
                <option value="cloudflare-workers-ai">Cloudflare Workers AI</option>
                <option value="cloudflare-aig-openai">Cloudflare AI Gateway - OpenAI</option>
                <option value="cloudflare-aig-anthropic">Cloudflare AI Gateway - Anthropic</option>
                <option value="cloudflare-aig-gemini">Cloudflare AI Gateway - Gemini</option>
                <option value="cloudflare-aig-compat">Cloudflare AI Gateway - 统一接口(compat)</option>
                <option value="custom">自定义 OpenAI 兼容</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Base URL *</label>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
          </div>

          {(isAigChannel() || isAigCompatChannel()) && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Cloudflare Account ID *</label>
                  <input className="input" value={cfAccountId} onChange={(e) => setCFAccountId(e.target.value)} placeholder="e123456789abcdef" />
                </div>
                {!isAigCompatChannel() && (
                  <div>
                    <label className="label">Gateway Name *</label>
                    <input className="input" value={cfGatewayId} onChange={(e) => setCFGatewayId(e.target.value)} placeholder="my-gateway" />
                  </div>
                )}
              </div>
              <p className="text-xs text-blue-600">
                {isAigCompatChannel()
                  ? "💡 Cloudflare AI Gateway 统一接口（compat）：请求将通过 gateway.ai.cloudflare.com/v1/{AccountID}/default/compat 转发，只需填写 Account ID（Gateway 固定为 default）。"
                  : "💡 Cloudflare AI Gateway 模式：请求将通过 gateway.ai.cloudflare.com 转发，需要配置 Cloudflare 账户和 Gateway。"}
              </p>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">分组标签</label>
              <input className="input" value={groupTag} onChange={(e) => setGroupTag(e.target.value)} placeholder="如：主力、备用" />
            </div>
            <div>
              <label className="label">权重</label>
              <input type="number" className="input" value={weight} onChange={(e) => setWeight(parseInt(e.target.value) || 100)} min="1" max="1000" />
            </div>
          </div>

          <div>
            <label className="label">API Keys *（每行一个）</label>
            <textarea
              className="input min-h-[120px] font-mono text-sm"
              value={keys}
              onChange={(e) => setKeys(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxxxx"
            />
            <p className="text-xs text-gray-500 mt-1">
              已自动去重。系统会对 Key 进行加密存储和脱敏展示。
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "创建中..." : "🌸 创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === 编辑渠道对话框 ===
function EditChannelDialog({ channel, onClose, onSuccess }: { channel: Channel; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState(channel.name);
  const [baseUrl, setBaseUrl] = useState(channel.baseUrl);
  const [cfAccountId, setCFAccountId] = useState(channel.cfAccountId || "");
  const [cfGatewayId, setCFGatewayId] = useState(channel.cfGatewayId || "");
  const [groupTag, setGroupTag] = useState(channel.groupTag || "");
  const [weight, setWeight] = useState(channel.weight);
  const [status, setStatus] = useState(channel.status);
  const [loading, setLoading] = useState(false);

  const isAigChannel = () => ["cloudflare-aig-openai", "cloudflare-aig-anthropic", "cloudflare-aig-gemini"].includes(channel.type);
  const isAigCompatChannel = () => channel.type === "cloudflare-aig-compat";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/channels/${channel.id}`, {
        name,
        baseUrl,
        cfAccountId: isAigChannel() || isAigCompatChannel() ? cfAccountId : undefined,
        cfGatewayId: isAigChannel() ? cfGatewayId : undefined,
        groupTag: groupTag || undefined,
        weight,
        status,
      });
      toast.success("更新成功");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "更新失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">✏️ 编辑渠道</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Base URL</label>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          {(isAigChannel() || isAigCompatChannel()) && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Cloudflare Account ID</label>
                  <input className="input" value={cfAccountId} onChange={(e) => setCFAccountId(e.target.value)} />
                </div>
                {!isAigCompatChannel() && (
                  <div>
                    <label className="label">Gateway Name</label>
                    <input className="input" value={cfGatewayId} onChange={(e) => setCFGatewayId(e.target.value)} />
                  </div>
                )}
              </div>
            </>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">分组</label>
              <input className="input" value={groupTag} onChange={(e) => setGroupTag(e.target.value)} />
            </div>
            <div>
              <label className="label">权重</label>
              <input type="number" className="input" value={weight} onChange={(e) => setWeight(parseInt(e.target.value) || 100)} />
            </div>
            <div>
              <label className="label">状态</label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="enabled">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "保存中..." : "💾 保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// === 渠道详情对话框 ===
function ChannelDetailDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: detail, isLoading } = useQuery({
    queryKey: ["channel-detail", channelId],
    queryFn: async () => {
      const res = await api.get(`/channels/${channelId}`);
      return res.data.data;
    },
  });

  const [newKeys, setNewKeys] = useState("");
  const [probeResult, setProbeResult] = useState<any>(null);
  // 从厂商拉取后的「搜索 + 多选」添加面板状态
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModels, setSelectedModels] = useState<Record<string, boolean>>({});

  const addKeysMut = useMutation({
    mutationFn: async (keys: Array<string | { label?: string; key: string; aigToken?: string; byokMode?: boolean }>) => {
      await api.post(`/channels/${channelId}/keys`, { keys });
    },
    onSuccess: (data) => {
      toast.success("Keys 已添加");
      queryClient.invalidateQueries({ queryKey: ["channel-detail", channelId] });
      setNewKeys("");
    },
  });

  const fetchModelsMut = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/channels/${channelId}/fetch-models`);
      return res.data.data as { models: string[] };
    },
    onSuccess: (data) => {
      if (data.models.length === 0) {
        toast.warning("未拉取到任何模型");
        return;
      }
      // 排除已经添加过的模型，避免重复
      const added = new Set((detail?.models || []).map((m: any) => m.aliasName));
      const fresh = data.models.filter((m) => !added.has(m));
      if (fresh.length === 0) {
        toast.info("拉取到的模型均已添加");
        return;
      }
      // 打开「搜索 + 多选」面板，由用户勾选后批量添加
      setFetchedModels(fresh);
      setModelSearch("");
      setSelectedModels({});
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error?.message || "拉取失败");
    },
  });

  const selectedCount = Object.values(selectedModels).filter(Boolean).length;

  const addSelectedModels = () => {
    const chosen = fetchedModels.filter((m) => selectedModels[m]);
    if (chosen.length === 0) {
      toast.error("请至少选择一个模型");
      return;
    }
    api
      .post(`/channels/${channelId}/models`, {
        models: chosen.map((m) => ({ aliasName: m, realModel: m })),
      })
      .then(() => {
        toast.success(`已添加 ${chosen.length} 个模型`);
        setFetchedModels([]);
        setSelectedModels({});
        queryClient.invalidateQueries({ queryKey: ["channel-detail", channelId] });
      })
      .catch((err: any) => {
        toast.error(err.response?.data?.error?.message || "添加失败");
      });
  };

  const handleProbe = async (modelAlias: string) => {
    try {
      const res = await api.post(`/channels/${channelId}/probe`, { model: modelAlias });
      setProbeResult({ ...res.data.data, model: modelAlias });
      toast.success("测速完成");
    } catch (err: any) {
      toast.error("测速失败");
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
        <div className="card">加载中...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-4xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">🔑 {detail.name} - 详情</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {detail.type?.startsWith("cloudflare-aig-") && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm">
            <div className="font-medium text-blue-700 mb-1">🌐 Cloudflare AI Gateway 模式</div>
            {detail.type === "cloudflare-aig-compat" ? (
              <div className="text-blue-600">
                请求 URL（统一接口）：<code className="font-mono">https://gateway.ai.cloudflare.com/v1/{detail.cfAccountId}/default/compat/chat/completions</code>
                <div className="text-blue-600 text-xs mt-1">每把 Key 也可单独指定 Account ID，实现「多账户统一」（同一密钥池服务多个 CF 账户）。</div>
              </div>
            ) : (
              <div className="text-blue-600">
                请求 URL：<code className="font-mono">https://gateway.ai.cloudflare.com/v1/{detail.cfAccountId}/{detail.cfGatewayId}/{detail.type === "cloudflare-aig-openai" ? "openai" : detail.type === "cloudflare-aig-anthropic" ? "anthropic" : "google-ai-studio"}/chat/completions</code>
              </div>
            )}
            <div className="text-blue-600 text-xs mt-1">
              Base URL（仅供显示）：{detail.baseUrl}
            </div>
          </div>
        )}

        {/* Keys 管理 */}
        <section className="mb-6">
          <h3 className="font-semibold mb-2">API Keys（{detail.keys.length}）</h3>
          <div className="space-y-1 mb-3">
            {detail.keys.map((k: any) => (
              <div key={k.id} className="flex flex-col gap-1 px-3 py-2 bg-pink-50 rounded-lg text-sm">
                <div className="flex items-center gap-2">
                  {k.providerLabel && (
                    <span className="px-2 py-0.5 bg-pink-200 text-pink-800 rounded text-xs font-medium">
                      {k.providerLabel}
                    </span>
                  )}
                  <code className="flex-1 font-mono">{k.keyMasked}</code>
                  {k.byokMode && <span className="badge bg-blue-100 text-blue-700">BYOK</span>}
                  <span className={`badge ${k.status === "enabled" ? "badge-enabled" : "badge-disabled-status"}`}>
                    {k.status}
                  </span>
                  <button
                    onClick={async () => {
                      await api.put(`/channels/${channelId}/keys/${k.id}/toggle`, {
                        status: k.status === "enabled" ? "disabled" : "enabled",
                      });
                      queryClient.invalidateQueries({ queryKey: ["channel-detail", channelId] });
                    }}
                    className="btn-ghost text-xs"
                  >
                    切换
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("确定删除此 Key？")) {
                        await api.delete(`/channels/${channelId}/keys/${k.id}`);
                        queryClient.invalidateQueries({ queryKey: ["channel-detail", channelId] });
                      }
                    }}
                    className="btn-ghost text-xs text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {k.aigTokenMasked && (
                  <div className="flex items-center gap-2 pl-2 text-xs text-blue-700">
                    <span>cf-aig-authorization:</span>
                    <code className="font-mono">{k.aigTokenMasked}</code>
                  </div>
                )}
                {k.cfAccountId && (
                  <div className="flex items-center gap-2 pl-2 text-xs text-purple-700">
                    <span>CF 账户:</span>
                    <code className="font-mono">{k.cfAccountId}</code>
                    {k.cfGatewayId && <span className="text-gray-400">/ {k.cfGatewayId}</span>}
                    <span className="text-gray-400">（Key 专属，覆盖渠道级）</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono text-sm"
                value={newKeys}
                onChange={(e) => setNewKeys(e.target.value)}
                placeholder="sk-xxx...（多行可批量添加）"
              />
              <button
                onClick={() => {
                  const list = newKeys.split("\n").map((k) => k.trim()).filter(Boolean);
                  if (list.length > 0) addKeysMut.mutate(list);
                }}
                className="btn-primary"
              >
                快速添加
              </button>
            </div>
            <AdvancedKeyForm
              onAdd={(payload) => addKeysMut.mutate([payload])}
            />
          </div>
        </section>

        {/* 模型映射 */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">模型映射（{detail.models.length}）</h3>
            <button
              onClick={() => fetchModelsMut.mutate()}
              disabled={fetchModelsMut.isPending}
              className="btn-secondary text-sm flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${fetchModelsMut.isPending ? "animate-spin" : ""}`} />
              从厂商拉取
            </button>
          </div>
          <div className="space-y-1">
            {detail.models.map((m: any) => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 bg-macaron-mint/10 rounded-lg text-sm">
                <code className="font-mono">{m.aliasName}</code>
                <span className="text-gray-400">→</span>
                <code className="font-mono text-xs text-gray-600">{m.realModel}</code>
                {m.prefix && <span className="text-xs text-pink-500">前缀: {m.prefix}</span>}
                {m.suffix && <span className="text-xs text-pink-500">后缀: {m.suffix}</span>}
                <button
                  onClick={() => handleProbe(m.aliasName)}
                  className="btn-ghost text-xs ml-auto"
                  title="测速"
                >
                  <Gauge className="w-3 h-3" />
                </button>
                <button
                  onClick={async () => {
                    await api.delete(`/channels/${channelId}/models/${m.id}`);
                    queryClient.invalidateQueries({ queryKey: ["channel-detail", channelId] });
                  }}
                  className="btn-ghost text-xs text-red-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* 搜索 + 多选 添加模型面板 */}
          {fetchedModels.length > 0 && (
            <div className="mt-3 p-3 border border-pink-200 rounded-xl bg-pink-50/40">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  选择要添加的模型（已选 {selectedCount}/{fetchedModels.length}）
                </span>
                <button
                  onClick={() => {
                    setFetchedModels([]);
                    setSelectedModels({});
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  收起
                </button>
              </div>
              <input
                className="input mb-2"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="搜索模型名称（支持部分匹配，如 gpt-4）"
              />
              {(() => {
                const shown = fetchedModels.filter((m) =>
                  m.toLowerCase().includes(modelSearch.toLowerCase())
                );
                return (
                  <>
                    <div className="max-h-52 overflow-y-auto space-y-1 mb-2">
                      {shown.map((m) => (
                        <label
                          key={m}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={!!selectedModels[m]}
                            onChange={(e) =>
                              setSelectedModels((prev) => ({ ...prev, [m]: e.target.checked }))
                            }
                          />
                          <code className="font-mono">{m}</code>
                        </label>
                      ))}
                      {shown.length === 0 && (
                        <div className="text-xs text-gray-400 px-2 py-1">无匹配模型</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const allSel = shown.length > 0 && shown.every((m) => selectedModels[m]);
                          const next = { ...selectedModels };
                          shown.forEach((m) => (next[m] = !allSel));
                          setSelectedModels(next);
                        }}
                        className="btn-ghost text-xs"
                      >
                        全选/反选（当前搜索）
                      </button>
                      <button
                        onClick={addSelectedModels}
                        disabled={selectedCount === 0}
                        className="btn-primary text-sm"
                      >
                        添加选中（{selectedCount}）
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </section>

        {/* 测速结果 */}
        {probeResult && (
          <section className="bg-macaron-sky/20 rounded-xl p-3">
            <h3 className="font-semibold mb-1">⏱️ 测速结果：{probeResult.model}</h3>
            <div className="text-sm">
              延迟：<span className="font-bold text-pink-600">{probeResult.latencyMs}ms</span>，
              TTFB：<span className="font-bold text-pink-600">{probeResult.ttfbMs}ms</span>，
              状态码：<span className="font-mono">{probeResult.statusCode}</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// === 高级 Key 表单（支持 provider 账户、AIG Token、BYOK 模式、每把 Key 独立的 CF 账户）===
function AdvancedKeyForm({
  onAdd,
}: {
  onAdd: (payload: {
    label?: string;
    key: string;
    aigToken?: string;
    byokMode?: boolean;
    cfAccountId?: string;
    cfGatewayId?: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [aigToken, setAigToken] = useState("");
  const [byokMode, setByokMode] = useState(false);
  const [cfAccountId, setCFAccountId] = useState("");
  const [cfGatewayId, setCFGatewayId] = useState("");

  const handleAdd = () => {
    if (!key && !aigToken) {
      toast.error("请至少填写 Key 或 AIG Token");
      return;
    }
    onAdd({
      label: label || undefined,
      key,
      aigToken: aigToken || undefined,
      byokMode,
      cfAccountId: cfAccountId || undefined,
      cfGatewayId: cfGatewayId || undefined,
    });
    setLabel("");
    setKey("");
    setAigToken("");
    setByokMode(false);
    setCFAccountId("");
    setCFGatewayId("");
    setOpen(false);
    toast.success("已添加");
  };

  return (
    <details
      className="bg-gray-50 rounded-lg p-3"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm text-gray-700 select-none">
        🔧 高级：单独添加（指定账户标签 / AIG Token / BYOK / 独立 CF 账户）
      </summary>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-24 text-right">账户标签</span>
          <input
            className="input flex-1 font-mono text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="如：主账户-A"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-24 text-right">API Key</span>
          <input
            className="input flex-1 font-mono text-sm"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-xxx"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-24 text-right">CF AIG Token</span>
          <input
            className="input flex-1 font-mono text-sm"
            value={aigToken}
            onChange={(e) => setAigToken(e.target.value)}
            placeholder="AI Gateway 的 cf-aig-authorization"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-24 text-right">CF 账户 ID</span>
          <input
            className="input flex-1 font-mono text-sm"
            value={cfAccountId}
            onChange={(e) => setCFAccountId(e.target.value)}
            placeholder="留空则沿用渠道级账户；填了则用此 Key 专属账户"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-24 text-right">CF Gateway</span>
          <input
            className="input flex-1 font-mono text-sm"
            value={cfGatewayId}
            onChange={(e) => setCFGatewayId(e.target.value)}
            placeholder="仅非 compat 渠道需要；留空沿用渠道级"
          />
        </div>
        <div className="flex items-center gap-2 pl-24">
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input
              type="checkbox"
              checked={byokMode}
              onChange={(e) => setByokMode(e.target.checked)}
            />
            BYOK 模式（OpenAI Key 已存 Cloudflare）
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={handleAdd} className="btn-primary text-sm">
            添加此 Key
          </button>
        </div>
      </div>
    </details>
  );
}
