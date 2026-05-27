# 部署指南

本文说明如何部署自己的“动漫高手·一眼顶针”实例。

## 环境要求

- Node.js 18
- Supabase 项目
- Cloudinary 账号
- Vercel 项目

## 本地开发

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：

```text
http://localhost:3000
```

## 环境变量

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

`CLOUDINARY_API_SECRET` 只放服务端变量，不要加 `NEXT_PUBLIC_`。

## Supabase 初始化

在 Supabase SQL Editor 中按顺序执行：

1. `supabase/migrations/001_rooms_players.sql`
2. `supabase/migrations/002_question_sets_game_sessions.sql`
3. `supabase/migrations/003_answers_scores_results.sql`
4. `supabase/migrations/004_game_session_settings.sql`
5. `supabase/migrations/005_community_question_sets.sql`
6. `supabase/migrations/question-label-migration.sql`
7. `supabase/migrations/006_prepared_question_set.sql`

## Realtime

需要确认这些表已加入 Realtime publication：

- `rooms`
- `players`
- `question_sets`
- `questions`
- `game_sessions`
- `answers`
- `player_scores`
- `question_results`
- `question_set_ratings`

迁移文件已包含 `alter publication supabase_realtime add table ...`。如果控制台里没有显示，可在 Supabase Dashboard 的 Database > Replication 中手动确认。

## Cloudinary

1. 创建 Cloudinary 账号。
2. 创建 unsigned upload preset。
3. 允许 unsigned browser upload。
4. 建议设置 folder，例如 `anime-master-game`。
5. 将 cloud name、upload preset 和 folder 写入环境变量。

## Vercel

1. 将代码推送到 GitHub。
2. 在 Vercel 新建项目并导入仓库。
3. Framework 选择 Next.js。
4. 在 Project Settings > Environment Variables 添加上面的环境变量。
5. 确认 Supabase SQL 已执行。
6. 确认 Realtime 表已开启。
7. 确认 Cloudinary unsigned preset 可用。
8. Deploy。

## 验收

部署后建议用两个浏览器或无痕窗口联调：

1. 创建房间。
2. 加入同一房间。
3. 房主选择出题人。
4. 出题人准备题库。
5. 房主开始游戏。
6. 玩家答题。
7. 出题人判分。
8. 进入排行榜。
