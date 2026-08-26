import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy, Trash2, Edit, Key, Eye, EyeOff, Users, Share2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, copyToClipboard } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth";
import SearchableSelect from "@/components/SearchableSelect";

interface AggregateKey {
  id: string;
  name: string;
  keyMasked: string;
  keyValue?: string; // 仅在创建时返回
  status: string;
  qpsLimit: number | null;
  expiresAt: number | null;
  ipWhitelist: string | null;
  isShared: boolean;
  ownerId: string;
  ownerUsername: string | null;
  createdAt: number;
}

interface ChannelModel {
  id: string;
  aliasName: string;
  realModel: string;
}

interface UserOption {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
}

export default function AggregateKeys() {
  const queryClient = useQueryClient();
  const { isAdmin } = useCurrentUser();
  const [showCreate, setShowCreate] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<string | null>(null);
  const [editing, setEditing] = useState<AggregateKey | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ["aggregate-keys"],
    queryFn: async () => {
      const res = await api.get("/aggregate-keys");
      return res.data.data as AggregateKey[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/aggregate-keys/${id}`);
    },
    onSuccess: () => {
      toast.success("聚合密钥已删除");
      queryClient.invalidateQueries({ queryKey: ["aggregate-keys"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">聚合密钥</h1>
          <p className="text-sm text-gray-500 mt-1">
            创建统一的 API Key（sk-xxxx）对外提供服务
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            创建聚合密钥
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="card bg-gradient-to-r from-pink-50 to-yellow-50 border border-pink-100">
          <p className="text-sm text-gray-600">
            🔒 当前为普通用户视图。聚合密钥的创建与绑定由管理员统一管理；你只能看到
            <span className="font-medium text-pink-600"> 管理员分配给你的密钥</span> 以及
            <span className="font-medium text-pink-600"> 共享给所有人的公共密钥</span>。
          </p>
        </div>
      )}

      {/* 外部调用指南：baseURL 可一键复制，便于接入 codex 等工具 */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Share2 className="w-4 h-4 text-pink-500" />
          <span className="font-semibold text-pink-600">🌐 外部调用指南（把聚合密钥接入 codex / OpenAI SDK / curl）</span>
        </div>
        <ApiUsageCard />
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : keys && keys.length > 0 ? (
          <div className="space-y-3">
            {keys.map((k) => (
              <div key={k.id} className="border-2 border-pink-100 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Key className="w-5 h-5 text-pink-500" />
                      <span className="font-semibold">{k.name}</span>
                      <span className={`badge ${k.status === "enabled" ? "badge-enabled" : "badge-disabled-status"}`}>
                        {k.status === "enabled" ? "🟢 启用" : "⚪ 禁用"}
                      </span>
                      {k.isShared && (
                        <span className="badge bg-blue-100 text-blue-600">
                          🤝 共享
                        </span>
                      )}
                      {isAdmin && (
                        <span className="badge bg-gray-100 text-gray-600">
                          👤 {k.ownerUsername || "未分配"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <code className="px-3 py-1.5 bg-pink-50 rounded-lg font-mono text-sm flex-1 truncate">
                        {k.keyMasked}
                      </code>
                      <button
                        onClick={() => copyToClipboard(k.keyMasked)}
                        className="btn-ghost"
                        title="复制脱敏 Key"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-xs text-gray-400 mt-2 space-x-3">
                      <span>QPS: {k.qpsLimit || "默认"}</span>
                      {k.expiresAt && <span>过期: {formatDate(k.expiresAt)}</span>}
                      <span>创建: {formatDate(k.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(isAdmin || k.ownerId) && (
                      <button onClick={() => setEditing(k)} className="btn-ghost">
                        <Edit className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await api.put(`/aggregate-keys/${k.id}`, {
                          status: k.status === "enabled" ? "disabled" : "enabled",
                        });
                        queryClient.invalidateQueries({ queryKey: ["aggregate-keys"] });
                      }}
                      className="btn-ghost"
                    >
                      {k.status === "enabled" ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("确定删除此聚合密钥？")) deleteMut.mutate(k.id);
                      }}
                      className="btn-ghost text-red-500"
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
            <Key className="w-12 h-12 text-pink-200 mx-auto mb-3" />
            <p className="text-gray-500">
              {isAdmin ? "还没有聚合密钥 🌸" : "管理员还没有为你分配密钥 🌸"}
            </p>
          </div>
        )}
      </div>

      {showCreate && isAdmin && (
        <CreateAggregateKeyDialog
          onClose={() => setShowCreate(false)}
          onSuccess={(plainKey) => {
            queryClient.invalidateQueries({ queryKey: ["aggregate-keys"] });
            setShowCreate(false);
            setNewlyCreated(plainKey);
          }}
        />
      )}

      {newlyCreated && (
        <NewKeyDialog plainKey={newlyCreated} onClose={() => setNewlyCreated(null)} />
      )}

      {editing && (
        <EditAggregateKeyDialog
          aggregateKey={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["aggregate-keys"] });
          }}
        />
      )}
    </div>
  );
}

// === 外部调用示例（baseURL 可复制，便于接入 codex / OpenAI SDK / curl）===
function ApiUsageCard({ apiKey }: { apiKey?: string }) {
  // 展示/复制用的 baseURL：优先用「外部域名」环境变量；未配置时回退到真实请求基地址（VITE_API_BASE_URL，即 CF 自动分配域名）。
  // ⚠️ 此处仅用于「外部调用指南」卡片显示与复制，真实请求（api.ts / Playground.tsx）仍走 VITE_API_BASE_URL，互不影响。
  const API_BASE =
    (import.meta.env.VITE_EXTERNAL_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "https://api.yuan2006.cc.cd").replace(/\/$/, "");
  const API_V1 = `${API_BASE}/v1`;
  const displayKey = apiKey || "<你的聚合密钥 sk-xxxx>";

  const sdkSnippet = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API_V1}",
  apiKey: "${displayKey}",
});

const res = await client.chat.completions.create({
  model: "你的模型别名",
  messages: [{ role: "user", content: "你好" }],
});
console.log(res.choices[0].message.content);`;

  const curlSnippet = `curl ${API_V1}/chat/completions \\
  -H "Authorization: Bearer ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "你的模型别名",
    "messages": [{ "role": "user", "content": "你好" }]
  }'`;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-gray-700 mb-1">① API 基地址（baseURL）</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-pink-50 rounded-lg font-mono text-sm break-all">
            {API_V1}
          </code>
          <button
            onClick={() => {
              copyToClipboard(API_V1);
              toast.success("已复制 baseURL");
            }}
            className="btn-primary flex items-center gap-1 shrink-0"
          >
            <Copy className="w-4 h-4" /> 复制
          </button>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-gray-700 mb-1">② 在 codex / OpenAI SDK 中调用</div>
        <CodeBlock code={sdkSnippet} />
      </div>

      <div>
        <div className="text-sm font-medium text-gray-700 mb-1">③ 或用 curl 测试</div>
        <CodeBlock code={curlSnippet} />
      </div>

      <p className="text-xs text-gray-400">
        💡 baseURL 末尾已含 <code>/v1</code>，SDK 会自动拼接 <code>/chat/completions</code>，请勿重复写。
        模型名填你在「聚合密钥 → 绑定」里设置的<strong>模型别名</strong>；鉴权用 Bearer + 聚合密钥。
      </p>
    </div>
  );
}

// 带一键复制的代码块
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="bg-gray-900 text-gray-100 rounded-xl p-3 pr-12 text-xs leading-relaxed overflow-x-auto max-h-64">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => {
          copyToClipboard(code);
          setCopied(true);
          toast.success("已复制到剪贴板");
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/15 hover:bg-white/30 text-white transition-colors"
        title="复制代码"
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

function CreateAggregateKeyDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (plainKey: string) => void }) {
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get("/channels");
      return res.data.data as any[];
    },
  });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get("/auth/users");
      return res.data.data as UserOption[];
    },
  });

  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [qpsLimit, setQpsLimit] = useState(60);
  const [ipWhitelistText, setIpWhitelistText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [bindingGroups, setBindingGroups] = useState<Array<{ channelId: string; modelAliases: string[] }>>([]);
  const [loading, setLoading] = useState(false);

  // 展开为后端需要的 bindings 结构
  const buildBindings = () =>
    bindingGroups.flatMap((g) =>
      g.modelAliases.map((m) => ({ channelId: g.channelId, modelAlias: m }))
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return toast.error("请输入名称");
    const bindings = buildBindings();
    if (bindings.length === 0) return toast.error("请至少添加一个绑定（渠道 + 模型）");
    if (!isShared && !ownerId) return toast.error("请选择归属用户，或将此密钥设为共享");
    setLoading(true);
    try {
      const res = await api.post("/aggregate-keys", {
        name,
        ownerId: isShared ? undefined : ownerId || undefined,
        isShared,
        qpsLimit,
        ipWhitelist: ipWhitelistText.split("\n").map((s) => s.trim()).filter(Boolean),
        expiresAt: expiresAt || undefined,
        note: note || undefined,
        bindings,
      });
      toast.success("聚合密钥创建成功 🌸");
      onSuccess(res.data.data.keyValue);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">🌸 创建聚合密钥</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">名称 *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="我的聚合密钥" />
            </div>
            <div>
              <label className="label">QPS 限制</label>
              <input type="number" className="input" value={qpsLimit} onChange={(e) => setQpsLimit(parseInt(e.target.value) || 60)} />
            </div>
          </div>

          {/* 归属 / 共享 */}
          <div className="border border-pink-100 rounded-xl p-3 bg-pink-50/30 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-pink-500" />
              <span className="font-medium text-sm">归属与共享</span>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                className="w-4 h-4"
              />
              <Share2 className="w-4 h-4 text-blue-500" />
              设为共享密钥（对所有用户可见可用）
            </label>
            {!isShared && (
              <div>
                <label className="label">归属用户 *</label>
                <SearchableSelect
                  value={ownerId}
                  onChange={setOwnerId}
                  placeholder="选择分配给哪个用户"
                  options={(users || []).map((u) => ({
                    value: u.id,
                    label: `${u.displayName || u.username}${u.role === "admin" ? "（管理员）" : ""}`,
                  }))}
                />
              </div>
            )}
            {isShared && (
              <p className="text-xs text-blue-600">共享密钥对所有用户可见，无需指定归属用户。</p>
            )}
          </div>

          <div>
            <label className="label">IP 白名单（每行一个 IP/CIDR，可选）</label>
            <textarea
              className="input min-h-[60px] font-mono text-sm"
              value={ipWhitelistText}
              onChange={(e) => setIpWhitelistText(e.target.value)}
              placeholder="192.168.1.1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">过期时间（可选）</label>
              <input type="datetime-local" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div>
              <label className="label">备注</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">绑定（渠道 + 模型）*</label>
              <button
                type="button"
                onClick={() => setBindingGroups([...bindingGroups, { channelId: "", modelAliases: [] }])}
                className="btn-secondary text-xs"
              >
                + 添加绑定
              </button>
            </div>
            <BindingEditor
              channels={channels || []}
              groups={bindingGroups}
              onChange={setBindingGroups}
            />
            <p className="text-xs text-gray-500 mt-2">
              💡 可多次点击「+ 添加绑定」关联<b>多个密钥池（渠道）</b>；同一模型别名也可绑定到不同渠道，从而实现多账户 / 负载均衡。每个渠道内的多把 Key 支持绑定<b>相同或不同</b>的模型。
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

function BindingEditor({
  channels,
  groups,
  onChange,
}: {
  channels: any[];
  groups: Array<{ channelId: string; modelAliases: string[] }>;
  onChange: (g: Array<{ channelId: string; modelAliases: string[] }>) => void;
}) {
  const update = (idx: number, patch: Partial<{ channelId: string; modelAliases: string[] }>) => {
    const next = groups.map((g, i) => (i === idx ? { ...g, ...patch } : g));
    onChange(next);
  };
  const remove = (idx: number) => onChange(groups.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <BindingGroupRow
          key={i}
          index={i}
          channels={channels}
          group={g}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}
      {groups.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">点击「+ 添加绑定」开始</p>
      )}
    </div>
  );
}

function BindingGroupRow({
  index,
  channels,
  group,
  onChange,
  onRemove,
}: {
  index: number;
  channels: any[];
  group: { channelId: string; modelAliases: string[] };
  onChange: (patch: Partial<{ channelId: string; modelAliases: string[] }>) => void;
  onRemove: () => void;
}) {
  const [models, setModels] = useState<ChannelModel[]>([]);
  const [search, setSearch] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [addingManual, setAddingManual] = useState(false);

  // 手动添加模型（当从厂商拉取失败时使用）
  const addManualModel = async () => {
    const name = manualModel.trim();
    if (!name || !group.channelId) return;
    if (models.some((m) => m.aliasName === name)) {
      toast.warning("该模型已存在");
      return;
    }
    setAddingManual(true);
    try {
      await api.post(`/channels/${group.channelId}/models`, {
        models: [{ aliasName: name, realModel: name }],
      });
      setManualModel("");
      loadModels();
      toast.success("已手动添加模型");
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "添加失败");
    } finally {
      setAddingManual(false);
    }
  };

  // 加载该渠道已有的模型列表
  const loadModels = () => {
    if (!group.channelId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    api
      .get(`/channels/${group.channelId}`)
      .then((res) => {
        if (!cancelled) setModels(res.data.data.models || []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.channelId]);

  // 从厂商实时拉取模型列表（调用后端 fetch-models），并自动写入该渠道
  const handleFetchFromVendor = async () => {
    if (!group.channelId) return;
    setFetching(true);
    try {
      const res = await api.post(`/channels/${group.channelId}/fetch-models`);
      const fetched = (res.data.data?.models || []) as string[];
      if (fetched.length === 0) {
        toast.warning("厂商未返回任何模型，可手动添加或检查渠道 Key");
        loadModels();
        return;
      }
      // 自动把拉取到的模型写入渠道（去重交给后端），随后刷新列表
      await api.post(`/channels/${group.channelId}/models`, {
        models: fetched.map((m) => ({ aliasName: m, realModel: m })),
      });
      loadModels();
      toast.success(`已从厂商拉取并添加 ${fetched.length} 个模型 🌸`);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "从厂商拉取失败");
    } finally {
      setFetching(false);
    }
  };

  const filtered = models.filter((m) =>
    m.aliasName.toLowerCase().includes(search.toLowerCase()) ||
    m.realModel.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (alias: string) => {
    const has = group.modelAliases.includes(alias);
    onChange({
      modelAliases: has
        ? group.modelAliases.filter((a) => a !== alias)
        : [...group.modelAliases, alias],
    });
  };

  const selectAllFiltered = () => {
    const set = new Set(group.modelAliases);
    filtered.forEach((m) => set.add(m.aliasName));
    onChange({ modelAliases: Array.from(set) });
  };

  const invertFiltered = () => {
    const set = new Set(group.modelAliases);
    filtered.forEach((m) => (set.has(m.aliasName) ? set.delete(m.aliasName) : set.add(m.aliasName)));
    onChange({ modelAliases: Array.from(set) });
  };

  return (
    <div className="border border-pink-100 rounded-xl p-3 bg-white">
      <div className="flex items-center gap-2">
        <SearchableSelect
          value={group.channelId}
          onChange={(v) => onChange({ channelId: v, modelAliases: [] })}
          placeholder="选择渠道"
          options={channels.map((c) => ({ value: c.id, label: `${c.name} (${c.type})` }))}
        />
        <button type="button" onClick={onRemove} className="btn-ghost text-red-500">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {group.channelId && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2">
            <input
              className="input flex-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模型名称 / 真实模型"
            />
            <button
              type="button"
              onClick={handleFetchFromVendor}
              disabled={fetching}
              title="从厂商实时拉取模型列表"
              className="btn-ghost text-xs flex items-center gap-1"
            >
              <RefreshCw className={fetching ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
              从厂商拉取
            </button>
            <button type="button" onClick={selectAllFiltered} className="btn-ghost text-xs">全选</button>
            <button type="button" onClick={invertFiltered} className="btn-ghost text-xs">反选</button>
          </div>
          {loadingModels ? (
            <div className="text-xs text-gray-400 py-2">加载模型中...</div>
          ) : models.length === 0 ? (
            <div className="space-y-2 py-2">
              <div className="text-xs text-gray-400">
                该渠道暂无模型，可点击「从厂商拉取」自动获取；若拉取失败（如渠道 Key 无效），也可手动添加。
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  value={manualModel}
                  onChange={(e) => setManualModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addManualModel();
                  }}
                  placeholder="手动输入模型名称，如 gpt-4o"
                />
                <button
                  type="button"
                  onClick={addManualModel}
                  disabled={addingManual || !manualModel.trim()}
                  className="btn-ghost text-xs"
                >
                  {addingManual ? "添加中..." : "添加"}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto pr-1">
              {filtered.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-pink-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={group.modelAliases.includes(m.aliasName)}
                    onChange={() => toggle(m.aliasName)}
                    className="w-4 h-4"
                  />
                  <span className="truncate" title={`${m.aliasName} → ${m.realModel}`}>
                    {m.aliasName}
                  </span>
                </label>
              ))}
            </div>
          )}
          {group.modelAliases.length > 0 && (
            <div className="mt-2 text-xs text-pink-600">
              已选 {group.modelAliases.length} 个模型：{group.modelAliases.join("、")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewKeyDialog({ plainKey, onClose }: { plainKey: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-2">🌸 聚合密钥已生成</h2>
        <p className="text-sm text-pink-500 mb-4">
          ⚠️ 请立即复制并保存！此完整 Key 仅显示一次。
        </p>
        <div className="bg-pink-50 rounded-xl p-4 flex items-center gap-2">
          <code className="flex-1 font-mono text-sm break-all">{plainKey}</code>
          <button
            onClick={() => {
              copyToClipboard(plainKey);
              toast.success("已复制到剪贴板");
            }}
            className="btn-primary flex items-center gap-1"
          >
            <Copy className="w-4 h-4" />
            复制
          </button>
        </div>
        <div className="mt-4 border border-pink-100 rounded-xl p-4 bg-pink-50/30">
          <div className="flex items-center gap-2 mb-3">
            <Share2 className="w-4 h-4 text-pink-500" />
            <span className="font-semibold text-pink-600">🌐 外部调用示例（复制到 codex / OpenAI SDK / curl）</span>
          </div>
          <ApiUsageCard apiKey={plainKey} />
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn-primary">我已保存</button>
        </div>
      </div>
    </div>
  );
}

function EditAggregateKeyDialog({ aggregateKey, onClose, onSuccess }: { aggregateKey: AggregateKey; onClose: () => void; onSuccess: () => void }) {
  const { isAdmin } = useCurrentUser();
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get("/channels");
      return res.data.data as any[];
    },
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get("/auth/users");
      return res.data.data as UserOption[];
    },
  });

  const [name, setName] = useState(aggregateKey.name);
  const [ownerId, setOwnerId] = useState(aggregateKey.ownerId || "");
  const [isShared, setIsShared] = useState(aggregateKey.isShared);
  const [qpsLimit, setQpsLimit] = useState(aggregateKey.qpsLimit || 60);
  const [status, setStatus] = useState(aggregateKey.status);
  const [ipWhitelistText, setIpWhitelistText] = useState(() => {
    if (!aggregateKey.ipWhitelist) return "";
    try {
      return (JSON.parse(aggregateKey.ipWhitelist) as string[]).join("\n");
    } catch {
      return "";
    }
  });
  const [bindingGroups, setBindingGroups] = useState<Array<{ channelId: string; modelAliases: string[] }>>([]);
  const [loading, setLoading] = useState(false);

  // 拉取当前密钥详情（含绑定）预填
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/aggregate-keys/${aggregateKey.id}`)
      .then((res) => {
        if (cancelled) return;
        const bindings = res.data.data.bindings || [];
        const grouped: Record<string, string[]> = {};
        for (const b of bindings) {
          if (!grouped[b.channelId]) grouped[b.channelId] = [];
          grouped[b.channelId].push(b.modelAlias);
        }
        setBindingGroups(Object.entries(grouped).map(([channelId, modelAliases]) => ({ channelId, modelAliases })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [aggregateKey.id]);

  const buildBindings = () =>
    bindingGroups.flatMap((g) =>
      g.modelAliases.map((m) => ({ channelId: g.channelId, modelAlias: m }))
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/aggregate-keys/${aggregateKey.id}`, {
        name,
        status,
        qpsLimit,
        isShared: isAdmin ? isShared : undefined,
        ownerId: isAdmin && !isShared ? ownerId || undefined : undefined,
        ipWhitelist: ipWhitelistText.split("\n").map((s) => s.trim()).filter(Boolean),
        bindings: buildBindings(),
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
      <div className="card w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">✏️ 编辑聚合密钥</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">QPS 限制</label>
              <input type="number" className="input" value={qpsLimit} onChange={(e) => setQpsLimit(parseInt(e.target.value) || 60)} />
            </div>
            <div>
              <label className="label">状态</label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="enabled">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          </div>

          {isAdmin && (
            <div className="border border-pink-100 rounded-xl p-3 bg-pink-50/30 space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="w-4 h-4" />
                <Share2 className="w-4 h-4 text-blue-500" />
                设为共享密钥（对所有用户可见可用）
              </label>
              {!isShared && (
                <div>
                  <label className="label">归属用户</label>
                  <SearchableSelect
                    value={ownerId}
                    onChange={setOwnerId}
                    placeholder="选择归属用户"
                    options={(users || []).map((u) => ({
                      value: u.id,
                      label: `${u.displayName || u.username}${u.role === "admin" ? "（管理员）" : ""}`,
                    }))}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label">IP 白名单（每行一个）</label>
            <textarea
              className="input min-h-[80px] font-mono text-sm"
              value={ipWhitelistText}
              onChange={(e) => setIpWhitelistText(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">绑定（渠道 + 模型）</label>
              <button
                type="button"
                onClick={() => setBindingGroups([...bindingGroups, { channelId: "", modelAliases: [] }])}
                className="btn-secondary text-xs"
              >
                + 添加绑定
              </button>
            </div>
            <BindingEditor channels={channels || []} groups={bindingGroups} onChange={setBindingGroups} />
          </div>

          <div className="flex justify-end gap-2">
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
