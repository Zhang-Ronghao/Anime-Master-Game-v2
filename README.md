# Anime Master Game v2

多人实时网页小游戏：房主创建房间，选择出题人；出题人上传图片、粘贴 Cloudinary URL 文本或选择社区题库；玩家根据逐块揭露的截图猜动画；出题人判分；结算后展示排行榜、发布社区题库并评分。

## Tech Stack

- Next.js 13.5
- React 18
- TypeScript
- Tailwind CSS
- Supabase Postgres + Realtime
- Cloudinary unsigned browser upload
- 本地临时身份：`localStorage` + `sessionStorage`

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`。

## Environment Variables

前端公开变量：

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=
NEXT_PUBLIC_CLOUDINARY_FOLDER=anime-master-game
NEXT_PUBLIC_UPLOAD_IMAGE_MAX_SIZE=960
NEXT_PUBLIC_UPLOAD_IMAGE_FORMAT=image/webp
NEXT_PUBLIC_UPLOAD_IMAGE_QUALITY=0.78
NEXT_PUBLIC_CLOUDINARY_UPLOAD_CONCURRENCY=2
```

服务端变量：

```env
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=anime-master-game
CLOUDINARY_EXISTING_IMAGE_LIMIT=50
```

注意：`CLOUDINARY_API_SECRET` 不能加 `NEXT_PUBLIC_`。

## Supabase SQL 初始化顺序

在 Supabase SQL Editor 中按顺序执行：

1. `supabase/migrations/001_rooms_players.sql`
2. `supabase/migrations/002_question_sets_game_sessions.sql`
3. `supabase/migrations/003_answers_scores_results.sql`
4. `supabase/migrations/004_game_session_settings.sql`
5. `supabase/migrations/005_community_question_sets.sql`

当前 MVP 没有启用 RLS，使用 anon key 直连读写，仅适合测试版或受控环境。

## Supabase Realtime

需要把这些表加入 Realtime publication：

- `rooms`
- `players`
- `question_sets`
- `questions`
- `game_sessions`
- `answers`
- `player_scores`
- `question_results`
- `question_set_ratings`

迁移文件已包含 `alter publication supabase_realtime add table ...`。如果 Supabase 控制台里没有打开，可在 Database > Replication 中手动确认。

## Cloudinary 配置

1. 创建 Cloudinary 账号和 cloud name。
2. 创建 unsigned upload preset。
3. Preset 需要允许 unsigned browser upload。
4. 建议设置 folder，例如 `anime-master-game`。
5. 如果只使用“粘贴 URL 文本创建题库”，不会上传或复制图片，但 URL 指向的图片必须可公开访问。

推荐上传限制：

- 文件类型：image
- 最大尺寸由前端压缩控制：默认长边 960
- 格式：默认 `image/webp`
- 并发：默认 2

## Vercel 部署

1. 将代码推送到 GitHub。
2. 在 Vercel 新建项目并导入仓库。
3. Framework 选择 Next.js。
4. 在 Project Settings > Environment Variables 添加 README 中列出的所有变量。
5. 确认 Supabase SQL 已全部执行。
6. 确认 Supabase Realtime 表已开启。
7. 确认 Cloudinary unsigned preset 可用。
8. Deploy。

## 从零部署步骤

1. 创建 Supabase 项目。
2. 复制 Project URL 和 anon public key 到 Vercel 环境变量。
3. 按迁移顺序执行 `supabase/migrations` 下 5 个 SQL 文件。
4. 检查 Realtime 表：`rooms`、`players`、`game_sessions`、`answers`、`player_scores`、`question_results` 等都已启用。
5. 创建 Cloudinary unsigned upload preset。
6. 配置 Cloudinary 环境变量。
7. 部署 Vercel。
8. 打开站点，创建房间，使用两个浏览器或隐身窗口加入同一房间做联调。

## MVP 功能验收

- 房间不存在时显示错误。
- 同房间昵称重复时显示错误。
- 房间最多 15 人。
- 刷新后能通过本地 session 恢复当前房间、游戏状态、题目和分数。
- 上传图片创建题库后会保存 `image_urls_text` 和 `questions`。
- 粘贴 URL 文本创建题库不会上传或复制图片。
- 社区题库可以发布、搜索、预览、选择和评分。
- 游戏过程中图片按 45 块揭露，横屏 5x9，竖屏 9x5。
- 图片加载失败时显示占位；出题人可跳过本题。
- 倒计时在顶部和玩家答题区附近都可见。
- 判分不会重复给同一玩家同一题加分。
- 结算排行榜按当前 `game_session` 独立统计。
- 回到房间大厅后玩家列表保留，新一轮分数不继承上一轮。

## Known Limits

- 没有 Supabase Auth。
- 没有 RLS。
- 权限主要依赖前端判断和 Supabase 条件更新，适合 MVP 测试，不适合作为正式安全边界。
- 房间不会自动过期清理。
- 玩家关闭浏览器不一定立即从玩家列表移除。
