# PROJECT HANDOFF

## 1. 当前项目目标

本项目是一个多人实时网页小游戏：根据动画截图猜动画。

## 1.1 完整游戏核心流程

这是项目最终要实现的完整流程，后续 Codex 不要忘记这个目标：

1. 房主创建房间。
2. 其他玩家输入房间号和昵称加入同一个房间。
3. 房主在房间内选择一名玩家作为本轮出题人，出题人可以是房主自己。
4. 出题人上传一批动画截图作为本轮题库，或者从社区题库中选择已有题库。
5. 游戏逐题进行。
6. 每张图片初始对普通玩家显示为全黑。
7. 图片被切分为多个网格块，例如 4 x 7。
8. 出题人能看到原图，并在每一轮选择要揭露哪些块。
9. 普通玩家只能看到已揭露的块，并在限定时间内提交答案。
10. 所有答案只对出题人可见。
11. 出题人判断哪些玩家答对。
12. 答对玩家根据当前轮次获得分数，例如第 1 轮 3 分，第 2 轮 2 分，第 3 轮 1 分。
13. 答对玩家本题锁定，不能继续作答。
14. 没答对的玩家继续进入下一轮揭露。
15. 当所有玩家答对，或达到本题最大轮数后，进入下一题。
16. 题库全部出完，或者出题人提前结束游戏后，展示排行榜。
17. 房主可以回到房间大厅，重新选择新的出题人开始下一轮。
18. 游戏结束后，本轮上传的题库可以选择发布到社区。
19. 之后其他出题人可以从社区选择题库游玩，并在结束后给题库 1-5 星评分。

## 1.2 当前 MVP 不需要

- 正式登录系统。
- 社区审核。
- 复杂标准答案系统。
- 管理员后台。
- 付费功能。

## 1.3 当前 MVP 需要

- 房间创建与加入。
- 昵称。
- 房主权限。
- 玩家列表实时同步。
- 出题人选择。
- Cloudinary 批量图片上传。
- Supabase 数据存储。
- Supabase Realtime 实时同步。
- 图片分块揭露。
- 限时答题。
- 出题人判分。
- 分数排行榜。
- 社区题库发布、加载、评分。
- 刷新页面后尽量恢复状态。
- 基本错误处理和防重复提交。

## 1.4 推荐/当前技术栈约束

- Next.js。
- TypeScript。
- Tailwind CSS。
- Supabase Postgres。
- Supabase Realtime。
- Cloudinary unsigned upload preset。
- `localStorage` 保存临时 `playerId`、`nickname`、`roomCode`。
- 不做正式登录。

## 1.5 后续每个开发阶段必须遵守

1. 不要一次性实现所有功能。
2. 每个阶段只实现当前阶段要求。
3. 每次修改后说明：
   - 新增了哪些页面。
   - 新增了哪些数据库表或字段。
   - 需要运行哪些 SQL。
   - 需要配置哪些环境变量。
   - 如何启动本地项目。
   - 用户应该访问哪个 URL 测试。
   - 本阶段测试步骤是什么。
4. 所有重要状态要尽量可刷新恢复。
5. 不要把 Cloudinary API Secret 放到前端。
6. Cloudinary 上传使用 unsigned upload preset。
7. 要注意多人实时同步和权限判断。

当前只完成到流程 2：真实房间和玩家实时同步。还没有实现出题人选择、上传图片、游戏答题、计分、社区题库。

## 2. 已完成功能

- Next.js + TypeScript + Tailwind CSS 项目初始化。
- 首页 `/`：
  - 输入昵称。
  - 创建房间。
  - 输入 6 位房间号加入房间。
  - 房间不存在时提示错误。
  - 同一房间昵称重复时提示错误。
- 房间页 `/room/[roomCode]`：
  - 显示房间号。
  - 显示当前玩家昵称。
  - 显示真实玩家列表。
  - 显示房主标识。
  - 显示当前游戏状态。
  - Supabase Realtime 同步玩家加入/离开。
  - 普通玩家返回首页时从 `players` 表删除自己。
  - 房主可点击“解散房间”删除房间。
  - 房间删除后，玩家页面会显示“房间已被房主解散。”
- 本地状态恢复：
  - `playerId`
  - `nickname`
  - `roomCode`
  - `isHost`
- 基本错误处理：
  - 缺少 Supabase 环境变量。
  - 房间不存在。
  - 昵称重复。
  - 加载/刷新玩家列表失败。

## 3. 当前技术栈

- Next.js `13.5.11`
- React `18.2.0`
- TypeScript
- Tailwind CSS `3.4.17`
- Supabase JS `2.45.4`
- Supabase Postgres
- Supabase Realtime
- 本地临时身份：`localStorage` + `sessionStorage`

当前本机 Node 曾显示为 `18.14.2`，所以 Supabase JS 被固定为 `2.45.4`，不要改成 `^2.x`，否则可能安装到要求 Node 20 的版本。

## 4. 当前页面路由

- `/`
  - 首页。
  - 创建房间。
  - 加入房间。

- `/room/[roomCode]`
  - 房间页。
  - 显示玩家列表。
  - 显示房主权限。
  - 房主可解散房间。
  - 普通玩家返回首页会离开房间。

## 5. 当前数据库表结构

### `rooms`

```sql
id uuid primary key default gen_random_uuid()
room_code text not null unique
host_player_id text not null
game_status text not null default 'LOBBY'
current_presenter_player_id text
current_game_id uuid
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

说明：

- `room_code` 是 6 位房间号。
- `host_player_id` 是前端生成的玩家 ID，不是 Supabase Auth 用户 ID。
- `game_status` 当前只使用 `LOBBY`。
- `current_presenter_player_id` 和 `current_game_id` 是后续流程预留字段。

### `players`

```sql
id text primary key
room_id uuid not null references public.rooms(id) on delete cascade
nickname text not null
is_host boolean not null default false
joined_at timestamptz not null default now()
last_seen_at timestamptz not null default now()
```

索引/约束：

- `players_room_nickname_unique`：同一房间内 `lower(nickname)` 唯一。
- `players_room_id_idx`：加速按房间读取玩家。
- 删除 `rooms` 会 cascade 删除该房间所有 `players`。

## 6. 当前 Supabase SQL

SQL 文件：

```text
supabase/migrations/001_rooms_players.sql
```

当前完整 SQL：

```sql
create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_player_id text not null,
  game_status text not null default 'LOBBY',
  current_presenter_player_id text,
  current_game_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id text primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  nickname text not null,
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists players_room_nickname_unique
  on public.players (room_id, lower(nickname));

create index if not exists players_room_id_idx
  on public.players (room_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;

create trigger rooms_set_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

alter table public.rooms replica identity full;
alter table public.players replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.rooms;
  alter publication supabase_realtime add table public.players;
exception
  when duplicate_object then null;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.rooms to anon, authenticated;
grant select, insert, update, delete on public.players to anon, authenticated;
```

当前 MVP 没有正式登录系统，所以没有启用 RLS。Supabase SQL Editor 如果提示风险，当前阶段选择 `Run without RLS`。

## 7. 当前环境变量

模板文件：

```text
.env.example
```

本地需要手动创建：

```text
.env.local
```

内容：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

注意：

- 只使用 anon public key。
- 不要把 service_role key 放进前端项目。
- `.env.local` 修改后需要重启 `npm run dev`。

## 8. 当前状态机

当前类型定义在 `src/types/game.ts`：

```ts
export type RoomStatus = "LOBBY" | "SELECTING_PRESENTER" | "PLAYING" | "FINISHED";
```

当前实际只使用：

- `LOBBY`

预留状态：

- `SELECTING_PRESENTER`
- `PLAYING`
- `FINISHED`

当前页面显示映射在：

```text
src/app/room/[roomCode]/page.tsx
```

当前还没有实现：

- 房主选择出题人。
- 出题人上传题库。
- 游戏轮次。
- 图片分块揭露。
- 答题提交。
- 判分。
- 排行榜。

## 9. 当前关键文件说明

- `src/app/page.tsx`
  - 首页。
  - 调用 Supabase 创建房间/加入房间。
  - 处理房间不存在和昵称重复。

- `src/app/room/[roomCode]/page.tsx`
  - 房间页。
  - 加载房间和玩家。
  - 订阅 `players` 变化。
  - 订阅 `rooms` 删除。
  - 普通玩家离开房间。
  - 房主解散房间。

- `src/lib/supabaseClient.ts`
  - 创建 Supabase browser client。
  - 延迟检查环境变量，避免 build 阶段因为没 `.env.local` 直接失败。

- `src/lib/supabaseRooms.ts`
  - Supabase 房间/玩家数据访问层。
  - `createSupabaseRoom`
  - `getRoomByCode`
  - `getRoomWithPlayers`
  - `getPlayersByRoomId`
  - `joinSupabaseRoom`
  - `leaveSupabaseRoom`
  - `dissolveSupabaseRoom`

- `src/lib/localSession.ts`
  - 保存/读取本地临时玩家身份。
  - 同时使用 `sessionStorage` 和 `localStorage`。
  - `clearLocalRoomSession` 清理房间相关状态，但保留玩家 ID 和昵称。

- `src/lib/id.ts`
  - 生成 `playerId`。
  - 生成 6 位房间号。

- `src/types/game.ts`
  - 前端类型和数据库行类型。

- `src/components/*`
  - 轻量 UI 组件。
  - `AppShell`
  - `Panel`
  - `FormField`
  - `Button`

- `supabase/migrations/001_rooms_players.sql`
  - 当前数据库初始化 SQL。

- `next.config.mjs`
  - 配置 `bufferutil` 和 `utf-8-validate` alias 为 false，避免 Supabase Realtime 的可选 ws 依赖导致构建警告。

- `src/lib/mockRooms.ts`
  - 流程 1 遗留 mock 文件。
  - 当前页面已不使用。
  - 不急着删，避免后续想回看本地 mock 逻辑；但新功能应优先用 Supabase。

## 10. 当前已知 bug / 限制

- 没有正式登录系统，任何人拿到房间号都可加入。
- 没有 RLS，当前依赖 anon key 直接读写表，仅适合 MVP 本地/测试阶段。
- 玩家关闭浏览器标签页或直接关闭窗口时，不一定会立刻从 `players` 表删除。
  - 当前只在点击“返回首页”时主动离开。
  - 后续应增加 presence 或心跳过期清理。
- `last_seen_at` 当前只在加入/重进房间时更新，没有周期性心跳。
- 房主关闭窗口不会自动解散房间。
- 旧房间不会自动过期清理。
- 玩家刷新页面会重新 upsert 自己的 player 记录，这是当前设计。
- 当前 UI 只是 MVP 骨架，不是最终游戏界面。
- `src/lib/supabaseRooms.ts` 中部分中文错误字符串在某些终端输出里可能显示为乱码；源码在编辑器中应以 UTF-8 打开。

## 11. 不要重构哪些内容

- 不要在当前阶段引入 Supabase Auth。
  - 产品要求是 MVP 不做正式登录。
  - 当前玩家身份用前端生成的 `playerId`。

- 不要把 Cloudinary API Secret 放到前端。
  - 后续图片上传必须使用 unsigned upload preset。

- 不要把 `@supabase/supabase-js` 改回 `^2.x`。
  - 当前本机 Node 是 18.x，最新 Supabase JS 可能要求 Node 20。

- 不要删除 `rooms.current_presenter_player_id` 和 `rooms.current_game_id`。
  - 它们是后续出题人和游戏流程预留字段。

- 不要把所有游戏功能一次性塞进下一步。
  - 项目约定每个阶段只实现当前阶段目标。

- 不要先做复杂标准答案系统、管理员后台、审核、登录、付费。
  - 都不属于当前 MVP。

- 不要绕过 `src/lib/supabaseRooms.ts` 在页面里到处直接写 Supabase 查询。
  - 保持页面调用数据访问层，后续更容易加权限判断和状态机。

- 不要启用 RLS 后不写 policy。
  - 启用但没有 policy 会导致前端 anon key 读写失败。

## 后续建议

下一阶段建议做“房主选择出题人”的最小闭环：

- 房间页房主可选择一个玩家作为出题人。
- 写入 `rooms.current_presenter_player_id`。
- 所有玩家实时看到当前出题人。
- 状态从 `LOBBY` 进入 `SELECTING_PRESENTER` 或继续保持 `LOBBY`，视设计而定。

新 chat 继续时，先让模型读取本文件和关键文件：

```text
PROJECT_HANDOFF.md
src/types/game.ts
src/lib/supabaseRooms.ts
src/app/room/[roomCode]/page.tsx
supabase/migrations/001_rooms_players.sql
```
