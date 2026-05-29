alter table public.game_sessions
add column if not exists game_mode text not null default 'ROUND_REVEAL'
  check (game_mode in ('ROUND_REVEAL', 'BUZZER_FIRST_CORRECT', 'BUZZER_RANKED'));

create table if not exists public.buzzer_answers (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  reveal_round integer not null check (reveal_round >= 1),
  player_id text not null,
  answer_text text not null,
  status text not null default 'pending' check (status in ('pending', 'correct', 'wrong')),
  score_awarded integer not null default 0 check (score_awarded >= 0),
  submitted_at timestamptz not null default now(),
  judged_at timestamptz,
  judged_by_player_id text,
  unique (game_session_id, question_index, reveal_round, player_id)
);

create index if not exists buzzer_answers_game_question_round_idx
  on public.buzzer_answers (game_session_id, question_index, reveal_round, submitted_at);

create index if not exists buzzer_answers_game_question_player_idx
  on public.buzzer_answers (game_session_id, question_index, player_id);

alter table public.buzzer_answers replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.buzzer_answers;
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.buzzer_answers to anon, authenticated;
