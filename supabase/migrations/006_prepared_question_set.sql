alter table public.rooms
  add column if not exists prepared_question_set_id uuid references public.question_sets(id) on delete set null;
