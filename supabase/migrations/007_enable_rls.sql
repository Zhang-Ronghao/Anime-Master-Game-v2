create or replace function public.current_player_id()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-player-id',
    ''
  );
$$;

create or replace function public.find_room_by_code(p_room_code text)
returns setof public.rooms
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.rooms
  where room_code = p_room_code
  limit 1;
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players
    where room_id = p_room_id
      and id = public.current_player_id()
  );
$$;

create or replace function public.is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where id = p_room_id
      and host_player_id = public.current_player_id()
  );
$$;

create or replace function public.room_player_count(p_room_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.players
  where room_id = p_room_id;
$$;

create or replace function public.room_exists(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where id = p_room_id
  );
$$;

create or replace function public.is_room_host_player(p_room_id uuid, p_player_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where id = p_room_id
      and host_player_id = p_player_id
  );
$$;

create or replace function public.is_game_participant(p_game_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_sessions gs
    where gs.id = p_game_session_id
      and public.is_room_member(gs.room_id)
  );
$$;

create or replace function public.is_game_presenter(p_game_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_sessions
    where id = p_game_session_id
      and presenter_player_id = public.current_player_id()
  );
$$;

create or replace function public.is_game_room_host(p_game_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_sessions gs
    join public.rooms r on r.id = gs.room_id
    where gs.id = p_game_session_id
      and r.host_player_id = public.current_player_id()
  );
$$;

create or replace function public.is_question_set_visible(p_question_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.question_sets qs
    where qs.id = p_question_set_id
      and (
        qs.is_public
        or qs.created_by_player_id = public.current_player_id()
        or exists (
          select 1
          from public.game_sessions gs
          where gs.question_set_id = qs.id
            and public.is_room_member(gs.room_id)
        )
        or exists (
          select 1
          from public.rooms r
          where r.prepared_question_set_id = qs.id
            and public.is_room_member(r.id)
        )
      )
  );
$$;

create or replace function public.is_question_set_game_presenter(p_question_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_sessions
    where question_set_id = p_question_set_id
      and presenter_player_id = public.current_player_id()
      and status = 'PLAYING'
  );
$$;

grant execute on function public.current_player_id() to anon, authenticated;
grant execute on function public.find_room_by_code(text) to anon, authenticated;
grant execute on function public.is_room_member(uuid) to anon, authenticated;
grant execute on function public.is_room_host(uuid) to anon, authenticated;
grant execute on function public.room_player_count(uuid) to anon, authenticated;
grant execute on function public.room_exists(uuid) to anon, authenticated;
grant execute on function public.is_room_host_player(uuid, text) to anon, authenticated;
grant execute on function public.is_game_participant(uuid) to anon, authenticated;
grant execute on function public.is_game_presenter(uuid) to anon, authenticated;
grant execute on function public.is_game_room_host(uuid) to anon, authenticated;
grant execute on function public.is_question_set_visible(uuid) to anon, authenticated;
grant execute on function public.is_question_set_game_presenter(uuid) to anon, authenticated;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.question_sets enable row level security;
alter table public.questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.answers enable row level security;
alter table public.player_scores enable row level security;
alter table public.question_results enable row level security;
alter table public.question_set_ratings enable row level security;

drop policy if exists rooms_select_related on public.rooms;
create policy rooms_select_related on public.rooms
for select to anon, authenticated
using (host_player_id = public.current_player_id() or public.is_room_member(id));

drop policy if exists rooms_insert_own_host on public.rooms;
create policy rooms_insert_own_host on public.rooms
for insert to anon, authenticated
with check (host_player_id = public.current_player_id());

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host on public.rooms
for update to anon, authenticated
using (host_player_id = public.current_player_id())
with check (host_player_id = public.current_player_id());

drop policy if exists rooms_delete_host on public.rooms;
create policy rooms_delete_host on public.rooms
for delete to anon, authenticated
using (host_player_id = public.current_player_id());

drop policy if exists players_select_room_members on public.players;
create policy players_select_room_members on public.players
for select to anon, authenticated
using (public.is_room_member(room_id) or id = public.current_player_id());

drop policy if exists players_insert_self on public.players;
create policy players_insert_self on public.players
for insert to anon, authenticated
with check (
  id = public.current_player_id()
  and public.room_exists(room_id)
  and is_host = public.is_room_host_player(room_id, id)
  and (
    public.room_player_count(room_id) < 15
    or public.is_room_member(room_id)
  )
);

drop policy if exists players_update_self on public.players;
create policy players_update_self on public.players
for update to anon, authenticated
using (id = public.current_player_id())
with check (
  id = public.current_player_id()
  and public.room_exists(room_id)
  and is_host = public.is_room_host_player(room_id, id)
  and (
    public.room_player_count(room_id) < 15
    or public.is_room_member(room_id)
  )
);

drop policy if exists players_delete_self_non_host on public.players;
create policy players_delete_self_non_host on public.players
for delete to anon, authenticated
using (id = public.current_player_id() and is_host = false);

drop policy if exists question_sets_select_visible on public.question_sets;
create policy question_sets_select_visible on public.question_sets
for select to anon, authenticated
using (public.is_question_set_visible(id));

drop policy if exists question_sets_insert_creator on public.question_sets;
create policy question_sets_insert_creator on public.question_sets
for insert to anon, authenticated
with check (created_by_player_id = public.current_player_id());

drop policy if exists question_sets_update_creator_or_public on public.question_sets;
create policy question_sets_update_creator_or_public on public.question_sets
for update to anon, authenticated
using (created_by_player_id = public.current_player_id() or is_public)
with check (created_by_player_id = public.current_player_id() or is_public);

drop policy if exists question_sets_delete_creator_private on public.question_sets;
create policy question_sets_delete_creator_private on public.question_sets
for delete to anon, authenticated
using (created_by_player_id = public.current_player_id() and is_public = false);

drop policy if exists questions_select_visible_set on public.questions;
create policy questions_select_visible_set on public.questions
for select to anon, authenticated
using (public.is_question_set_visible(question_set_id));

drop policy if exists questions_insert_set_creator on public.questions;
create policy questions_insert_set_creator on public.questions
for insert to anon, authenticated
with check (
  exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.created_by_player_id = public.current_player_id()
  )
);

drop policy if exists questions_update_set_creator_or_presenter on public.questions;
create policy questions_update_set_creator_or_presenter on public.questions
for update to anon, authenticated
using (
  exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.created_by_player_id = public.current_player_id()
  )
  or public.is_question_set_game_presenter(question_set_id)
)
with check (
  exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.created_by_player_id = public.current_player_id()
  )
  or public.is_question_set_game_presenter(question_set_id)
);

drop policy if exists questions_delete_set_creator on public.questions;
create policy questions_delete_set_creator on public.questions
for delete to anon, authenticated
using (
  exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.created_by_player_id = public.current_player_id()
  )
);

drop policy if exists game_sessions_select_room_members on public.game_sessions;
create policy game_sessions_select_room_members on public.game_sessions
for select to anon, authenticated
using (public.is_room_member(room_id));

drop policy if exists game_sessions_insert_room_host on public.game_sessions;
create policy game_sessions_insert_room_host on public.game_sessions
for insert to anon, authenticated
with check (public.is_room_host(room_id) and public.is_question_set_visible(question_set_id));

drop policy if exists game_sessions_update_host_or_presenter on public.game_sessions;
create policy game_sessions_update_host_or_presenter on public.game_sessions
for update to anon, authenticated
using (public.is_game_room_host(id) or presenter_player_id = public.current_player_id())
with check (public.is_game_room_host(id) or presenter_player_id = public.current_player_id());

drop policy if exists game_sessions_delete_room_host on public.game_sessions;
create policy game_sessions_delete_room_host on public.game_sessions
for delete to anon, authenticated
using (public.is_game_room_host(id));

drop policy if exists answers_select_own_or_presenter on public.answers;
create policy answers_select_own_or_presenter on public.answers
for select to anon, authenticated
using (
  public.is_game_participant(game_session_id)
  and (player_id = public.current_player_id() or public.is_game_presenter(game_session_id))
);

drop policy if exists answers_insert_self on public.answers;
create policy answers_insert_self on public.answers
for insert to anon, authenticated
with check (
  player_id = public.current_player_id()
  and public.is_game_participant(game_session_id)
  and not public.is_game_presenter(game_session_id)
);

drop policy if exists answers_update_self on public.answers;
create policy answers_update_self on public.answers
for update to anon, authenticated
using (player_id = public.current_player_id())
with check (player_id = public.current_player_id() and public.is_game_participant(game_session_id));

drop policy if exists answers_delete_self on public.answers;
create policy answers_delete_self on public.answers
for delete to anon, authenticated
using (player_id = public.current_player_id());

drop policy if exists player_scores_select_participants on public.player_scores;
create policy player_scores_select_participants on public.player_scores
for select to anon, authenticated
using (public.is_game_participant(game_session_id));

drop policy if exists player_scores_insert_presenter_or_host on public.player_scores;
create policy player_scores_insert_presenter_or_host on public.player_scores
for insert to anon, authenticated
with check (public.is_game_presenter(game_session_id) or public.is_game_room_host(game_session_id));

drop policy if exists player_scores_update_presenter_or_host on public.player_scores;
create policy player_scores_update_presenter_or_host on public.player_scores
for update to anon, authenticated
using (public.is_game_presenter(game_session_id) or public.is_game_room_host(game_session_id))
with check (public.is_game_presenter(game_session_id) or public.is_game_room_host(game_session_id));

drop policy if exists player_scores_delete_host on public.player_scores;
create policy player_scores_delete_host on public.player_scores
for delete to anon, authenticated
using (public.is_game_room_host(game_session_id));

drop policy if exists question_results_select_participants on public.question_results;
create policy question_results_select_participants on public.question_results
for select to anon, authenticated
using (public.is_game_participant(game_session_id));

drop policy if exists question_results_insert_presenter on public.question_results;
create policy question_results_insert_presenter on public.question_results
for insert to anon, authenticated
with check (judged_by_player_id = public.current_player_id() and public.is_game_presenter(game_session_id));

drop policy if exists question_results_update_presenter on public.question_results;
create policy question_results_update_presenter on public.question_results
for update to anon, authenticated
using (public.is_game_presenter(game_session_id))
with check (public.is_game_presenter(game_session_id));

drop policy if exists question_results_delete_presenter on public.question_results;
create policy question_results_delete_presenter on public.question_results
for delete to anon, authenticated
using (public.is_game_presenter(game_session_id));

drop policy if exists question_set_ratings_select_public on public.question_set_ratings;
create policy question_set_ratings_select_public on public.question_set_ratings
for select to anon, authenticated
using (
  exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.is_public = true
  )
);

drop policy if exists question_set_ratings_insert_self_public on public.question_set_ratings;
create policy question_set_ratings_insert_self_public on public.question_set_ratings
for insert to anon, authenticated
with check (
  player_id = public.current_player_id()
  and exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.is_public = true
  )
);

drop policy if exists question_set_ratings_update_self_public on public.question_set_ratings;
create policy question_set_ratings_update_self_public on public.question_set_ratings
for update to anon, authenticated
using (player_id = public.current_player_id())
with check (
  player_id = public.current_player_id()
  and exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
      and qs.is_public = true
  )
);

drop policy if exists question_set_ratings_delete_self on public.question_set_ratings;
create policy question_set_ratings_delete_self on public.question_set_ratings
for delete to anon, authenticated
using (player_id = public.current_player_id());
