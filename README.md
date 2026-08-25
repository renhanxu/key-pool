# 密钥池中转站 / Key Pool

> 🌸 聚合多厂商 API Key，生成统一聚合密钥（`sk-xxxx`），对外提供 OpenAI 兼容接口。
> 个人自用项目，**完全免费部署在 Cloudflare Workers + Pages** 上。

---

## ✨ 一键部署到 Cloudflare（推荐）

本仓库已经按 Cloudflare 控制台直接导入的方式组织好（`key-pool/` 是后端，`frontend/` 是前端）。

### 方式 A：Cloudflare 仪表盘 — Connect to Git（最省事，零命令）

1. **后端 Workers**
   - Cloudflare 控制台 → Workers & Pages → **Create application** → Workers → **Import from Git**
   - 选择本仓库 → Build command 留空 → Deploy command 留空 → Root directory 填 `key-pool`
   - 第一次 deploy 会报"未配置 D1/KV"——按下方「**首次必须执行的预配置**」先建好资源，再回来点 **Save and Deploy**

2. **前端 Pages**
   - Workers & Pages → **Create application** → Pages → **Import from Git** → 选同一个仓库
   - Root directory 填 `frontend`
   - Build command `npm run build`
   - Build output directory `dist`
   - 添加环境变量 `VITE_API_BASE_URL = https://<后端域名>`（用方式 A 第 1 步拿到的域名）

### 方式 B：本地 wrangler CLI 部署（备选）

详见 [DEPLOY.md](./DEPLOY.md)。

---

## 📦 项目结构

```
.
├── key-pool/           # 后端：Cloudflare Workers + D1 + KV + Cron
│   ├── src/            # 23 个 TS 源文件（路由 / 服务 / 中间件 / 工具）
│   ├── migrations/     # D1 迁移：初始 + 共享密钥 + 每 Key 独立 CF 账户
│   └── wrangler.toml   # Worker 配置（含 D1/KV binding）
├── frontend/           # 前端：React 18 + Vite + Tailwind（粉色少女心）
│   ├── src/
│   │   ├── pages/      # 9 个页面（仪表盘/渠道/聚合密钥/Playground/...）
│   │   ├── components/ # 布局、错误边界、可搜索下拉
│   │   └── lib/        # API 客户端、鉴权、工具
│   └── public/
│       └── _redirects  # Pages SPA 路由 fallback
├── DEPLOY.md           # 完整的 Cloudflare 免费部署教程
└── README.md           # 本文件
```

---

## 🚀 首次必须执行的预配置

无论用方式 A 还是 B，**后端依赖 4 个 Cloudflare 资源**必须先建好（资源 ID 会写进 `wrangler.toml` 和 Secrets）：

| 资源 | 数量 | 命令 | 用途 |
|---|---|---|---|
| D1 数据库 | 1 个 | `wrangler d1 create key-pool-db` | 存储用户、渠道、密钥、绑定、日志 |
| KV 命名空间 | 2 个（生产 + preview） | `wrangler kv namespace create HEALTH_KV` / `--preview` | 健康状态高频读写 |
| Workers Secret | 4 个 | `wrangler secret put ...` | JWT 密钥、API Key 加密密钥、管理员账号密码 |

具体命令、配置位置、必设 Secrets 清单，**看 [DEPLOY.md 第四章到第五章](./DEPLOY.md#四创建-cloudflare-资源)**——每一步都给了现成的命令和示例输出。

---

## 🩺 部署后自检（5 分钟）

按 [DEPLOY.md 第十二章「部署检查清单」](./DEPLOY.md#十二部署检查清单-) 跑一遍：
- `https://<后端>.workers.dev/health` 返回 200
- 前端能加载、能登录、能创建渠道 + 聚合密钥
- 测试台发消息能收到回复
- 可选：用 `curl` 调 `/v1/chat/completions` 验证

---

## 🔒 安全与已知限制

详见 [DEPLOY.md 第十章「部署须知与已知限制」](./DEPLOY.md#十部署须知与已知限制)。

简要版：
- **CORS 全局允许 `*`**：上线后建议改为白名单你的前端域
- **限流中间件已实现但未挂载**：依赖 Cloudflare 平台配额
- **`QPSLimit`/`ConcurrentLimit` 未强制节流**
- **API Key 加密用 AES-GCM**，强随机密钥未设置时降级为 base64（仅本地）
- **前端 Token 存 localStorage**，未自动用 refresh token 续期

---

## 🌸 功能特性

- 智能选择（按权重加权随机） + 失败转移（3 次重试） + 冷却机制（指数退避 30s→30min）
- 401/403 直接 disabled
- 等效降级（模型全失败时切 fallback 模型）
- 定时健康探测（`*/5 * * * *` Cron Trigger）
- 完整请求日志 + 审计日志（可导出 CSV）
- **Cloudflare AI Gateway** 模式（含统一接口 compat、每 Key 独立 CF 账户）
- **聚合密钥 ↔ 多密钥池绑定**（一个密钥可绑多个渠道，同模型可跨渠道负载均衡/降级）
- 用户归属 + 共享密钥 + 用量统计多维筛选
- 粉色少女心管理后台（Tailwind 自定义主题）

---

## 📄 文档

- **[DEPLOY.md](./DEPLOY.md)** — 完整部署教程（13 章）
- **[密钥池中转站-需求文档与开发提示词.docx](./密钥池中转站-需求文档与开发提示词.docx)** — 项目原始需求

---

## 📜 License

个人项目，按原样使用即可。