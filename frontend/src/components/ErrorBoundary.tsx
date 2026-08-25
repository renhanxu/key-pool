import React from "react";

interface State {
  hasError: boolean;
  message: string;
}

/**
 * 全局错误边界：捕获任何渲染期/运行时异常，
 * 避免整页白屏（用户感知为“乱码/卡死”）。
 * 提供「返回登录页」与「重试」两个出口，满足“出问题统一回到登录页”的诉求。
 *
 * 注意：本组件刻意渲染在 BrowserRouter 之外，因此兜底 UI 不依赖 Router 上下文，
 * 统一使用 window.location 跳转/刷新，避免在异常状态下再次触发 hook 报错。
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message || String(error) };
  }

  componentDidCatch(error: any, info: any) {
    console.error("[ErrorBoundary] 捕获到未处理异常：", error, info);
  }

  handleBackToLogin = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("current_user");
    window.location.href = "/login";
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback message={this.state.message} onLogin={this.handleBackToLogin} />;
  }
}

function ErrorFallback({ message, onLogin }: { message: string; onLogin: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-pink-50 to-rose-50">
      <div className="card w-full max-w-md text-center">
        <div className="text-5xl mb-4">🌸</div>
        <h1 className="text-xl font-bold text-pink-600 mb-2">页面出了点小问题</h1>
        <p className="text-sm text-gray-500 mb-4">
          系统遇到一个未处理的错误。你可以返回登录页重新进入，或重试当前操作。
        </p>
        {message && (
          <pre className="text-left text-xs text-gray-400 bg-gray-50 rounded-lg p-3 mb-4 max-h-32 overflow-auto whitespace-pre-wrap">
            {message}
          </pre>
        )}
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => window.location.reload()} className="btn-secondary">
            重试
          </button>
          <button onClick={onLogin} className="btn-primary">
            返回登录页
          </button>
        </div>
      </div>
    </div>
  );
}
