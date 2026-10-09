-- Temas de tablero desbloqueables con semillas y sincronizados en el perfil.
-- Se ejecuta automáticamente mediante Supabase GitHub Integration.

alter table public.profiles
  add column if not exists board_theme text not null default 'garden',
  add column if not exists unlocked_board_themes text[] not null default array['garden']::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_board_theme_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_board_theme_check
      check (board_theme in ('garden', 'ocean', 'sunset', 'moon'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_unlocked_board_themes_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_unlocked_board_themes_check
      check (unlocked_board_themes <@ array['garden', 'ocean', 'sunset', 'moon']::text[]);
  end if;
end $$;

grant insert (board_theme, unlocked_board_themes) on public.profiles to authenticated;
grant update (board_theme, unlocked_board_themes) on public.profiles to authenticated;
