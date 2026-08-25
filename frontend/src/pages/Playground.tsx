import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, FlaskConical, Heart } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";

interface Combination {
  channelId: string;
  channelName: string;
  keyId: string;
  keyMasked: string;
  modelAlias: string;
  realModel: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export default function Playground() {
  const [channelId, setChannelId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: "你是一个有帮助的 AI 助手。" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: combinations } = useQuery({
    queryKey: ["playground-combinations"],
    queryFn: async () => {
      const res = await api.get("/playground/combinations");
      return res.data.data as Combination[];
    },
  });

  // 过滤出当前渠道的 Key
  const channelKeys = combinations?.filter((c) => c.channelId === channelId) || [];
  const channelModels = Array.from(new Set(channelKeys.map((k) => k.modelAlias)));

  const channelOptions = Array.from(new Set(combinations?.map((c) => c.channelId) || [])).map((id) => {
    const ch = combinations?.find((c) => c.channelId === id);
    return { value: id, label: ch?.channelName || id };
  });
  const keyOptions = Array.from(new Set(channelKeys.map((k) => k.keyId))).map((kid) => {
    const k = channelKeys.find((c) => c.keyId === kid);
    return { value: kid, label: k?.keyMasked || kid };
  });
  const modelOptions = channelModels.map((m) => ({ value: m, label: m }));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 当选择变化时，查询健康状态
  useEffect(() => {
    if (channelId && keyId && modelAlias) {
      api.get(`/playground/health?channelId=${channelId}&keyId=${keyId}&modelAlias=${encodeURIComponent(modelAlias)}`)
        .then((res) => setHealth(res.data.data))
        .catch(() => setHealth(null));
    } else {
      setHealth(null);
    }
  }, [channelId, keyId, modelAlias]);

  const handleSend = async () => {
    if (!input.trim() || !channelId || !keyId || !modelAlias) {
      toast.error("请选择渠道/Key/模型，并输入 Prompt");
      return;
    }
    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    // 添加一个空的 assistant 消息用于流式更新
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    try {
      const res = await fetch("/playground/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
        body: JSON.stringify({
          channelId,
          modelAlias,
          messages: newMessages,
          stream: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error?.message || "请求失败");
        setMessages(messages);
        return;
      }

      const data = await res.json();
      const reply = data.data?.response?.choices?.[0]?.message?.content || "(无回复)";
      const updated = [...newMessages, { role: "assistant" as const, content: reply }];
      setMessages(updated);
    } catch (err: any) {
      toast.error(err.message || "请求失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FlaskConical className="w-7 h-7 text-pink-500" />
          测试台
        </h1>
        <p className="text-sm text-gray-500 mt-1">选择渠道 + 模型，输入 Prompt 发起测试</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：选择区 */}
        <div className="card lg:col-span-1 space-y-3">
          <h3 className="font-semibold text-pink-600">⚙️ 配置</h3>

          <div>
            <label className="label">渠道</label>
            <SearchableSelect
              value={channelId}
              onChange={(v) => {
                setChannelId(v);
                setKeyId("");
                setModelAlias("");
              }}
              options={channelOptions}
              placeholder="搜索并选择渠道"
            />
          </div>

          <div>
            <label className="label">Key</label>
            <SearchableSelect
              value={keyId}
              onChange={setKeyId}
              options={keyOptions}
              placeholder="搜索并选择 Key"
            />
          </div>

          <div>
            <label className="label">模型</label>
            <SearchableSelect
              value={modelAlias}
              onChange={setModelAlias}
              options={modelOptions}
              placeholder="搜索并选择模型"
            />
          </div>

          {/* 健康状态 */}
          {health && (
            <div className="mt-4 p-3 rounded-xl bg-pink-50">
              <div className="text-xs font-medium text-pink-700 mb-1 flex items-center gap-1">
                <Heart className="w-3 h-3" />
                组合健康状态
              </div>
              {health.status === "healthy" && (
                <div className="text-sm">🟢 健康</div>
              )}
              {health.status === "cooling" && (
                <div className="text-sm">
                  🟡 冷却中<br />
                  <span className="text-xs text-gray-500">
                    {Math.max(0, Math.round((health.coolingUntil - Date.now()) / 1000))}s 后恢复
                  </span>
                </div>
              )}
              {health.status === "disabled" && (
                <div className="text-sm">🔴 已禁用（需手动重置）</div>
              )}
              {health.failureCount > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  失败次数：{health.failureCount}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧：对话区 */}
        <div className="card lg:col-span-3 flex flex-col h-[70vh]">
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2.5 rounded-2xl ${
                    m.role === "user"
                      ? "bg-pink-400 text-white"
                      : m.role === "system"
                      ? "bg-gray-100 text-gray-600 text-sm"
                      : "bg-pink-50 text-gray-800"
                  }`}
                >
                  <div className="text-xs opacity-70 mb-1">
                    {m.role === "user" ? "👤 你" : m.role === "system" ? "⚙️ System" : "🤖 AI"}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-pink-50 text-gray-500 px-4 py-2.5 rounded-2xl">
                  <span className="animate-pulse">🤖 AI 正在思考...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="mt-4 flex gap-2">
            <input
              className="input flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="输入 Prompt... (Enter 发送)"
              disabled={loading}
            />
            <button onClick={handleSend} disabled={loading} className="btn-primary flex items-center gap-1">
              <Send className="w-4 h-4" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
