alter table public.question_sets
add column if not exists image_urls_text text,
add column if not exists updated_at timestamptz not null default now();

create table if not exists public.question_set_ratings (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  player_id text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_set_id, player_id)
);

create index if not exists question_sets_public_created_idx
  on public.question_sets (is_public, created_at desc);

create index if not exists question_sets_public_rating_idx
  on public.question_sets (is_public, rating_avg desc, rating_count desc);

create index if not exists question_set_ratings_question_set_id_idx
  on public.question_set_ratings (question_set_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_question_sets_updated_at on public.question_sets;
create trigger set_question_sets_updated_at
before update on public.question_sets
for each row execute function public.set_updated_at();

drop trigger if exists set_question_set_ratings_updated_at on public.question_set_ratings;
create trigger set_question_set_ratings_updated_at
before update on public.question_set_ratings
for each row execute function public.set_updated_at();

alter table public.question_set_ratings replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.question_set_ratings;
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on public.question_set_ratings to anon, authenticated;
