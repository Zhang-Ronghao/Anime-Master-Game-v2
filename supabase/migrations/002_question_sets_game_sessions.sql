create table if not exists public.question_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_by_player_id text not null,
  source text not null default 'uploaded' check (source in ('uploaded', 'community')),
  is_public boolean not null default false,
  image_count integer not null default 0 check (image_count >= 0),
  rating_avg numeric(3, 2) not null default 0 check (rating_avg >= 0 and rating_avg <= 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  image_url text not null,
  order_index integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  question_set_id uuid not null references public.question_sets(id) on delete restrict,
  presenter_player_id text not null,
  status text not null default 'PLAYING' check (status in ('QUESTION_SETUP', 'PLAYING', 'GAME_RESULT')),
  current_question_index integer not null default 0 check (current_question_index >= 0),
  current_reveal_round integer not null default 1 check (current_reveal_round >= 1),
  revealed_blocks jsonb not null default '[]'::jsonb,
  round_started_at timestamptz,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists questions_question_set_id_order_idx
  on public.questions (question_set_id, order_index);

create index if not exists question_sets_created_by_player_id_idx
  on public.question_sets (created_by_player_id);

create index if not exists game_sessions_room_id_idx
  on public.game_sessions (room_id);

create index if not exists game_sessions_question_set_id_idx
  on public.game_sessions (question_set_id);

alter table public.question_sets replica identity full;
alter table public.questions replica identity full;
alter table public.game_sessions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.question_sets;
  alter publication supabase_realtime add table public.questions;
  alter publication supabase_realtime add table public.game_sessions;
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.question_sets to anon, authenticated;
grant select, insert, update, delete on public.questions to anon, authenticated;
grant select, insert, update, delete on public.game_sessions to anon, authenticated;
