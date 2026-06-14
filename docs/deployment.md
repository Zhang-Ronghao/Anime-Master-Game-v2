# 部署指南

当前架构：

- 前端：Cloudflare Pages
- 后端 API + WebSocket：Cloudflare Workers
- 实时房间：Durable Objects
- 持久化：Cloudflare D1
- 图片：Cloudinary

目录：

- [本地开发](#本地开发)
- [Cloudflare 部署](#cloudflare-部署)
- [更新部署](#更新部署)
- [常见问题](#常见问题)

## 本地开发

安装依赖：

```bash
npm install
```

复制环境变量：

```bash
cp .env.example .env.local
```

本地前端至少需要：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

本地 Worker 如果要读取 Cloudinary 已有图片，在项目根目录创建 `.dev.vars`：

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
CLOUDINARY_FOLDER=anime-master-game
CLOUDINARY_EXISTING_IMAGE_LIMIT=50
```

初始化本地 D1：

```bash
npm run d1:migrate:local
```

开两个终端：

```bash
npm run worker:dev
```

```bash
npm run dev
```

默认地址：

```text
前端：http://localhost:3000
Worker：http://localhost:8787
```

本地检查：

```bash
npm run lint
npm run worker:typecheck
npm run build
```

## Cloudflare 部署

第一次部署顺序：

1. 创建 D1。
2. 填 `wrangler.toml`。
3. 执行远程 D1 迁移。
4. 连接 GitHub 自动部署 Worker。
5. 配置 Worker secrets。
6. 连接 GitHub 自动部署 Pages。
7. 回填真实 `ALLOWED_ORIGIN`，再次 push 触发 Worker 自动部署。
8. 如果有自定义域名，再配置同源 `/api/*`。

### 1. 创建 D1

登录 Cloudflare：

```bash
npx wrangler login
```

创建远程 D1：

```bash
npx wrangler d1 create anime_master_game
```

把输出里的 `database_id` 填入 `wrangler.toml`。注意 `binding` 必须是 `DB`，因为 Worker 代码读取的是 `env.DB`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "anime_master_game"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "d1/migrations"
```

第一次部署时还没有 Pages 地址，`ALLOWED_ORIGIN` 先临时写成 `"*"`：

```toml
[vars]
ALLOWED_ORIGIN = "*"
CLOUDINARY_CLOUD_NAME = "your-cloud-name"
CLOUDINARY_FOLDER = "anime-master-game"
CLOUDINARY_EXISTING_IMAGE_LIMIT = "50"
```

执行远程 D1 迁移：

```bash
npm run d1:migrate:remote
```

### 2. 部署 Worker

先本地检查：

```bash
npm run worker:typecheck
npx wrangler deploy --dry-run
```

确认通过后，把代码和 `wrangler.toml` push 到 GitHub。

在 Cloudflare 创建 Worker：

```text
Account home -> Add -> Workers
```

选择连接 GitHub 仓库，填写：

```text
Project name: anime-master-game-api
Production branch: main
Root directory: 项目根目录
Build command: 留空
Deploy command: npx wrangler deploy
```

Worker 名称要和 `wrangler.toml` 一致：

```toml
name = "anime-master-game-api"
```

部署成功后，记下 Worker 地址：

```text
https://anime-master-game-api.<your-name>.workers.dev
```

配置 Worker secrets：

```text
Workers & Pages -> 你的 Worker -> Settings -> Variables & Secrets
```

添加：

```text
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

这两个是 Worker runtime secrets，不要写进 `wrangler.toml`，也不要配到 Pages。

### 3. 部署 Pages

在 Cloudflare 创建 Pages：

```text
Account home -> Add -> Pages
```

连接 GitHub 仓库，构建配置：

```text
Framework preset: None / No preset
Build command: npm run build
Build output directory: pages-dist
Root directory: 项目根目录
```

在 `Environment variables (advanced)` 添加必填变量：

```env
NEXT_PUBLIC_API_BASE_URL=https://anime-master-game-api.<your-name>.workers.dev
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your-unsigned-upload-preset
```

如果已经配置了自定义域名同源 `/api/*`，`NEXT_PUBLIC_API_BASE_URL` 可以留空，这样 Pages 只需要填 Cloudinary 的两个变量。

其他前端上传参数已有默认值，通常不用填：

```text
NEXT_PUBLIC_CLOUDINARY_FOLDER=anime-master-game
NEXT_PUBLIC_UPLOAD_IMAGE_MAX_SIZE=960
NEXT_PUBLIC_UPLOAD_IMAGE_FORMAT=image/webp
NEXT_PUBLIC_UPLOAD_IMAGE_QUALITY=0.78
NEXT_PUBLIC_CLOUDINARY_UPLOAD_CONCURRENCY=2
```

保存后 Cloudflare Pages 会自动构建并部署。部署成功后，记下 Pages 地址：

```text
https://anime-master-game-v2.pages.dev
```

### 4. 回填 CORS

把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 从 `"*"` 改成真实 Pages origin：

```toml
ALLOWED_ORIGIN = "https://anime-master-game-v2.pages.dev"
```

不要带结尾 `/`：

```text
正确：https://anime-master-game-v2.pages.dev
错误：https://anime-master-game-v2.pages.dev/
```

提交并 push，Cloudflare Workers Builds 会自动重新部署 Worker。

### 5. 自定义域名同源 `/api/*`

如果你有自定义域名，推荐最终做成：

```text
https://game.example.com        -> Pages 前端
https://game.example.com/api/*  -> Worker API 和 WebSocket
```

这样 API 和页面同源，可以减少 CORS `OPTIONS`。

步骤：

1. 给 Pages 绑定自定义域名：

```text
Workers & Pages -> 你的 Pages 项目 -> Custom domains -> Set up a domain
```

2. 给 Worker 添加 route：

```text
Workers & Pages -> 你的 Worker -> Settings -> Domains & Routes -> Add -> Route
```

Route pattern：

```text
game.example.com/api/*
```

3. Pages 环境变量改成：

```env
NEXT_PUBLIC_API_BASE_URL=
```

保存后，在 Pages 的 `Deployments` 里重新运行最近一次 Git deployment。

4. Worker 的 `ALLOWED_ORIGIN` 改成：

```toml
ALLOWED_ORIGIN = "https://game.example.com"
```

提交并 push，等待 Workers Builds 部署完成。

## 更新部署

只改前端：

```bash
git push
```

Cloudflare Pages 会自动构建和部署。

只改 Worker 或 `wrangler.toml`：

```bash
git push
```

Cloudflare Workers Builds 会自动执行 `npx wrangler deploy`。

改了 D1 迁移：

```bash
npm run d1:migrate:remote
git push
```

前后端都改了：

- 如果接口兼容，直接 `git push`。
- 如果新前端依赖新后端，先发布后端兼容改动，等 Worker 部署完成后，再发布前端改动。

改了 Pages 环境变量：

```text
Pages -> Deployments -> 重新运行最近一次 Git deployment
```

改了 Worker secrets：

```text
Worker -> Settings -> Variables & Secrets
```

更新 secret 后，如果没有代码提交，在 Worker 的 `Deployments` 或 `Builds` 页面重新运行最近一次 Git deployment。

## 常见问题

### 找不到 Pages 创建入口

新版入口：

```text
Account home -> Add -> Pages
```

如果从旧入口进入：

```text
Workers & Pages -> Create application
```

默认可能是 Create Worker 页面。不要在这里创建 Pages，找到页面下方：

```text
Looking to deploy Pages? Get started
```

点击 `Get started` 进入 Pages。

### Framework preset 没有 Vite

没关系，preset 不是必须。选：

```text
Framework preset: None / No preset
```

然后手动填：

```text
Build command: npm run build
Build output directory: pages-dist
```

### 页面操作提示 Failed to fetch

优先检查两处。

第一，Worker 的 `ALLOWED_ORIGIN` 必须和浏览器地址栏 origin 精确一致，不能带结尾 `/`：

```toml
ALLOWED_ORIGIN = "https://anime-master-game-v2.pages.dev"
```

第二，Pages 的 `NEXT_PUBLIC_API_BASE_URL`：

- 跨域 Worker 模式：填 Worker 地址。
- 同源 `/api/*` 模式：留空。
- 不要填 `localhost`。
- 不要填 Pages 地址。

改完后等待对应的 Git deployment 成功。

### 线上提示数据库表不存在

执行远程 D1 迁移：

```bash
npm run d1:migrate:remote
```

### 社区题库读取不到 Cloudinary 图片

检查 Worker secrets 是否已配置：

```text
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

检查 Worker vars 是否已配置：

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_FOLDER
CLOUDINARY_EXISTING_IMAGE_LIMIT
```
