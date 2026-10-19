-- =====================================================================
--  Migrazione 004 — GRUPPI di archetipi (Combo, Control, Tempo, ...)
--  Ogni mazzo avversario può appartenere a un gruppo più grande, per vedere
--  le statistiche anche per famiglia. Solo aggiunte: i dati esistenti non
--  cambiano. Si può rieseguire senza danni. Richiede la migrazione 003.
-- =====================================================================

create table if not exists public.archetype_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.archetypes
  add column if not exists group_id uuid references public.archetype_groups(id) on delete set null;

create index if not exists archetypes_group_idx on public.archetypes(group_id);

-- Stesse regole delle altre tabelle: leggere con uno dei due codici, scrivere solo con quello di modifica
alter table public.archetype_groups enable row level security;
drop policy if exists "read access"  on public.archetype_groups;
drop policy if exists "write access" on public.archetype_groups;
create policy "read access"  on public.archetype_groups for select to anon, authenticated using (private.can_read());
create policy "write access" on public.archetype_groups for all to anon, authenticated
  using (private.has_group_key()) with check (private.has_group_key());
grant select, insert, update, delete on public.archetype_groups to anon, authenticated;

-- Gruppi iniziali (si rinominano/eliminano dall'app)
insert into public.archetype_groups (name, sort) values
  ('Combo', 1), ('Control', 2), ('Tempo', 3), ('Aggro', 4), ('Midrange', 5), ('Prison', 6), ('Big mana', 7)
on conflict (name) do nothing;
