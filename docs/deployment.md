# 部署指南

当前架构：

- 前端：Cloudflare Pages 静态站点
- 后端 API + WebSocket：Cloudflare Workers
- 房间实时通道：Durable Objects
- 持久化：Cloudflare D1
- 图片上传和社区图片读取：Cloudinary

本文分成两部分：

1. 本地开发：在本机同时启动前端和 Worker，使用本地 D1 数据库。
2. Cloudflare 部署：创建远程 D1，部署 Worker，再用 Git Connect 部署 Pages。自定义域名可让 API 走同源 `/api/*`，减少 CORS `OPTIONS`。

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 准备本地环境变量

复制环境变量示例：

```bash
cp .env.example .env.local
```

本地前端至少需要：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

如果要在本地测试浏览器直传 Cloudinary，还需要配置这些公开变量：

```env
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your-unsigned-upload-preset
NEXT_PUBLIC_CLOUDINARY_FOLDER=anime-master-game
NEXT_PUBLIC_UPLOAD_IMAGE_MAX_SIZE=960
NEXT_PUBLIC_UPLOAD_IMAGE_FORMAT=image/webp
NEXT_PUBLIC_UPLOAD_IMAGE_QUALITY=0.78
NEXT_PUBLIC_CLOUDINARY_UPLOAD_CONCURRENCY=2
```

如果要在本地测试“选择社区题库”读取 Cloudinary 已有图片，Worker 还需要服务端变量。Wrangler 本地开发会读取项目根目录的 `.dev.vars`：

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
CLOUDINARY_FOLDER=anime-master-game
CLOUDINARY_EXISTING_IMAGE_LIMIT=50
```

`.env.local` 给 Vite 前端使用，`.dev.vars` 给本地 Worker 使用。`CLOUDINARY_API_KEY` 和 `CLOUDINARY_API_SECRET` 不要放进前端公开变量里。

### 3. 初始化本地 D1

```bash
npm run d1:migrate:local
```

这会把 `d1/migrations` 里的迁移应用到 Wrangler 的本地 D1 数据库。

### 4. 启动本地 Worker

```bash
npm run worker:dev
```

默认 Worker 地址是：

```text
http://localhost:8787
```

### 5. 启动本地前端

另开一个终端：

```bash
npm run dev
```

默认前端地址是：

```text
http://localhost:3000
```

本地开发时需要两个服务同时运行：

- 前端：`http://localhost:3000`
- Worker：`http://localhost:8787`

### 6. 本地检查

```bash
npm run lint
npm run worker:typecheck
```

如果需要确认前端能正常构建：

```bash
npm run build
```

构建产物会输出到 `pages-dist`。

## Cloudflare 部署

这一段按第一次部署的真实顺序写。第一次部署时通常还没有 Pages 地址，所以先用临时 CORS 部署 Worker，等前端域名确定后再回填 `ALLOWED_ORIGIN`。

最终会拿到两个线上地址：

- Worker 地址：给前端调用 API 和 WebSocket。
- Pages 地址或自定义域名：玩家实际打开的网站地址。

部署顺序：

1. 创建远程 D1 数据库。
2. 把 D1 binding、临时 `ALLOWED_ORIGIN = "*"` 和 Cloudinary 非敏感变量写进 `wrangler.toml`。
3. 执行远程 D1 迁移。
4. 写入 Worker secrets。
5. 验证并部署 Worker，拿到 Worker 地址。
6. 用 Worker 地址配置 Pages，并通过 Git Connect 部署 Pages。
7. 拿到 Pages 地址或绑定自定义域名。
8. 把真实前端 origin 回填到 Worker 的 `ALLOWED_ORIGIN`，重新部署 Worker。

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 创建远程 D1 数据库

```bash
npx wrangler d1 create anime_master_game
```

把命令输出里的 `database_id` 填入 `wrangler.toml`。

注意：Worker 代码读取的是 `env.DB`，所以 `binding` 必须保持为 `DB`。

```toml
[[d1_databases]]
binding = "DB"
database_name = "anime_master_game"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "d1/migrations"
```

### 3. 先配置 Worker

第一次部署时还没有 Pages 地址，所以先把 `ALLOWED_ORIGIN` 临时写成 `"*"`：

```toml
[vars]
ALLOWED_ORIGIN = "*"
CLOUDINARY_CLOUD_NAME = "your-cloud-name"
CLOUDINARY_FOLDER = "anime-master-game"
CLOUDINARY_EXISTING_IMAGE_LIMIT = "50"
```

Cloudinary 后端凭据不要写进 `wrangler.toml`，也不要配到 Pages。后面用 Worker secret 写入。

### 4. 执行远程数据库迁移

```bash
npm run d1:migrate:remote
```

### 5. 写入 Worker secrets

把 Cloudinary 后端凭据写进 Worker secret：

```bash
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
```

终端提示输入值时，第一个填 Cloudinary API key，第二个填 Cloudinary API secret。

注意：`wrangler secret put` 会创建并部署一个新的 Worker 版本。第一次部署时这通常没问题；如果你想先跑完 `--dry-run`，也可以先跳过这一步，在 Worker 首次部署后马上执行它们。

### 6. 验证并部署 Worker

部署前先检查 Worker 类型和打包：

```bash
npm run worker:typecheck
npx wrangler deploy --dry-run
```

部署 Worker：

```bash
npm run worker:deploy
```

部署成功后，终端会显示 Worker 地址。把它记下来，后面配置 Pages 要用。

Worker 地址通常长这样：

```text
https://anime-master-game-api.<your-name>.workers.dev
```

### 7. 创建 Pages 项目并配置构建

进入 Cloudflare Dashboard，创建 Pages 项目：

```text
Workers & Pages -> Create application
```

当前 Cloudflare Dashboard 默认可能显示的是 Create Worker 页面。不要在这个页面创建 Worker。

在页面下方找到小字：

```text
Looking to deploy Pages? Get started
```

点击 `Get started`，进入 Pages 创建页面。官方文档里的路径等价于：

```text
Create application -> Pages -> Connect to Git
```

然后选择 GitHub 或 GitLab，授权后选择你的仓库。

选择仓库后，进入 `Set up builds and deployments`，填写构建配置：

```text
Framework preset: None / No preset
Build command: npm run build
Build output directory: pages-dist
Root directory: 项目根目录
```

如果页面里能看到 `Vite` preset，也可以选 `Vite`，但不是必须。没有 `Vite` 选项时，选 `None` 或不使用 preset，然后手动填上面的构建命令和输出目录即可。

### 8. 配置 Pages 环境变量

环境变量在同一个 `Set up builds and deployments` 页面里，通常位于构建配置下面的 `Environment variables (advanced)` 区域。展开这个区域后添加变量。

如果项目已经创建，也可以之后进入：

```text
Pages project -> Settings -> Environment variables
```

如果先使用 Worker 的 `workers.dev` 地址，配置：

```env
NEXT_PUBLIC_API_BASE_URL=https://anime-master-game-api.<your-name>.workers.dev
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your-unsigned-upload-preset
NEXT_PUBLIC_CLOUDINARY_FOLDER=anime-master-game
NEXT_PUBLIC_UPLOAD_IMAGE_MAX_SIZE=1920
NEXT_PUBLIC_UPLOAD_IMAGE_FORMAT=image/webp
NEXT_PUBLIC_UPLOAD_IMAGE_QUALITY=0.78
NEXT_PUBLIC_CLOUDINARY_UPLOAD_CONCURRENCY=2
```

Pages 里只放 `NEXT_PUBLIC_` 开头的变量。不要把 `CLOUDINARY_API_KEY` 或 `CLOUDINARY_API_SECRET` 配到 Pages。

### 9. 部署 Pages

保存构建配置和环境变量后，Cloudflare 会通过 Git Connect 自动拉取仓库、执行 `npm run build`，并部署 `pages-dist`。

部署成功后，Cloudflare 会给你一个 Pages 地址：

```text
https://anime-master-game-v2.pages.dev
```

### 10. 回填 Pages 地址到 Worker

拿到 Pages 地址后，把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 从 `"*"` 改成真实 Pages 地址：

```toml
[vars]
ALLOWED_ORIGIN = "https://anime-master-game-v2.pages.dev"
CLOUDINARY_CLOUD_NAME = "your-cloud-name"
CLOUDINARY_FOLDER = "anime-master-game"
CLOUDINARY_EXISTING_IMAGE_LIMIT = "50"
```

`ALLOWED_ORIGIN` 必须是 origin，不要带结尾 `/`：

```text
正确：https://anime-master-game-v2.pages.dev
错误：https://anime-master-game-v2.pages.dev/
```

然后重新部署 Worker：

```bash
npm run worker:deploy
```

如果同时使用 Pages 默认域名和自定义域名，用英文逗号分隔：

```toml
ALLOWED_ORIGIN = "https://anime-master-game-v2.pages.dev,https://game.example.com"
```

当前 Worker 会返回：

```text
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: content-type
Access-Control-Max-Age: 86400
```

`Access-Control-Max-Age` 可以缓存 CORS preflight。长期推荐使用下面的自定义域名同源 `/api/*` 方式，进一步减少 `OPTIONS`。

### 11. 自定义域名同源 `/api/*`

如果你有自己的域名，推荐最终做成：

```text
https://game.example.com        -> Pages 前端
https://game.example.com/api/*  -> Worker API 和 WebSocket
```

这样前端页面和 API 是同一个 origin，浏览器不会把游戏 API 请求当成跨域请求，能进一步减少 CORS `OPTIONS`。

#### Dashboard 配置方式

先给 Pages 绑定自定义域名：

```text
Workers & Pages -> 你的 Pages 项目 -> Custom domains -> Set up a domain
```

例如：

```text
game.example.com
```

再给 Worker 添加 Route：

```text
Workers & Pages -> 你的 Worker -> Settings -> Domains & Routes -> Add -> Route
```

Route pattern 填：

```text
game.example.com/api/*
```

Zone 选择：

```text
example.com
```

同源模式下，Pages 的 `NEXT_PUBLIC_API_BASE_URL` 留空：

```env
NEXT_PUBLIC_API_BASE_URL=
```

留空后，前端会请求当前站点下的：

```text
/api/rpc
/api/cloudinary-images
/api/realtime/.../ws
```

保存环境变量后重新部署 Pages。

最后把 Worker 的 `ALLOWED_ORIGIN` 改成自定义域名：

```toml
ALLOWED_ORIGIN = "https://game.example.com"
```

然后重新部署 Worker：

```bash
npm run worker:deploy
```

#### `wrangler.toml` 配置方式

也可以把 Worker Route 写进 `wrangler.toml`：

```toml
[[routes]]
pattern = "game.example.com/api/*"
zone_name = "example.com"
```

然后部署 Worker：

```bash
npm run worker:deploy
```

如果你只想让 Worker 走自定义域名，不再开放 `workers.dev`，可以加：

```toml
workers_dev = false
```

确认同源 `/api/*` 可用后，Pages 环境变量保持：

```env
NEXT_PUBLIC_API_BASE_URL=
```

### 12. 更新部署

Worker 代码或 `wrangler.toml` 改动后，重新部署 Worker：

```bash
npm run worker:deploy
```

前端代码或 Pages 环境变量改动后，push 到 Pages 绑定的 Git 分支，Cloudflare Pages 会自动重新构建和部署。环境变量改动后如果没有代码提交，可以在 Pages 项目的 `Deployments` 页面重新运行最近一次 Git deployment。

### 13. 线上验收

至少验收这些流程：

1. 打开 Pages 地址或自定义域名。
2. 输入昵称并创建房间。
3. 用另一个浏览器或无痕窗口加入房间。
4. 房主选择出题人。
5. 出题人上传图片、粘贴 URL、导入 JSONL 或选择社区题库。
6. 出题人通知房主题库已准备。
7. 房主开始游戏。
8. 玩家提交答案，出题人判分。
9. 游戏结束后进入排行榜。
10. 刷新页面后确认房间和游戏状态可恢复。

低 request 验收：

- 房间内操作应优先走 WebSocket。
- Cloudflare logs 中不应每个游戏动作都出现大量 `POST /api/rpc`。
- 同源 `/api/*` 配好后，正常游戏操作不应大量出现 `OPTIONS`。
- `GET /api/cloudinary-images` 只应在打开社区题库选择时出现。

### 常见问题

#### 前端请求失败或 WebSocket 连接失败

检查三处配置：

- Pages 的 `NEXT_PUBLIC_API_BASE_URL` 是否正确。跨域 Worker 模式填 Worker URL；同源 `/api/*` 模式留空。
- Worker 的 `ALLOWED_ORIGIN` 是否包含当前前端页面的 origin。
- Worker 是否已经重新部署过最新的 `wrangler.toml`。

#### 页面操作提示 Failed to fetch

这通常表示浏览器没有拿到可用响应，优先检查 CORS 和 API 地址。

先检查 Worker 的 `ALLOWED_ORIGIN`。它必须和浏览器地址栏里的前端 origin 精确一致，且不能带结尾 `/`：

```toml
ALLOWED_ORIGIN = "https://anime-master-game-v2.pages.dev"
```

不要写成：

```toml
ALLOWED_ORIGIN = "https://anime-master-game-v2.pages.dev/"
```

改完后重新部署 Worker：

```bash
npm run worker:deploy
```

再检查 Pages 环境变量 `NEXT_PUBLIC_API_BASE_URL`：

- 跨域 Worker 模式：填 Worker 地址，例如 `https://anime-master-game-api.<your-name>.workers.dev`。
- 同源 `/api/*` 模式：留空。
- 不要填 `localhost`。
- 不要填 Pages 地址。

改完 Pages 环境变量后，需要在 Pages 项目的 `Deployments` 页面重新运行最近一次 Git deployment。

#### 同源 `/api/*` 返回 404

优先检查：

- Worker Route pattern 是否是 `game.example.com/api/*`。
- Pages 自定义域名是否已经生效。
- Pages 的 `NEXT_PUBLIC_API_BASE_URL` 是否已经留空并重新部署。
- Worker 是否已重新部署。

可以直接打开：

```text
https://game.example.com/api/cloudinary-images
```

如果路由到了 Worker，但 Cloudinary secret 未配置，会看到图片服务配置错误；如果没有路由到 Worker，通常会看到 Pages 的 404。

#### 页面提示数据库表不存在

远程 D1 还没有执行迁移：

```bash
npm run d1:migrate:remote
```

本地开发只执行 `d1:migrate:local` 不会影响线上数据库。

#### Worker 部署失败，提示 D1 database_id 不对

重新执行：

```bash
npx wrangler d1 create anime_master_game
```

把输出里的 `database_id` 复制回 `wrangler.toml`。

#### 本地能上传图片，线上不能上传

检查 Pages 是否配置了：

```text
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
```

并确认 Cloudinary upload preset 是 unsigned preset。

#### 社区题库读取不到 Cloudinary 已有图片

检查 Worker 侧配置：

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_FOLDER
CLOUDINARY_EXISTING_IMAGE_LIMIT
```

其中 `CLOUDINARY_API_KEY` 和 `CLOUDINARY_API_SECRET` 应通过 `wrangler secret put` 写入。

#### Windows 下 npx/wrangler 命令被 PowerShell 拦截

可以使用 `.cmd` 入口：

```powershell
npx.cmd wrangler deploy
npm.cmd run build
```

#### Wrangler tail 连接 127.0.0.1 失败

通常是本机代理环境变量导致。检查：

```powershell
Get-ChildItem Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:ALL_PROXY -ErrorAction SilentlyContinue
```

如果不用代理，可以临时清掉：

```powershell
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
```
