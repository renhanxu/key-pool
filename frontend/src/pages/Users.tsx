import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Key } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  displayName: string | null;
  email: string | null;
  status: "active" | "disabled";
  createdAt: number;
  lastLoginAt: number | null;
}

export default function Users() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resettingPwd, setResettingPwd] = useState<User | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get("/auth/users");
      return res.data.data as User[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/auth/users/${id}`);
    },
    onSuccess: () => {
      toast.success("用户已删除");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">用户管理</h1>
          <p className="text-sm text-gray-500 mt-1">仅管理员可访问</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          新建用户
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : users && users.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-pink-100">
                <th className="py-2 px-2">用户名</th>
                <th className="py-2 px-2">角色</th>
                <th className="py-2 px-2">状态</th>
                <th className="py-2 px-2">邮箱</th>
                <th className="py-2 px-2">创建时间</th>
                <th className="py-2 px-2">最后登录</th>
                <th className="py-2 px-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-pink-50">
                  <td className="py-2 px-2 font-medium">{u.username}</td>
                  <td className="py-2 px-2">
                    {u.role === "admin" ? (
                      <span className="badge bg-pink-200 text-pink-700">🛡️ 管理员</span>
                    ) : (
                      <span className="badge bg-gray-100 text-gray-600">👤 用户</span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <span className={`badge ${u.status === "active" ? "badge-healthy" : "badge-disabled"}`}>
                      {u.status === "active" ? "🟢 活跃" : "🔴 禁用"}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-gray-500">{u.email || "—"}</td>
                  <td className="py-2 px-2 text-xs text-gray-500">{formatDate(u.createdAt)}</td>
                  <td className="py-2 px-2 text-xs text-gray-500">
                    {u.lastLoginAt ? formatDate(u.lastLoginAt) : "从未"}
                  </td>
                  <td className="py-2 px-2 flex items-center gap-1">
                    <button
                      onClick={async () => {
                        await api.put(`/auth/users/${u.id}/status`, {
                          status: u.status === "active" ? "disabled" : "active",
                        });
                        queryClient.invalidateQueries({ queryKey: ["users"] });
                      }}
                      className="btn-ghost text-xs"
                    >
                      {u.status === "active" ? "禁用" : "启用"}
                    </button>
                    <button onClick={() => setResettingPwd(u)} className="btn-ghost text-xs">
                      <Key className="w-3 h-3" />
                    </button>
                    <button onClick={() => setEditing(u)} className="btn-ghost">
                      <Edit className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`确定删除用户 ${u.username}？`)) deleteMut.mutate(u.id);
                      }}
                      className="btn-ghost text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-12 text-gray-400">暂无用户</div>
        )}
      </div>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ["users"] });
          }}
        />
      )}

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["users"] });
          }}
        />
      )}

      {resettingPwd && (
        <ResetPasswordDialog
          user={resettingPwd}
          onClose={() => setResettingPwd(null)}
          onSuccess={() => setResettingPwd(null)}
        />
      )}
    </div>
  );
}

function CreateUserDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/register", { username, password, role, email: email || undefined });
      toast.success("用户已创建");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">🌸 新建用户</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">用户名 *</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
          </div>
          <div>
            <label className="label">密码 *</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div>
            <label className="label">角色</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div>
            <label className="label">邮箱</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
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

function EditUserDialog({ user, onClose, onSuccess }: { user: User; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState(user.email || "");
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 实际项目应该有 update user 接口，这里只更新状态作为示例
      toast.info("用户编辑接口可在后端扩展");
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">✏️ 编辑用户</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">显示名</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="label">邮箱</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ user, onClose, onSuccess }: { user: User; onClose: () => void; onSuccess: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("密码至少 6 位");
      return;
    }
    setLoading(true);
    try {
      await api.post(`/auth/users/${user.id}/reset-password`, { newPassword });
      toast.success("密码已重置");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "重置失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">🔑 重置 {user.username} 的密码</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">新密码 *</label>
            <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "重置中..." : "💾 重置"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
