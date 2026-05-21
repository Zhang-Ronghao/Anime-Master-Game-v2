create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  reveal_round integer not null check (reveal_round >= 1),
  player_id text not null,
  answer_text text not null,
  submitted_at timestamptz not null default now(),
  unique (game_session_id, question_index, reveal_round, player_id)
);

create table if not exists public.player_scores (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id text not null,
  score integer not null default 0 check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  unique (game_session_id, player_id)
);

create table if not exists public.question_results (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  player_id text not null,
  scored_round integer not null check (scored_round >= 1),
  score_awarded integer not null check (score_awarded >= 0),
  judged_by_player_id text not null,
  judged_at timestamptz not null default now(),
  unique (game_session_id, question_index, player_id)
);

create index if not exists answers_game_question_round_idx
  on public.answers (game_session_id, question_index, reveal_round);

create index if not exists answers_game_question_player_idx
  on public.answers (game_session_id, question_index, player_id);

create index if not exists player_scores_game_score_idx
  on public.player_scores (game_session_id, score desc);

create index if not exists question_results_game_question_idx
  on public.question_results (game_session_id, question_index);

alter table public.answers replica identity full;
alter table public.player_scores replica identity full;
alter table public.question_results replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.answers;
  alter publication supabase_realtime add table public.player_scores;
  alter publication supabase_realtime add table public.question_results;
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.answers to anon, authenticated;
grant select, insert, update, delete on public.player_scores to anon, authenticated;
grant select, insert, update, delete on public.question_results to anon, authenticated;
