# Maintenance Cleanup SQL

本项目当前没有自动清理旧房间和未发布题库。测试阶段可以定期在 Supabase SQL Editor 手动执行下面的清理语句。

执行前建议先 `select` 预览，再执行 `delete`。

## 已有时间字段

不需要新增字段。

- `rooms.created_at`
- `rooms.updated_at`
- `question_sets.created_at`
- `question_sets.updated_at`，来自 `005_community_question_sets.sql`

清理未发布题库时，用 `question_sets.created_at` 或 `updated_at` 都可以。建议先用 `created_at`，规则更直观：创建超过 3 天还没有公开，就视为测试/废弃题库。

## 预览 3 天前未发布题库

只查看，不删除：

```sql
select
  qs.id,
  qs.title,
  qs.is_public,
  qs.image_count,
  qs.created_at,
  qs.updated_at
from public.question_sets qs
where qs.is_public = false
  and qs.created_at < now() - interval '3 days'
order by qs.created_at asc;
```

## 删除 3 天前未发布且未被游戏使用的题库

这是最保守的清理方式：只删除从未被任何 `game_sessions` 使用过的私有题库。

```sql
delete from public.question_sets qs
where qs.is_public = false
  and qs.created_at < now() - interval '3 days'
  and not exists (
    select 1
    from public.game_sessions gs
    where gs.question_set_id = qs.id
  );
```

说明：

- 会级联删除对应 `questions`。
- 不会删除 Cloudinary 上的图片文件。
- 不会删除已经发布到社区的题库。
- 不会删除曾经被游戏使用过的私有题库。

## 删除 3 天前未发布且没有活跃游戏使用的题库

如果测试数据很多，可以使用稍微激进一点的版本：只保护正在 `QUESTION_SETUP` 或 `PLAYING` 的题库。

```sql
delete from public.question_sets qs
where qs.is_public = false
  and qs.created_at < now() - interval '3 days'
  and not exists (
    select 1
    from public.game_sessions gs
    where gs.question_set_id = qs.id
      and gs.status in ('QUESTION_SETUP', 'PLAYING')
  );
```

说明：

- 已经结束的历史私有题库会被删除。
- 如果 `game_sessions` 仍引用这个题库且数据库外键为 `restrict`，删除可能失败。这种情况下用上一个保守版本。

## 预览旧 LOBBY 房间

```sql
select
  id,
  room_code,
  game_status,
  created_at,
  updated_at
from public.rooms
where game_status = 'LOBBY'
  and updated_at < now() - interval '3 days'
order by updated_at asc;
```

## 删除 3 天前还停在 LOBBY 的房间

```sql
delete from public.rooms
where game_status = 'LOBBY'
  and updated_at < now() - interval '3 days';
```

说明：

- 会级联删除该房间的 `players`。
- 如果房间曾经有 `game_sessions`，也会级联删除该房间的 `game_sessions` 以及对应的 `answers`、`player_scores`、`question_results`。
- 不会删除社区题库。

## 删除明显过期的所有状态房间

适合测试环境定期清理：

```sql
delete from public.rooms
where (
  game_status in ('LOBBY', 'GAME_RESULT')
  and updated_at < now() - interval '3 days'
)
or (
  game_status = 'QUESTION_SETUP'
  and updated_at < now() - interval '1 day'
)
or (
  game_status = 'PLAYING'
  and updated_at < now() - interval '1 day'
);
```

## 测试环境一键清空房间

仅测试环境使用：

```sql
delete from public.rooms;
```

这会清空所有房间和房间内玩家/游戏记录，但不会清空 `question_sets` 和社区题库。

## 推荐手动维护顺序

1. 先执行预览 SQL。
2. 确认没有正在使用的数据。
3. 删除旧 `LOBBY` / `GAME_RESULT` 房间。
4. 删除 3 天前未发布且未使用的题库。
5. 如果 Cloudinary 空间也需要清理，另行在 Cloudinary 控制台或 API 删除图片文件。
