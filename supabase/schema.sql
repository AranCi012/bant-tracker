-- =====================================================================
--  Bant Meta Tracker — schema Supabase
--  1. Cambia la password del gruppo qui sotto (riga con 'group_key').
--  2. Supabase → SQL Editor → incolla tutto → Run.
--  Puoi rieseguirlo quando vuoi (per esempio per cambiare password):
--  i dati esistenti non vengono toccati.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Codice di gruppo (non leggibile dalle API) ----------------
create schema if not exists private;

create table if not exists private.settings (
  key   text primary key,
  value text not null
);

insert into private.settings (key, value)
values ('group_key', 'CAMBIAMI-metti-una-password')   -- <<< CAMBIA QUI
on conflict (key) do update set value = excluded.value;

create or replace function private.has_group_key()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
           nullif(current_setting('request.headers', true), '')::json ->> 'x-group-key',
           ''
         ) = (select value from private.settings where key = 'group_key');
$$;

alter table private.settings enable row level security;
revoke all on private.settings from anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.has_group_key() to anon, authenticated;

-- Usata dall'app per verificare il codice al login
create or replace function public.check_group_key()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.has_group_key(); $$;

grant execute on function public.check_group_key() to anon, authenticated;

-- ---------- Tabelle ---------------------------------------------------
create table if not exists public.archetypes (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  sideboard_plan text not null default '',
  notes          text not null default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.decklists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  maindeck   text not null default '',
  sideboard  text not null default '',
  notes      text not null default '',
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  played_at    date not null default current_date,
  player       text not null,
  archetype_id uuid not null references public.archetypes(id) on delete restrict,
  decklist_id  uuid references public.decklists(id) on delete set null,
  event        text not null default '',
  opponent     text not null default '',
  g1 text not null check (g1 in ('W','L','D')),
  g2 text          check (g2 in ('W','L','D')),
  g3 text          check (g3 in ('W','L','D')),
  p1 boolean,   -- true = eri on the play in quella game
  p2 boolean,
  p3 boolean,
  notes        text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists matches_archetype_idx on public.matches(archetype_id);
create index if not exists matches_decklist_idx  on public.matches(decklist_id);
create index if not exists matches_played_idx    on public.matches(played_at);

-- ---------- Sicurezza: solo chi ha il codice di gruppo -----------------
alter table public.archetypes enable row level security;
alter table public.decklists  enable row level security;
alter table public.matches    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['archetypes','decklists','matches'] loop
    execute format('drop policy if exists "group access" on public.%I', t);
    execute format(
      'create policy "group access" on public.%I for all to anon, authenticated
         using (private.has_group_key()) with check (private.has_group_key())', t);
  end loop;
end $$;

grant select, insert, update, delete
  on public.archetypes, public.decklists, public.matches
  to anon, authenticated;

-- ---------- Archetipi iniziali (modificabili dall'app) ------------------
insert into public.archetypes (name) values
  ('Dimir Tempo'), ('Izzet Delver'), ('Sneak and Show'), ('Doomsday'),
  ('Oops All Spells'), ('Reanimator'), ('Storm'), ('Death and Taxes'),
  ('Lands'), ('Eldrazi'), ('Elves / Cradle'), ('Painter'),
  ('Affinity / Saga'), ('Initiative'), ('Mystic Forge'),
  ('Control (4c / Beanstalk)'), ('Red Prison'), ('Bant mirror'), ('Altro')
on conflict (name) do nothing;
