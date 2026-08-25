import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCircle, Key, ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, copyToClipboard } from "@/lib/utils";

interface MeInfo {
  id: string;
  username: string;
  role: "admin" | "user";
  displayName: string | null;
  email: string | null;
  status: string;
  createdAt: number;
}

interface MyKey {
  id: string;
  name: string;
  keyMasked: string;
  status: string;
  isShared: boolean;
  ownerUsername: string | null;
}

export default function Profile() {
  const queryClient = useQueryClient();

  const { data: me, isLoading } = useQuery({
    queryKey: ["me-profile"],
    queryFn: async () => {
      const res = await api.get("/auth/me");
      return res.data.data as MeInfo;
    },
  });

  const { data: myKeys } = useQuery({
    queryKey: ["my-keys"],
    queryFn: async () => {
      const res = await api.get("/aggregate-keys");
      return res.data.data as MyKey[];
    },
  });

  if (isLoading) {
    return <div className="text-center py-12 text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <UserCircle className="w-7 h-7 text-pink-500" />
          个人中心
        </h1>
        <p className="text-sm text-gray-500 mt-1">查看账号信息、修改密码、管理你可用的密钥</p>
      </div>

      {/* 基本信息 */}
      <div className="card">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-pink-500" />
          基本信息
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <InfoRow label="用户名" value={me?.username || "-"} />
          <InfoRow
            label="角色"
            value={me?.role === "admin" ? "🛡️ 管理员" : "👤 普通用户"}
          />
          <InfoRow label="显示名称" value={me?.displayName || "-"} />
          <InfoRow label="邮箱" value={me?.email || "-"} />
          <InfoRow
            label="状态"
            value={me?.status === "active" ? "✅ 正常" : me?.status || "-"}
          />
          <InfoRow label="注册时间" value={me?.createdAt ? formatDate(me.createdAt) : "-"} />
        </div>
      </div>

      {/* 修改密码 */}
      <ChangePasswordCard />

      {/* 我可使用的密钥 */}
      <div className="card">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-pink-500" />
          我可使用的密钥
        </h2>
        {myKeys && myKeys.length > 0 ? (
          <div className="space-y-2">
            {myKeys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between border-2 border-pink-100 rounded-xl px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{k.name}</span>
                    <span className={`badge ${k.status === "enabled" ? "badge-enabled" : "badge-disabled-status"}`}>
                      {k.status === "enabled" ? "🟢 启用" : "⚪ 禁用"}
                    </span>
                    {k.isShared && (
                      <span className="badge bg-blue-100 text-blue-600">🤝 共享</span>
                    )}
                  </div>
                  <code className="text-xs text-gray-500 font-mono">{k.keyMasked}</code>
                </div>
                <button
                  onClick={() => copyToClipboard(k.keyMasked)}
                  className="btn-ghost"
                  title="复制脱敏 Key"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">
            管理员还没有为你分配密钥 🌸
          </p>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-400 text-xs mb-1">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}

function ChangePasswordCard() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      await api.post("/auth/change-password", { oldPassword, newPassword });
    },
    onSuccess: () => {
      toast.success("密码修改成功 🌸");
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error?.message || "修改失败");
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword) return toast.error("请输入当前密码");
    if (newPassword.length < 6) return toast.error("新密码至少 6 位");
    if (newPassword !== confirm) return toast.error("两次输入的新密码不一致");
    mut.mutate();
  };

  return (
    <div className="card">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Key className="w-5 h-5 text-pink-500" />
        修改密码
      </h2>
      <form onSubmit={submit} className="space-y-3 max-w-md">
        <div>
          <label className="label">当前密码</label>
          <input
            type="password"
            className="input"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label">新密码（至少 6 位）</label>
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">确认新密码</label>
          <input
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button type="submit" disabled={mut.isPending} className="btn-primary">
          {mut.isPending ? "保存中..." : "💾 保存修改"}
        </button>
      </form>
    </div>
  );
}
