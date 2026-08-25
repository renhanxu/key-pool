import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Heart, Key } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fetchCurrentUser } from "@/lib/auth";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("请输入用户名和密码");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { username, password });
      const { accessToken, refreshToken } = res.data.data;
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      // 缓存当前用户角色，供前端 UI 判断管理员能力
      try {
        await fetchCurrentUser();
      } catch {}
      toast.success("登录成功 🌸");
      navigate("/");
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-pink-100 rounded-full mb-4">
            <Sparkles className="w-10 h-10 text-pink-500" />
          </div>
          <h1 className="text-3xl font-bold text-pink-600 mb-2">密钥池中转站</h1>
          <p className="text-gray-500 flex items-center justify-center gap-1">
            聚合你的 API Key
            <Heart className="w-4 h-4 text-pink-400 fill-pink-400" />
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">用户名</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pink-300" />
                <input
                  type="text"
                  className="input pl-10"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
            </div>
            <div>
              <label className="label">密码</label>
              <input
                type="password"
                className="input"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? "登录中..." : "🌸 登录"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          首次部署使用 .dev.vars 中的 ADMIN_INIT_USERNAME / ADMIN_INIT_PASSWORD 登录
        </p>
      </div>
    </div>
  );
}
