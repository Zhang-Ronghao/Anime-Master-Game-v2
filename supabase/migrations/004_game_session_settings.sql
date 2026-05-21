alter table public.game_sessions
add column if not exists max_reveal_rounds integer not null default 3 check (max_reveal_rounds >= 1),
add column if not exists round_seconds integer not null default 30 check (round_seconds >= 1),
add column if not exists round_scores jsonb not null default '[3, 2, 1]'::jsonb;
