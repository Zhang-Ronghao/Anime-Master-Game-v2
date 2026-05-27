# PROJECT HANDOFF

## 1. 当前项目目标

本项目是一个多人实时网页小游戏：根据动画截图猜动画。

### 1.1 完整游戏目标

最终目标流程：

1. 房主创建房间。
2. 其他玩家输入房间号和昵称加入同一房间。
3. 房主在房间内选择一名玩家作为本局出题人，出题人可以是房主自己。
4. 出题人上传一批动画截图作为本局题库，或从社区题库选择已有题库。
5. 游戏逐题进行。
6. 每张图片初始对普通玩家显示为全黑。
7. 图片按横屏 5 x 9、竖屏 9 x 5 共 45 个网格块揭露。
8. 出题人能看到原图和网格，并选择当前轮揭露哪些块。
9. 普通玩家只看到已揭露块，并在限时内提交答案。
10. 所有答案只对出题人可见。
11. 出题人判定哪些玩家答对。
12. 答对玩家根据当前轮次得分。
13. 答对玩家本题锁定，不能继续作答。
14. 未答对玩家进入下一轮揭露。
15. 所有玩家答对，或达到本题最大轮数后，进入下一题。
16. 题库全部出完后进入结算，展示排行榜。
17. 房主可以回到大厅，重新选择出题人开始下一局。
18. 本局上传题库后续可发布到社区。
19. 后续其他出题人可从社区加载题库并评分。

### 1.2 当前 MVP 不需要

- 正式登录系统。
- Supabase Auth。
- 管理员后台。
- 社区审核。
- 付费功能。
- 复杂标准答案系统。
- Cloudinary signed upload 的完整服务端签名流程。

### 1.3 当前 MVP 已覆盖的基础流程

已经完成：

- 房间创建和加入。
- 昵称。
- 房主权限。
- 玩家列表实时同步。
- 房主选择出题人。
- 出题人批量上传题库到 Cloudinary。
- 出题人可通过上传、URL / JSONL 导入或社区题库准备题库。
- Supabase 存储题库、题目、游戏会话。
- PLAYING 状态图片 45 块分块揭露。
- 出题人确认揭露。
- 普通玩家黑色遮罩，只显示已揭露区域。
- 倒计时。
- 玩家提交答案。
- 玩家每轮可修改答案直到倒计时结束。
- 出题人可随时打开判分弹窗查看所有答案并判分。
- 答对玩家加分并锁定本题。
- 防止同一玩家同一题重复加分。
- 自动进入下一轮、下一题或 GAME_RESULT。
- 实时积分榜。
- 刷新后尽量恢复当前房间、题目、轮次、揭露块、答案、积分。

## 2. 当前技术栈

- Next.js `13.5.11`
- React `18.2.0`
- TypeScript
- Tailwind CSS `3.4.17`
- Supabase JS `2.45.4`
- Supabase Postgres
- Supabase Realtime
- Cloudinary unsigned upload preset
- 本地临时身份：`localStorage` + `sessionStorage`

注意：

- 当前机器 Node 曾显示为 `18.14.2`。
- `@supabase/supabase-js` 固定为 `2.45.4`，不要改回 `^2.x`，否则可能安装到需要 Node 20 的版本。
- 当前没有 RLS，MVP 阶段使用 anon key 直连读写。

## 3. 当前路由

### `/`

首页：

- 输入昵称。
- 创建房间。
- 输入 6 位房间号加入房间。
- 房间不存在提示错误。
- 同一房间昵称重复提示错误。

### `/room/[roomCode]`

房间页：

- LOBBY：显示玩家列表、状态、房主选择出题人区域。
- QUESTION_SETUP：出题人显示题库准备 UI；其他玩家仍停留在大厅式界面，显示等待出题状态。
- PLAYING：隐藏玩家列表和状态面板，只显示游戏主体：题号、轮次、分数、倒计时、积分榜、图片、操作区。
- GAME_RESULT：本局结算，展示排行榜、社区发布/评分入口和房主回大厅操作。

### `/api/cloudinary-images`

临时接口：

- 从 Cloudinary 指定 folder 读取已有图片。
- 用于测试阶段复用 Cloudinary 已保存图片，避免每次重新上传。
- 使用服务端 `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`。
- 当前主流程不依赖，后续可以删除或替换。

## 4. 当前状态机

类型定义在 `src/types/game.ts`：

```ts
export type RoomStatus = "LOBBY" | "QUESTION_SETUP" | "PLAYING" | "GAME_RESULT";
```

状态说明：

- `LOBBY`：房间大厅。
- `QUESTION_SETUP`：出题人准备题库。
- `PLAYING`：游戏进行中。
- `GAME_RESULT`：本局结算。

## 5. 当前数据库结构

SQL 文件：

- `supabase/migrations/001_rooms_players.sql`
- `supabase/migrations/002_question_sets_game_sessions.sql`
- `supabase/migrations/003_answers_scores_results.sql`
- `supabase/migrations/004_game_session_settings.sql`
- `supabase/migrations/005_community_question_sets.sql`
- `supabase/migrations/question-label-migration.sql`
- `supabase/migrations/006_prepared_question_set.sql`

### 5.1 `rooms`

```sql
id uuid primary key default gen_random_uuid()
room_code text not null unique
host_player_id text not null
game_status text not null default 'LOBBY'
current_presenter_player_id text
current_game_id uuid
prepared_question_set_id uuid
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

说明：

- `host_player_id` 是前端生成的临时玩家 ID，不是 Supabase Auth 用户 ID。
- `current_presenter_player_id` 是当前出题人。
- `current_game_id` 指向当前 `game_sessions.id`。
- `prepared_question_set_id` 是出题人已准备好、等待房主开始游戏的题库。

### 5.2 `players`

```sql
id text primary key
room_id uuid not null references public.rooms(id) on delete cascade
nickname text not null
is_host boolean not null default false
joined_at timestamptz not null default now()
last_seen_at timestamptz not null default now()
```

约束/索引：

- `players_room_nickname_unique`：同一房间内 `lower(nickname)` 唯一。
- `players_room_id_idx`。

### 5.3 `question_sets`

```sql
id uuid primary key default gen_random_uuid()
title text not null
description text
created_by_player_id text not null
source text not null default 'uploaded' check (source in ('uploaded', 'community'))
is_public boolean not null default false
image_count integer not null default 0 check (image_count >= 0)
rating_avg numeric(3, 2) not null default 0 check (rating_avg >= 0 and rating_avg <= 5)
rating_count integer not null default 0 check (rating_count >= 0)
created_at timestamptz not null default now()
```

### 5.4 `questions`

```sql
id uuid primary key default gen_random_uuid()
question_set_id uuid not null references public.question_sets(id) on delete cascade
image_url text not null
order_index integer not null
created_at timestamptz not null default now()
```

### 5.5 `game_sessions`

```sql
id uuid primary key default gen_random_uuid()
room_id uuid not null references public.rooms(id) on delete cascade
question_set_id uuid not null references public.question_sets(id) on delete restrict
presenter_player_id text not null
status text not null default 'PLAYING' check (status in ('QUESTION_SETUP', 'PLAYING', 'GAME_RESULT'))
current_question_index integer not null default 0 check (current_question_index >= 0)
current_reveal_round integer not null default 1 check (current_reveal_round >= 1)
revealed_blocks jsonb not null default '[]'::jsonb
round_started_at timestamptz
created_at timestamptz not null default now()
ended_at timestamptz
max_reveal_rounds integer not null default 3 check (max_reveal_rounds >= 1)
round_seconds integer not null default 30 check (round_seconds >= 1)
round_scores jsonb not null default '[3, 2, 1]'::jsonb
```

说明：

- `revealed_blocks` 存储当前题已揭露块索引，0 到 44。
- `max_reveal_rounds`、`round_seconds`、`round_scores` 在游戏开始前由房主设置。

### 5.6 `answers`

```sql
id uuid primary key default gen_random_uuid()
game_session_id uuid not null references public.game_sessions(id) on delete cascade
question_index integer not null check (question_index >= 0)
reveal_round integer not null check (reveal_round >= 1)
player_id text not null
answer_text text not null
submitted_at timestamptz not null default now()
unique (game_session_id, question_index, reveal_round, player_id)
```

规则：

- 玩家同一局、同一题、同一轮只有一条答案。
- 用 `upsert` 支持倒计时内修改答案。

### 5.7 `player_scores`

```sql
id uuid primary key default gen_random_uuid()
game_session_id uuid not null references public.game_sessions(id) on delete cascade
player_id text not null
score integer not null default 0 check (score >= 0)
correct_count integer not null default 0 check (correct_count >= 0)
unique (game_session_id, player_id)
```

### 5.8 `question_results`

```sql
id uuid primary key default gen_random_uuid()
game_session_id uuid not null references public.game_sessions(id) on delete cascade
question_index integer not null check (question_index >= 0)
player_id text not null
scored_round integer not null check (scored_round >= 1)
score_awarded integer not null check (score_awarded >= 0)
judged_by_player_id text not null
judged_at timestamptz not null default now()
unique (game_session_id, question_index, player_id)
```

用途：

- 记录某题哪些玩家已答对。
- 防止同一玩家同一题重复加分。

## 6. 当前环境变量

模板在 `.env.example`。

本地 `.env.local` 需要：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your-unsigned-upload-preset
NEXT_PUBLIC_CLOUDINARY_FOLDER=anime-master-game
NEXT_PUBLIC_UPLOAD_IMAGE_MAX_SIZE=960
NEXT_PUBLIC_UPLOAD_IMAGE_FORMAT=image/webp
NEXT_PUBLIC_UPLOAD_IMAGE_QUALITY=0.78
NEXT_PUBLIC_CLOUDINARY_UPLOAD_CONCURRENCY=2

CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
CLOUDINARY_FOLDER=anime-master-game
CLOUDINARY_EXISTING_IMAGE_LIMIT=50
```

注意：

- `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` 是 unsigned preset，用于浏览器直传。
- `CLOUDINARY_API_SECRET` 只用于 `/api/cloudinary-images` 服务端临时接口，不要加 `NEXT_PUBLIC_`。
- 不要把 Cloudinary API Secret 暴露到前端。
- 修改 `.env.local` 后需要重启 `npm run dev`。

## 7. 当前关键文件

### 页面

- `src/app/page.tsx`
  - 首页。
  - 创建房间。
  - 加入房间。

- `src/app/room/[roomCode]/page.tsx`
  - 房间页主状态机。
  - LOBBY / QUESTION_SETUP / PLAYING / GAME_RESULT UI 分支。
  - 订阅 rooms / players realtime。
  - 房主返回首页会解散房间。
  - PLAYING 使用沉浸式布局，隐藏玩家列表和状态面板。

- `src/app/api/cloudinary-images/route.ts`
  - 临时 Cloudinary 已有图片读取接口。

### 组件

- `src/components/QuestionSetUploader.tsx`
  - 出题人准备题库 UI。
  - 批量选择图片。
  - 选择文件夹。
  - 拖拽图片。
  - Canvas 压缩后上传 Cloudinary。
  - URL / JSONL 导入题库。
  - 选择社区题库。
  - 创建或选择题库后写入 `rooms.prepared_question_set_id`，通知房主开始游戏。

- `src/components/ImageRevealGame.tsx`
  - PLAYING 状态核心游戏 UI。
  - 出题人原图 + 网格。
  - 玩家黑色遮罩 + 已揭露区域。
  - 当前题号、轮次、分数、倒计时。
  - 实时积分榜。
  - 玩家提交答案。
  - 出题人判分弹窗。
  - 跳过本题。

### 数据访问

- `src/lib/supabaseRooms.ts`
  - 所有 Supabase 房间/玩家/题库/游戏/答案/积分访问层。
  - 页面尽量不要直接写 Supabase 查询，新增功能优先放这里。

- `src/lib/cloudinaryUpload.ts`
  - 浏览器端图片压缩和 Cloudinary unsigned upload。

- `src/lib/localSession.ts`
  - 本地临时玩家身份。

- `src/types/game.ts`
  - 前端类型和 DB row 类型。

## 8. 当前主要行为细节

### 8.1 房主离开

- 房主点击“返回首页”或“解散房间”会删除 `rooms`。
- `players`、`game_sessions` 会因外键 cascade 删除。
- 为了支持 PLAYING 刷新恢复，当前没有在 `pagehide/beforeunload` 自动解散房间。

### 8.2 选择出题人

- 只有房主在 LOBBY 能看到“选择出题人”。
- 选择后：
  - `rooms.current_presenter_player_id = selectedPlayerId`
  - `rooms.game_status = QUESTION_SETUP`
- 非房主看不到操作入口。

### 8.3 准备题库

- QUESTION_SETUP 中，当前出题人进入题库准备 UI。
- 非出题人仍看到大厅式界面、玩家列表、本局设置和等待出题状态。
- 出题人可以：
  - 输入题库标题。
  - 批量上传图片。
  - 粘贴 URL 文本或导入 JSONL。
  - 选择社区题库。
  - 创建或选中题库后通知房主。
- 房主可以：
  - 在大厅式界面设置每张图片的揭露轮数、每轮倒计时、每轮分数。
  - 出题人准备好题库后，房主点击开始游戏。
  - 准备完成前不能开始游戏。

### 8.4 图片上传

默认压缩：

- 最大边：`960`
- 格式：`image/webp`
- 质量：`0.78`
- 压缩后更大则上传原图。
- GIF 跳过压缩，避免动画丢失。

上传成功后写：

- `question_sets`
- `questions`

### 8.5 开始游戏

房主点击开始游戏后：

- 创建 `game_sessions`
- 写入：
  - `max_reveal_rounds`
  - `round_seconds`
  - `round_scores`
- `rooms.current_game_id = game_sessions.id`
- `rooms.game_status = PLAYING`

### 8.6 PLAYING 揭露

- 图片切成 45 块；横屏 5 x 9，竖屏 9 x 5。
- 出题人看到原图和网格。
- 出题人选择块后点击“确认揭露”。
- `game_sessions.revealed_blocks` 更新。
- `round_started_at` 设置为当前时间。
- 玩家看到黑色遮罩，只显示已揭露块。
- 玩家视角已揭露块不加绿色高亮，保持原图样子。

### 8.7 答题

- 非出题玩家在当前揭露轮开始后可提交答案。
- 倒计时内可修改答案。
- 出题人不能提交答案。
- 普通玩家只看到自己的答案。
- 出题人可以在判分弹窗看到所有玩家本轮答案。

### 8.8 判分

- 出题人点击“判分”打开弹窗。
- 弹窗内部可滚动，人数多不会拉长页面。
- 可以在倒计时结束前判分。
- 出题人勾选答对玩家，点击“确认判分”。
- 答对玩家获得当前轮分数。
- `question_results` 防止同一题重复加分。
- 答对玩家本题锁定，后续轮不能继续作答。

判分后推进：

- 如果所有非出题玩家都答对，进入下一题。
- 如果当前题达到最大轮数，进入下一题。
- 否则进入下一轮：
  - `current_reveal_round += 1`
  - `round_started_at = null`
  - 等待出题人继续选择揭露块。
- 如果没有下一题：
  - `game_sessions.status = GAME_RESULT`
  - `rooms.game_status = GAME_RESULT`

### 8.9 跳过本题

- 出题人可以点击“跳过本题”。
- 有下一题则进入下一题：
  - 题号加 1。
  - 轮次重置为 1。
  - 揭露块清空。
  - `round_started_at = null`
- 没有下一题则进入 GAME_RESULT。

## 9. 当前 UI 约定

- PLAYING 阶段不显示玩家列表和状态面板，只显示游戏主体。
- 错误提示用固定在视口顶部的 toast，同时保留页面内提示兜底。
- 出题人判分使用弹窗，不占用图片区域。
- 玩家答案区在图片下方。
- 实时积分榜位于图片上方。

## 10. 已知限制 / 待后续处理

- 没有正式登录，任何知道房间号的人都可以加入。
- 没有 RLS，仅适合 MVP 本地/测试阶段。
- 前端权限判断 + Supabase 条件更新只能满足 MVP，不能作为正式安全边界。
- 玩家关闭浏览器不一定立即从 `players` 删除。
- 房主关闭窗口不会自动解散房间；这是为了支持刷新恢复。
- 旧房间不会自动过期清理。
- GAME_RESULT 已有排行榜、社区发布/评分和房主回大厅流程，仍可继续优化展示效果。
- 社区题库已支持发布、搜索、预览、选择和评分。
- `/api/cloudinary-images` 是临时测试接口，当前主流程不依赖，后续可删除或替换。
- 当前答案没有标准答案或模糊匹配，完全由出题人判分。
- 当前没有下一题过渡动画。
- 当前没有本局结束提示音/提示动效。

## 11. 后续开发建议

下一阶段建议优先做：

1. 房间清理：
   - presence 或心跳。
   - 过期房间清理策略。
2. 权限增强：
   - 若后续上线，需要 Supabase Auth 或服务端 API + RLS。
   - 当前不要直接给现有 `postgres_changes` 表同步套 RLS；之前尝试会导致实时同步受影响。
3. 优化游戏体验：
   - 下一题过渡。
   - 答案提交反馈。
   - 判分完成提示。
   - 排行榜动画。

## 12. 新 Codex 对话接手时建议先读

新对话开始请先读这些文件：

```text
PROJECT_HANDOFF.md
src/types/game.ts
src/lib/supabaseRooms.ts
src/app/room/[roomCode]/page.tsx
src/components/QuestionSetUploader.tsx
src/components/ImageRevealGame.tsx
src/lib/cloudinaryUpload.ts
src/app/api/cloudinary-images/route.ts
supabase/migrations/001_rooms_players.sql
supabase/migrations/002_question_sets_game_sessions.sql
supabase/migrations/003_answers_scores_results.sql
supabase/migrations/004_game_session_settings.sql
supabase/migrations/005_community_question_sets.sql
supabase/migrations/question-label-migration.sql
supabase/migrations/006_prepared_question_set.sql
```

## 13. 启动和测试

本地启动：

```bash
npm run dev
```

访问：

```text
http://localhost:3000
```

构建检查：

```bash
npm run build
```

如果 `.next/trace` 在 Windows 上被锁导致 EPERM，通常是已有 node/next 进程占用。停止 dev server 后重试。
