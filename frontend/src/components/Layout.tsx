import { useState } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Key,
  Server,
  FlaskConical,
  BarChart3,
  Users,
  Heart,
  LogOut,
  UserCircle,
  RefreshCw,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "概览", icon: LayoutDashboard },
  { to: "/channels", label: "渠道管理", icon: Server },
  { to: "/aggregate-keys", label: "聚合密钥", icon: Key },
  { to: "/playground", label: "测试台", icon: FlaskConical },
  { to: "/stats", label: "用量统计", icon: BarChart3 },
  { to: "/health", label: "健康总览", icon: Heart },
];

const adminNavItems = [
  { to: "/users", label: "用户管理", icon: Users },
];

// 清空本地会话并跳登录页（退出登录 / 切换登录 共用）
function clearSessionAndGoLogin(navigate: (p: string) => void) {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("current_user");
  navigate("/login");
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await api.get("/auth/me");
      return res.data.data;
    },
  });

  const isAdmin = me?.role === "admin";

  return (
    <div className="min-h-screen flex">
      {/* 侧边栏 */}
      <aside className="w-64 bg-white/80 backdrop-blur-sm border-r border-pink-100 p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8 px-2">
          <Sparkles className="w-8 h-8 text-pink-400" />
          <div>
            <h1 className="text-lg font-bold text-pink-600">密钥池</h1>
            <p className="text-xs text-gray-500">Key Pool</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                  isActive
                    ? "bg-pink-100 text-pink-700 font-medium"
                    : "text-gray-600 hover:bg-pink-50 hover:text-pink-600"
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="pt-4 pb-2 px-3 text-xs font-medium text-gray-400 uppercase">
                管理
              </div>
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                      isActive
                        ? "bg-pink-100 text-pink-700 font-medium"
                        : "text-gray-600 hover:bg-pink-50 hover:text-pink-600"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* 用户信息 + 下拉菜单（个人中心 / 切换登录 / 退出登录） */}
        {me && (
          <div className="border-t border-pink-100 pt-4 mt-4 relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-pink-50 transition-colors text-left"
            >
              <div className="w-8 h-8 bg-pink-200 rounded-full flex items-center justify-center text-pink-700 font-bold text-sm">
                {me.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{me.username}</div>
                <div className="text-xs text-gray-500">
                  {me.role === "admin" ? "🛡️ 管理员" : "👤 用户"}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute bottom-full left-4 right-4 mb-2 z-50 bg-white rounded-xl shadow-lg border border-pink-100 py-1">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/profile");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-pink-50"
                  >
                    <UserCircle className="w-4 h-4 text-pink-500" />
                    个人中心
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      clearSessionAndGoLogin(navigate);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-pink-50"
                  >
                    <RefreshCw className="w-4 h-4 text-blue-500" />
                    切换登录
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      clearSessionAndGoLogin(navigate);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
