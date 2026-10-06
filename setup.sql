-- Snake Zen v5: cuentas, perfiles, amistades, avisos y récords.
-- Pegar y ejecutar una vez en Supabase > SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Jugador' check (char_length(display_name) between 1 and 18),
  current_skin text not null default 'mint' check (current_skin in ('mint','citrus','berry','ocean','grape','gold','lava','bamboo','midnight','coral','cloud','neon')),
  seeds integer not null default 0 check (seeds >= 0),
  unlocked_skins text[] not null default array['mint','citrus']::text[],
  total_apples integer not null default 0 check (total_apples >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  games_won integer not null default 0 check (games_won >= 0),
  best_solo integer not null default 0 check (best_solo >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  constraint friendships_no_self check (user_id <> friend_id)
);
create unique index if not exists friendships_pair_unique
  on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));
create index if not exists friendships_user_idx on public.friendships (user_id, status);
create index if not exists friendships_friend_idx on public.friendships (friend_id, status);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('friend_request','friend_accepted','game_invite','game_accepted')),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_no_self check (recipient_id <> sender_id)
);
create index if not exists notifications_recipient_date_idx
  on public.notifications (recipient_id, created_at desc);

create table if not exists public.team_records (
  team_key text primary key,
  mode text not null check (mode in ('solo','team')),
  member_ids uuid[] not null,
  score integer not null check (score >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete cascade
);
create index if not exists team_records_score_idx on public.team_records (score desc, updated_at asc);
create index if not exists team_records_members_gin_idx on public.team_records using gin (member_ids);

create table if not exists public.game_results (
  game_id uuid not null,
  player_id uuid not null references auth.users(id) on delete cascade,
  team_key text not null,
  mode text not null check (mode in ('solo','team')),
  member_ids uuid[] not null,
  score integer not null check (score >= 0),
  result_type text not null,
  created_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index if not exists game_results_player_date_idx on public.game_results (player_id, created_at desc);
create index if not exists game_results_members_gin_idx on public.game_results using gin (member_ids);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.notifications enable row level security;
alter table public.team_records enable row level security;
alter table public.game_results enable row level security;

drop policy if exists "Profiles visible to signed-in users" on public.profiles;
create policy "Profiles visible to signed-in users" on public.profiles
  for select to authenticated using (true);
drop policy if exists "Insert own profile" on public.profiles;
create policy "Insert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Read your friendships" on public.friendships;
create policy "Read your friendships" on public.friendships
  for select to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);
drop policy if exists "Send friend request as yourself" on public.friendships;
create policy "Send friend request as yourself" on public.friendships
  for insert to authenticated with check (auth.uid() = user_id and status = 'pending' and user_id <> friend_id);
drop policy if exists "Accept received friend request" on public.friendships;
create policy "Accept received friend request" on public.friendships
  for update to authenticated using (auth.uid() = friend_id and status = 'pending')
  with check (auth.uid() = friend_id and status = 'accepted');
drop policy if exists "Remove your friendship" on public.friendships;
create policy "Remove your friendship" on public.friendships
  for delete to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "Read your notifications" on public.notifications;
create policy "Read your notifications" on public.notifications
  for select to authenticated using (auth.uid() = recipient_id);
drop policy if exists "Create notifications as sender" on public.notifications;
create policy "Create notifications as sender" on public.notifications
  for insert to authenticated with check (auth.uid() = sender_id and recipient_id <> sender_id);
drop policy if exists "Mark your notifications read" on public.notifications;
create policy "Mark your notifications read" on public.notifications
  for update to authenticated using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "Read global records" on public.team_records;
create policy "Read global records" on public.team_records
  for select to authenticated using (true);
drop policy if exists "Read game history" on public.game_results;
create policy "Read game history" on public.game_results
  for select to authenticated using (true);

-- API pública limitada: cada cuenta puede editar solo su perfil y los campos no estadísticos.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name, current_skin, seeds, unlocked_skins) on public.profiles to authenticated;
grant update (display_name, current_skin, seeds, unlocked_skins) on public.profiles to authenticated;

revoke all on public.friendships from anon, authenticated;
grant select, insert, delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant insert (recipient_id, sender_id, kind, data) on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke all on public.team_records from anon, authenticated;
grant select on public.team_records to authenticated;
revoke all on public.game_results from anon, authenticated;
grant select on public.game_results to authenticated;

create or replace function public.record_game_result(
  p_game_id uuid,
  p_mode text,
  p_member_ids uuid[],
  p_score integer,
  p_result_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_members uuid[];
  v_team_key text;
  v_inserted integer;
begin
  if v_user_id is null then raise exception 'Debes iniciar sesión.'; end if;
  if p_game_id is null or p_score is null or p_score < 0 or p_score > 396 then
    raise exception 'Resultado de partida no válido.';
  end if;
  if p_mode not in ('solo','team') then raise exception 'Modo no válido.'; end if;
  if p_result_type not in ('board-full','draw','collision','forfeit','disconnect') then
    raise exception 'Final de partida no válido.';
  end if;
  select array_agg(distinct member_id order by member_id) into v_members
    from unnest(coalesce(p_member_ids, array[]::uuid[])) as members(member_id);
  if coalesce(cardinality(v_members), 0) = 0 or cardinality(v_members) > 6 then
    raise exception 'Equipo no válido.';
  end if;
  if array_position(v_members, null) is not null then raise exception 'Equipo no válido.'; end if;
  if cardinality(v_members) <> cardinality(p_member_ids) then raise exception 'Equipo repetido.'; end if;
  if not (v_user_id = any(v_members)) then raise exception 'Tu cuenta no forma parte del equipo.'; end if;
  if (p_mode = 'solo' and cardinality(v_members) <> 1)
      or (p_mode = 'team' and cardinality(v_members) < 2) then
    raise exception 'El modo no coincide con el equipo.';
  end if;

  v_team_key := p_mode || ':' || array_to_string(v_members, ':');
  insert into public.game_results (game_id, player_id, team_key, mode, member_ids, score, result_type)
  values (p_game_id, v_user_id, v_team_key, p_mode, v_members, p_score, p_result_type)
  on conflict (game_id, player_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;

  insert into public.team_records (team_key, mode, member_ids, score, updated_at, updated_by)
  values (v_team_key, p_mode, v_members, p_score, now(), v_user_id)
  on conflict (team_key) do update
    set score = excluded.score, updated_at = now(), updated_by = v_user_id
    where excluded.score > public.team_records.score;

  update public.profiles
    set games_played = games_played + 1,
        total_apples = total_apples + p_score,
        games_won = games_won + case when p_result_type = 'board-full' then 1 else 0 end,
        best_solo = case when p_mode = 'solo' then greatest(best_solo, p_score) else best_solo end
    where id = v_user_id;
end;
$$;
revoke all on function public.record_game_result(uuid, text, uuid[], integer, text) from public, anon;
grant execute on function public.record_game_result(uuid, text, uuid[], integer, text) to authenticated;
