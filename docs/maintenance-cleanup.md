# Maintenance Cleanup SQL

本项目现在使用 Cloudflare D1。下面的 SQL 可用 `wrangler d1 execute` 执行。

本地预览：

```bash
npx wrangler d1 execute anime_master_game --local --command "select id, room_code, game_status, updated_at from rooms limit 20"
```

远程执行前建议先运行 `select` 预览，再运行 `delete`。

## 预览旧 LOBBY 房间

```sql
select id, room_code, game_status, created_at, updated_at
from rooms
where game_status = 'LOBBY'
  and updated_at < datetime('now', '-3 days')
order by updated_at asc;
```

## 删除旧 LOBBY 房间

```sql
delete from rooms
where game_status = 'LOBBY'
  and updated_at < datetime('now', '-3 days');
```

## 删除明显过期房间

```sql
delete from rooms
where (
  game_status in ('LOBBY', 'GAME_RESULT')
  and updated_at < datetime('now', '-3 days')
)
or (
  game_status in ('QUESTION_SETUP', 'PLAYING')
  and updated_at < datetime('now', '-1 day')
);
```

## 预览旧私有题库

```sql
select id, title, is_public, image_count, created_at, updated_at
from question_sets
where is_public = 0
  and created_at < datetime('now', '-3 days')
order by created_at asc;
```

## 删除未发布且未被游戏使用的旧题库

```sql
delete from question_sets
where is_public = 0
  and created_at < datetime('now', '-3 days')
  and not exists (
    select 1
    from game_sessions
    where game_sessions.question_set_id = question_sets.id
  );
```

## 测试环境清空房间

```sql
delete from rooms;
```

`rooms` 会级联删除房间玩家、游戏会话、答案、积分和判分记录；不会删除社区题库。
