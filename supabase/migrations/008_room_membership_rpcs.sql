create or replace function public.create_room_with_host(
  p_room_code text,
  p_player_id text,
  p_nickname text
)
returns setof public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  created_room public.rooms%rowtype;
begin
  if p_room_code !~ '^[0-9]{6}$' then
    raise exception '房间号格式错误。';
  end if;

  if nullif(trim(p_player_id), '') is null then
    raise exception '缺少玩家身份。';
  end if;

  if nullif(trim(p_nickname), '') is null then
    raise exception '请先输入昵称。';
  end if;

  insert into public.rooms (room_code, host_player_id)
  values (p_room_code, p_player_id)
  returning * into created_room;

  insert into public.players (id, room_id, nickname, is_host, last_seen_at)
  values (p_player_id, created_room.id, trim(p_nickname), true, now())
  on conflict (id) do update
    set room_id = excluded.room_id,
        nickname = excluded.nickname,
        is_host = excluded.is_host,
        last_seen_at = excluded.last_seen_at;

  return next created_room;
end;
$$;

create or replace function public.join_room_with_player(
  p_room_code text,
  p_player_id text,
  p_nickname text
)
returns setof public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms%rowtype;
  is_existing_player boolean;
begin
  if nullif(trim(p_player_id), '') is null then
    raise exception '缺少玩家身份。';
  end if;

  if nullif(trim(p_nickname), '') is null then
    raise exception '请先输入昵称。';
  end if;

  select *
  into target_room
  from public.rooms
  where room_code = p_room_code
  limit 1;

  if not found then
    return;
  end if;

  select exists (
    select 1
    from public.players
    where id = p_player_id
      and room_id = target_room.id
  )
  into is_existing_player;

  if exists (
    select 1
    from public.players
    where room_id = target_room.id
      and id <> p_player_id
      and lower(nickname) = lower(trim(p_nickname))
  ) then
    raise exception '该昵称已在房间中使用，请换一个昵称。';
  end if;

  if not is_existing_player and public.room_player_count(target_room.id) >= 15 then
    raise exception '房间人数已满，最多 15 人。';
  end if;

  insert into public.players (id, room_id, nickname, is_host, last_seen_at)
  values (
    p_player_id,
    target_room.id,
    trim(p_nickname),
    target_room.host_player_id = p_player_id,
    now()
  )
  on conflict (id) do update
    set room_id = excluded.room_id,
        nickname = excluded.nickname,
        is_host = excluded.is_host,
        last_seen_at = excluded.last_seen_at;

  return next target_room;
end;
$$;

grant execute on function public.create_room_with_host(text, text, text) to anon, authenticated;
grant execute on function public.join_room_with_player(text, text, text) to anon, authenticated;
