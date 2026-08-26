# Cloudflare 免费部署教程

> 本文档专门说明如何把"密钥池中转站"项目部署到 Cloudflare Workers 免费套餐。  
> **目标读者**：已经能跑通本地 wrangler dev 的开发者。  
> **预计时间**：15-30 分钟（包含 Cloudflare 账号注册）。  
> **费用**：**完全免费**，全部走 Cloudflare 免费额度，无需信用卡。

---

## 一、为什么选 Cloudflare Workers？

密钥池中转站的核心需求：

| 需求 | Workers 对应能力 | 是否在免费额度内 |
|---|---|---|
| 后端运行时 | Workers (V8 isolate) | ✅ 10 万请求/天 |
| 数据库 | D1（SQLite） | ✅ 5 GB 存储、500 万次读/天 |
| 缓存 / KV | Workers KV | ✅ 10 万次读/天、1 万次写/天 |
| 定时任务 | Cron Triggers | ✅ |
| 静态前端 | Pages | ✅ 无限请求、无限带宽 |
| HTTPS / CDN | 全自动 | ✅ |

> **不需要**：Express、PostgreSQL、Redis、Docker、服务器。

---

## 二、前置准备

### 1. 安装 Node.js

需要 **Node.js 18+**（建议 20+）。

```bash
# macOS
brew install node

# Windows（管理员 PowerShell）
winget install -e --id OpenJS.NodeJS

# Linux (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

验证：
```bash
node -v    # 应输出 v18.x 或更高
npm -v
```

### 2. 注册 Cloudflare 账号（免费）

前往 <https://dash.cloudflare.com/sign-up> 注册一个账号。
- **不需要信用卡**
- 免费计划即可使用 Workers、D1、KV、Cron Triggers

### 3. 全局安装 Wrangler

```bash
npm install -g wrangler
```

验证：
```bash
wrangler --version
```

### 4. 登录 Cloudflare

```bash
wrangler login
```

这会打开浏览器，授权 Wrangler CLI 访问你的 Cloudflare 账号。授权完成后回到终端，终端会显示 `Successfully logged in.`

---

## 三、获取项目代码

如果你已经有了项目代码，进入项目目录；否则克隆：

```bash
# 示例：克隆
git clone <your-repo-url> key-pool
cd key-pool

# 或：使用本项目代码
cd API中转系统/key-pool
```

### 安装依赖

```bash
npm install
```

> 关键依赖：`hono`（Web 框架）、`drizzle-orm`（ORM）、`bcryptjs`（密码哈希）、`jose`（JWT）、`zod`（校验）。

---

## 四、创建 Cloudflare 资源

### 1. 创建 D1 数据库

```bash
wrangler d1 create key-pool-db
```

终端会输出类似：

```
✅ Successfully created DB 'key-pool-db'!

[[d1_databases]]
binding = "DB"
database_name = "key-pool-db"
database_id = "abcd1234-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**复制 `database_id` 字段**，打开项目里的 `wrangler.toml`，把下面这行：

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

替换为真实的 id。

### 2. 创建 KV 命名空间

```bash
# 生产环境
wrangler kv namespace create "HEALTH_KV"

# 本地预览环境（wrangler dev 使用的）
wrangler kv namespace create "HEALTH_KV" --preview
```

每个命令都会输出：

```
✅ Created namespace with ID: "efgh5678-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把两个 id 分别填到 `wrangler.toml` 的 `id` 和 `preview_id`。

修改后 `wrangler.toml` 看起来像这样：

```toml
[[d1_databases]]
binding = "DB"
database_name = "key-pool-db"
database_id = "abcd1234-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "HEALTH_KV"
id = "efgh5678-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
preview_id = "1234abcd-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

## 五、配置环境变量（密钥）

### 1. 本地：创建 `.dev.vars`

在项目根目录创建 `.dev.vars`（**不要提交到 git**）：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```ini
# JWT 签名密钥（强随机，至少 32 个字符）
JWT_SECRET="my-super-secret-key-please-replace-this-with-a-real-random-32+chars-string"

# API Key / AIG Token 加密密钥（AES-GCM 256-bit，强随机，建议 ≥32 字节）
# 不配置则降级为 base64（仅本地开发，不安全）
KEY_ENCRYPTION_KEY="another-super-secret-random-string-at-least-32-bytes-long-here"

# 首次部署时的超级管理员用户名
ADMIN_INIT_USERNAME="admin"

# 首次部署时的超级管理员密码（部署后请立即登录修改）
ADMIN_INIT_PASSWORD="Admin@123456"
```

> 💡 **生产环境不要用示例密码！**  
> 生成随机密钥的方法：  
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### 2. 远程：配置 Workers Secrets（必须）

生产环境**务必**用 `wrangler secret` 单独管理敏感变量（不要写进 `wrangler.toml`）：

```bash
wrangler secret put JWT_SECRET            # JWT 签名密钥
wrangler secret put KEY_ENCRYPTION_KEY    # API Key 加密密钥（缺省时存储退化为明文 base64）
wrangler secret put ADMIN_INIT_USERNAME   # 初始管理员用户名
wrangler secret put ADMIN_INIT_PASSWORD   # 初始管理员密码
# 粘贴对应强随机字符串 / 密码，回车
```

> `ADMIN_INIT_USERNAME` 等非敏感配置也可保留在 `wrangler.toml` 的 `[vars]` 段。  
> 这四个 secret 缺失时：JWT 无法签发、Key 无法加密、管理员无法初始化——**部署前请确认已设置**。

---

## 六、初始化数据库（迁移）

### 1. 应用迁移到本地数据库（先测）

```bash
# 自动读取 migrations/*.sql 并应用到本地 D1
wrangler d1 migrations apply key-pool-db --local
```

输出类似：
```
🌀 Mapping SQL input into an array of statements
🌀 Executing on local database key-pool-db (xxxx) via wrangler
✅ Successfully applied 1 migration(s)
```

### 2. 应用迁移到远程数据库

确认 `wrangler.toml` 里的 `database_id` 已经替换为真实值后：

```bash
wrangler d1 migrations apply key-pool-db --remote
```

> ⚠️ **这一步会真正写入 Cloudflare D1**，但因为是新建的库，没有任何数据，所以是安全的。

---

## 七、本地启动测试

### 启动后端（Workers）

```bash
wrangler dev
```

输出：
```
⛅️ wrangler 3.x.x
Starting local server...
Ready on http://localhost:8787
```

> 验证后端：浏览器访问 <http://localhost:8787/health>，应返回 `{"status":"ok",...}`

### 启动前端（另开一个终端）

```bash
cd ../frontend
npm install
npm run dev
```

输出：
```
  VITE v5.x.x  ready in 500 ms
  ➜  Local:   http://localhost:5173/
```

> 前端在 5173，后端在 8787。`vite.config.ts` 里已经配好了代理，登录页直接可用。

### 本地功能测试流程

1. 打开 <http://localhost:5173/>
2. 用 `ADMIN_INIT_USERNAME` / `ADMIN_INIT_PASSWORD` 登录
3. **创建一个测试渠道**（推荐用 Cloudflare Workers AI 的免费 Key，或用本地 mock）
4. 录入 Key、点击「从厂商拉取」获取模型列表
5. **创建一个聚合密钥**，绑定上面的渠道+模型（绑定行支持「从厂商拉取」；渠道已有模型可直接勾选，为空可就地拉取）
6. **进入测试台**，发一条消息验证
7. 查看「健康总览」、「用量统计」是否正常

> 测试 OK 后再继续部署。如果本地跑不通，部署到线上也一定跑不通。

---

## 八、部署到 Cloudflare（正式上线）

### 1. 部署后端 Workers

在 `key-pool` 目录下：

```bash
wrangler deploy
```

成功输出：
```
Total Upload: xx.xx KiB / gzip: xx.xx KiB
Uploaded key-pool (x.xxs)
Published key-pool (x.xxs)
  https://key-pool.<your-subdomain>.workers.dev
```

> 🌐 这就是你的 API 服务地址，例如 `https://key-pool.my-name.workers.dev`

### 2. 部署前端到 Cloudflare Pages

进入前端目录：

```bash
cd ../frontend
npm install
npm run build
```

构建产物在 `frontend/dist/`。

首次部署到 Pages：

```bash
wrangler pages deploy dist --project-name=key-pool-frontend
```

> 第一次会提示你创建项目，按提示操作即可。  
> 也可以在 Cloudflare 控制台 → Pages 里手动创建项目，Build command 填 `npm run build`，Build output 填 `dist`。

成功后会得到：
```
✨ Success! Uploaded xx files
🌎 Deploy complete! 
✨ Deployment complete! Take a peek over at https://xxxx.key-pool-frontend.pages.dev
```

> 💡 之后每次改前端代码，只需：  
> `npm run build && wrangler pages deploy dist --project-name=key-pool-frontend`

### 3. 前端配置后端地址

前端需要知道后端 Workers 的地址。

创建 `frontend/.env.production`：

```ini
VITE_API_BASE_URL=https://key-pool.<your-subdomain>.workers.dev
```

然后重新构建部署：

```bash
npm run build
wrangler pages deploy dist --project-name=key-pool-frontend
```

---

## 九、上线后维护

### 1. 实时查看日志

```bash
wrangler tail
```

按 `Ctrl+C` 退出。

### 2. 更新代码后重新部署

```bash
# 后端
cd key-pool
wrangler deploy

# 前端
cd frontend
npm run build
wrangler pages deploy dist --project-name=key-pool-frontend
```

> 整个过程通常 5-15 秒。

### 3. 数据库迁移（新增表 / 改字段时）

```bash
# 1. 本地迁移文件准备：在 key-pool/migrations/ 下新增 SQL 文件

# 2. 本地先测
wrangler d1 migrations apply key-pool-db --local

# 3. 没问题后应用到线上
wrangler d1 migrations apply key-pool-db --remote
```

### 4. 修改 / 重置管理员密码

如果忘记密码，可以用 `wrangler secret` 重置 `ADMIN_INIT_PASSWORD` 后再部署一次。
或者登录后在「修改密码」里改。

### 5. 备份 / 查看 D1 数据

```bash
# 进入 D1 控制台
wrangler d1 execute key-pool-db --command "SELECT * FROM users LIMIT 10"

# 导出全量数据
wrangler d1 export key-pool-db --output=backup.sql
```

### 6. 可选：绑定自定义域名

如果你有自己的域名（且已托管在 Cloudflare）：

1. 打开 Cloudflare 控制台 → Workers & Pages → 选中你的项目
2. 点击 **Triggers** → **Custom Domains** → **Set up a custom domain**
3. 输入你的域名（如 `api.example.com`），Cloudflare 会自动加 DNS 记录
4. HTTPS 证书自动签发

免费额度同样支持自定义域名，**不强制要求**，用默认的 `*.workers.dev` 域名就够用。

### 7. 更换 / 切换对外域名（展示与真实请求分离）

「聚合密钥」页对外提供的 baseURL（复制给 codex / OpenAI SDK / curl 用）与前端自身真正发起的请求，**走的是两个独立变量**，所以换域名时只需动一处，不会影响后台正常使用：

| 变量 | 用途 | 典型值 |
|---|---|---|
| `VITE_API_BASE_URL` | **真实请求**：登录、列表、测试台、所有接口调用 | CF 自动分配的 `https://key-pool.<sub>.workers.dev`（建议长期保留，最稳） |
| `VITE_EXTERNAL_API_BASE_URL` | **仅展示/复制**：聚合密钥页「外部调用指南」卡片里显示的 baseURL | 你的对外域名，如 `https://api.example.com` |

> 设计意图：`VITE_API_BASE_URL` 保留为 CF 自动分配的 `*.workers.dev`，这样即使自定义域名（DNS / 证书）出故障，管理后台自身依然能正常连后端；只有"对外发布的接入地址"用自定义域名，二者解耦。

**以后想换对外域名，只需两步：**

1. 修改 `frontend/.env.production`，把 `VITE_EXTERNAL_API_BASE_URL` 改成新域名（保留 `VITE_API_BASE_URL` 那行不动）：
   ```ini
   VITE_API_BASE_URL=https://key-pool.<sub>.workers.dev
   VITE_EXTERNAL_API_BASE_URL=https://新域名
   ```
2. 重新部署前端：
   ```bash
   cd frontend
   npm run build
   wrangler pages deploy dist --project-name=key-pool-frontend
   ```

⚠️ **如果你前端的 `VITE_API_BASE_URL` 是在 Cloudflare Pages 控制台 → Settings → Environment variables 里设置的（而非只用仓库 `.env.production`）**，那么 `VITE_EXTERNAL_API_BASE_URL` 也必须在控制台同一处补一条同名的变量再重部署，否则该变量不会注入到构建产物，卡片仍会回退显示 `VITE_API_BASE_URL`。

> 在代码里，`VITE_EXTERNAL_API_BASE_URL` 仅在 `frontend/src/pages/AggregateKeys.tsx` 的 `ApiUsageCard` 组件中被读取（取值优先级：`VITE_EXTERNAL_API_BASE_URL` → `VITE_API_BASE_URL` → 兜底字符串）；`api.ts` 与 `Playground.tsx` 的真实请求始终用 `VITE_API_BASE_URL`，不受对外域名切换影响。

---

## 十、Cloudflare 免费额度详解

| 资源 | 免费额度 | 我们的用量级 |
|---|---|---|
| Workers 请求 | 100,000 次/天 | 个人自用基本不会超 |
| Workers CPU 时间 | 10 ms/请求 | 注意：长任务可能超 |
| D1 存储 | 5 GB | 几十万个请求日志都够用 |
| D1 读 | 5,000,000 次/天 | — |
| D1 写 | 100,000 次/天 | 注意：请求日志可能写多 |
| KV 读 | 100,000 次/天 | 健康状态读取 |
| KV 写 | 1,000 次/天 | 每次失败/成功都会写 KV |
| Pages 请求 | 无限 | — |
| Pages 带宽 | 无限 | — |

### 减少 KV 写入的小技巧

每次请求都会更新健康状态，可能导致 KV 写爆。建议：

- 把 `wrangler.toml` 里的 Cron 频率从 `*/5 * * * *` 调成 `*/15 * * * *` 或更稀疏
- 在 `HealthService.markSuccess` 里加一个最小写入间隔（比如：仅当状态有变化时才写）
- 调整冷却时间 / 失败阈值，让冷却状态不会频繁切换

---

## 十½、部署须知与已知限制

部署前请留意以下几点（均为设计取舍，不影响基本可用）：

- **四个 Secret 必须设置**：`JWT_SECRET`、`KEY_ENCRYPTION_KEY`、`ADMIN_INIT_USERNAME`、`ADMIN_INIT_PASSWORD`。漏设会导致无法登录 / 无法加密 / 无管理员。
- **API Key 加密**：已用 AES-GCM（256-bit，`KEY_ENCRYPTION_KEY` 派生）。**未设置 `KEY_ENCRYPTION_KEY` 时退化为 base64，等同于明文**，仅适合本地。
- **CORS 为全局允许（`*`）**：`src/index.ts` 用 `cors()` 不限制来源。若前端与后端不同域且担心被滥用，建议改为 `cors({ origin: ["https://你的前端域名"] })`。
- **限流未启用**：`src/middleware/rate-limit.ts` 已实现，但当前没有路由挂载它。登录接口与 `/v1` 中继**没有速率限制**，请依赖 Cloudflare 平台限额 + 强密码 + IP 白名单（聚合密钥支持）。
- **QPS / 并发限制未强制**：渠道与聚合密钥上的 `qpsLimit`、`concurrentLimit` 字段会入库，但转发时未做硬性节流。
- **前端登录态**：Token 存 `localStorage`，且**未自动用 refresh token 续期**，access token 2 小时过期后会被跳回登录页（后端 `/auth/refresh` 已就绪，前端待接入）。
- **定时任务对 AI Gateway 渠道**：Cron 探测已支持 AIG URL，但前提是该渠道的 Key 配置了 `AIG Token` 且非 BYOK（BYOK 模式下 provider key 为空，探测会按普通鉴权失败）。

---

## 十¾、用户归属 / 共享密钥 / 用量筛选（新功能）

根据需求文档补齐的四项能力，部署 / 使用时请留意：

### 1. 聚合密钥 ↔ 密钥池绑定
- 创建 / 编辑聚合密钥时，**绑定（渠道 + 模型）** 现在是下拉多选：先选渠道，再从该渠道已拉取的模型列表里勾选（支持搜索、全选 / 反选），不再是手写模型别名。
- 模型别名必须来自对应渠道的 `channel_models`，否则转发时找不到真实模型。

### 2. 用户 ↔ 聚合密钥归属（管理员分配）
- **聚合密钥的创建与绑定统一由管理员完成**（普通用户调用 `POST /aggregate-keys` 会返回 403）。
- 管理员在创建 / 编辑时可为密钥指定「归属用户」（`ownerId`）。
- 普通用户登录后，**只能看到「管理员分配给自己的密钥」**；看不到别人的密钥。
- 后端 `listByOwner` 已严格按 `ownerId` 过滤，权限无法被前端绕过。

### 3. 公共 / 共享密钥
- 创建 / 编辑时可勾选「设为共享密钥」（`is_shared=1`）。
- 共享密钥**对所有用户可见可用**，无需指定归属用户。
- 普通用户登录后会看到「自己的密钥」+「共享密钥」。
- 非管理员不允许把自己密钥改成共享（后端已拦截 `isShared` / `ownerId` 的越权修改）。

### 4. 用量统计多维筛选
- 「用量统计」页新增筛选栏：**按聚合密钥 / 按渠道厂商 / 按模型 / 按用户（仅管理员）**，可叠加时间范围。
- 后端 `overview / timeline / by-error-type / by-model / logs / logs/export` 均已支持 `aggregateKeyId`、`channelId`、`modelAlias`、`userId(管理员)` 参数。
- CSV 导出同样会带上上述筛选条件。

### 5. 渠道厂商列表（渠道管理页）

- 渠道管理页顶部新增「渠道厂商」卡片，按需求文档列出所有预置厂商类型：**OpenAI / Anthropic / Google Gemini / Azure OpenAI / Cloudflare Workers AI / Cloudflare AI Gateway（OpenAI·Anthropic·Gemini 三种）/ 自定义 OpenAI 兼容中转站**。
- 点击任一厂商卡片即**带预填打开「新建渠道」对话框**（渠道类型与默认 Base URL 已填好），无需手动在类型下拉里找。

### 6. 新增密钥对话框「从厂商拉取」模型

- 创建 / 编辑聚合密钥时，每个「绑定（渠道 + 模型）」行新增「从厂商拉取」按钮。
- 当所选渠道尚未拉取过模型、或想刷新最新模型清单时，**无需离开对话框去渠道管理页**，直接点「从厂商拉取」即可调用后端 `POST /channels/:id/fetch-models` 并刷新该行的模型勾选列表。
- 该功能依赖后端能出网访问对应厂商 API；若本机网络 / 代理不通会弹出错误提示（预期行为，可在能联网时再拉取）。

> 数据库迁移 `0001_add_shared_flag.sql` 新增了 `aggregate_keys.is_shared` 列；**部署前请务必 `wrangler d1 migrations apply key-pool-db --remote`**（本地则 `--local`），否则 `is_shared` 列不存在，聚合密钥接口会 500。

---

## 十一、常见问题

### Q1: `wrangler d1 migrations apply` 报 "no migrations folder"

确保你是在 `key-pool` 目录下执行命令，并且 `migrations/` 文件夹下有 `.sql` 文件。

### Q2: `wrangler dev` 启动后访问 /v1/chat/completions 报 401

聚合密钥不存在或被禁用。请登录管理后台检查密钥状态。

### Q3: 部署后页面 404

如果部署的是 Pages 的 SPA 模式，需要在 `frontend/public` 下加一个 `_redirects` 文件：

```
/*    /index.html   200
```

或者在 Cloudflare Pages 控制台 → Settings → Builds → 勾选 "Build command" / "Output directory"。

### Q4: 跨域（CORS）报错

`src/index.ts` 里已经配置了 `cors()` 全局允许，应该不会有问题。如果仍报错，把前端地址加入 `cors({ origin: [...] })` 白名单。

### Q5: 想看后端实时请求日志

```bash
wrangler tail --format=pretty
```

### Q6: 如何彻底删除一个已部署的项目

```bash
wrangler delete
```

> ⚠️ 这是**危险操作**，会删除线上代码和配置（KV / D1 不会自动删除，需到控制台手动清理）。

### Q7: 登录提示「登录失败」/ `Invalid username or password`

这是部署后最高频的问题，按发生概率排序：

1. **远程 D1 没有执行迁移（最常见）** —— 部署代码（`wrangler deploy`）**不会**自动建表。如果只部署、没跑迁移，`users` 表不存在，管理员初始化会失败且被吞掉，库里没有任何账号，登录必然失败。
   ```bash
   # 确认 wrangler.toml 的 database_id 已是真实值后执行：
   wrangler d1 migrations apply key-pool-db --remote
   # 然后访问一次后端根路径或 /health，触发管理员自动创建；随后用 ADMIN_INIT_USERNAME / ADMIN_INIT_PASSWORD 登录
   ```
2. **`wrangler.toml` 里的 `database_id` / KV `id` 还是占位符 `REPLACE_WITH_...`** —— 部署会绑定到一个不存在的数据库，所有涉及 D1 的请求都会 500。
3. **管理员密码与预期不符** —— 管理员只在「库里一个用户都没有」时，用 `ADMIN_INIT_USERNAME` / `ADMIN_INIT_PASSWORD` 创建一次。如果你之前用别的密码创建过、或远程 secret 与本地 `.dev.vars` 不一致，请用远程 secret 的值登录；忘记密码可用 `wrangler secret put ADMIN_INIT_PASSWORD` 重置后重新 `wrangler deploy`。
4. **后端根本没起来** —— 前端 `dist` 直连后端时，若后端没运行，前端只显示笼统的「登录失败」（没有后端返回的具体 message）。先用 `curl https://你的后端/health` 确认后端在线。

> 新版本已增强可观测性：初始化失败时会在首次请求抛出真实错误（如 `no such table: users`），并写进日志；登录时若库里一个用户都没有，会直接提示「系统尚未初始化：请执行迁移」。排查时看 `wrangler tail`。

### Q8: `wrangler dev` / `wrangler d1 migrations apply` 卡住、报代理或网络相关错误

本机若设置了本地代理环境变量（常见于 Clash / 7897 端口），Wrangler 会检测到并强制走代理，可能导致本地迁移/启动失败且报错不明显：

```text
Proxy environment variables detected. We'll use your proxy for fetch requests.
```

解决：临时去掉代理再运行（特别是本地 D1 迁移和 `wrangler dev`）：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY npx wrangler dev
env -u HTTP_PROXY -u HTTPS_PROXY wrangler d1 migrations apply key-pool-db --local
```

或把 localhost / 127.0.0.1 加入 `NO_PROXY`：

```bash
export NO_PROXY="localhost,127.0.0.1,::1"
```

### Q9: 普通用户登录后看不到任何聚合密钥 / 想让某用户能用某个密钥

这是「用户归属」设计预期行为，不是 bug：

- 聚合密钥**只能由管理员创建**。普通用户点「创建聚合密钥」会被后端 403 拒绝（前端也已隐藏该按钮）。
- 管理员在创建 / 编辑密钥时选择「归属用户」；该用户登录后只能看到分配给自己的密钥。
- 想让所有人都能用，勾选「设为共享密钥」即可（对所有用户可见）。
- 若希望某用户立刻看到密钥，请让管理员在密钥编辑页把归属改成该用户，或把密钥设为共享。

> 后端 `listByOwner` 会按 `ownerId` 与 `is_shared` 过滤；普通用户调用接口只会拿到自己权限内的数据，无法枚举他人密钥。

---

## 十二、部署检查清单 ✅

部署完成后，按以下顺序自检：

- [ ] 访问 `https://key-pool-xxx.workers.dev/health` 返回 200
- [ ] 访问前端 `https://xxx.pages.dev` 加载正常
- [ ] 能用管理员账号登录
- [ ] 能创建渠道、录入 Key、拉取模型
- [ ] 能创建聚合密钥
- [ ] 测试台能发消息并收到回复
- [ ] 健康状态总览能看到刚测的组合
- [ ] 用量统计能看到刚才的请求日志
- [ ] （可选）用 curl 调用 `/v1/models` 验证聚合密钥：
  ```bash
  curl https://key-pool-xxx.workers.dev/v1/models \
    -H "Authorization: Bearer sk-xxxx"
  ```
- [ ] （可选）发起一次完整聊天：
  ```bash
  curl https://key-pool-xxx.workers.dev/v1/chat/completions \
    -H "Authorization: Bearer sk-xxxx" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "gpt-4o-mini",
      "messages": [{"role":"user","content":"Hello!"}]
    }'
  ```

全部通过，部署完成 🎉

---

## 十三、更多资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [D1 数据库文档](https://developers.cloudflare.com/d1/)
- [KV 文档](https://developers.cloudflare.com/kv/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Hono 框架](https://hono.dev/)

如有问题，欢迎提 Issue。
