create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_player_id text not null,
  game_status text not null default 'LOBBY',
  current_presenter_player_id text,
  current_game_id uuid,
  prepared_question_set_id uuid,
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
