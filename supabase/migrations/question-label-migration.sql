alter table public.questions
  add column if not exists label_text text,
  add column if not exists label_source text,
  add column if not exists label_source_answer_id uuid references public.answers(id) on delete set null,
  add column if not exists label_updated_by_player_id text,
  add column if not exists label_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_label_source_check'
  ) then
    alter table public.questions
      add constraint questions_label_source_check
      check (label_source is null or label_source in ('manual', 'answer'));
  end if;
end $$;

create index if not exists questions_question_set_id_order_index_idx
  on public.questions(question_set_id, order_index);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'questions'
  ) then
    alter publication supabase_realtime add table public.questions;
  end if;
end $$;

-- This enables Realtime for public.questions, so all players can see newly saved labels without refreshing.
