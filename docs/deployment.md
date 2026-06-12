# 部署指南

当前架构：

- 前端：Cloudflare Pages
- 后端 API + WebSocket：Cloudflare Workers
- 房间实时通道：Durable Objects
- 持久化：Cloudflare D1
- 图片：Cloudinary

## 本地开发

```bash
npm install
cp .env.example .env.local
npm run d1:migrate:local
npm run worker:dev
```

另开一个终端启动前端：

```bash
npm run dev
```

默认地址：

- 前端：`http://localhost:3000`
- Worker：`http://localhost:8787`

`.env.local` 至少需要：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
```

如需上传图片，还需要配置 Cloudinary 相关变量。

Worker 本地读取 Cloudinary 管理接口时可在 `.dev.vars` 中配置：

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
CLOUDINARY_FOLDER=anime-master-game
CLOUDINARY_EXISTING_IMAGE_LIMIT=50
```

## D1

创建远程 D1：

```bash
npx wrangler d1 create anime_master_game
```

把输出的 `database_id` 填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "anime_master_game"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "d1/migrations"
```

执行远程迁移：

```bash
npm run d1:migrate:remote
```

## Worker

先验证打包：

```bash
npm run worker:typecheck
npx wrangler deploy --dry-run
```

部署：

```bash
npm run worker:deploy
```

如果 Pages 和 Worker 不同源，更新 `wrangler.toml`：

```toml
[vars]
ALLOWED_ORIGIN = "https://your-pages-project.pages.dev"
```

多个允许来源可用逗号分隔：

```toml
[vars]
ALLOWED_ORIGIN = "http://localhost:3000,https://your-pages-project.pages.dev"
```

## Pages

Cloudflare Pages 配置：

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `pages-dist`
- Environment variable: `NEXT_PUBLIC_API_BASE_URL=<Worker URL>`

如果手动部署 Pages：

```bash
npm run build
npx wrangler pages deploy pages-dist --project-name anime-master-game-v2
```

如果使用 Cloudinary 上传，还需要配置 `.env.example` 中的 Cloudinary 变量。
`CLOUDINARY_API_KEY` 和 `CLOUDINARY_API_SECRET` 属于服务端凭据，线上请用 Worker secrets：

```bash
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
```

非敏感配置可以放在 `wrangler.toml` 的 `[vars]` 中，或在 Cloudflare Dashboard 中设置：

```toml
[vars]
CLOUDINARY_CLOUD_NAME = "your-cloud-name"
CLOUDINARY_FOLDER = "anime-master-game"
CLOUDINARY_EXISTING_IMAGE_LIMIT = "50"
```

## 验收

1. 创建房间。
2. 用另一个浏览器或无痕窗口加入房间。
3. 房主选择出题人。
4. 出题人创建或选择题库并通知房主。
5. 房主开始游戏。
6. 玩家答题，出题人判分。
7. 进入排行榜。
8. 刷新页面后确认房间和游戏状态可恢复。
