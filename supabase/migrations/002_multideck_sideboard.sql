-- =====================================================================
--  Migrazione 002 — più mazzi + sideboard per game + guide di sideboard
--  Solo aggiunte (nessuna colonna rimossa): il sito v1 continua a
--  funzionare anche dopo averla eseguita. Si può rieseguire senza danni.
--  Supabase → SQL Editor → incolla → Run (dopo schema.sql).
-- =====================================================================

-- ---------- I nostri mazzi --------------------------------------------
create table if not exists public.decks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  notes      text not null default '',
  created_at timestamptz not null default now()
);

alter table public.decklists add column if not exists deck_id uuid references public.decks(id) on delete cascade;
alter table public.matches   add column if not exists deck_id uuid references public.decks(id) on delete restrict;

-- Sideboard effettivamente usata in G2 / G3: {"in":[{"q":2,"name":"..."}],"out":[...]}
alter table public.matches add column if not exists sb2 jsonb;
alter table public.matches add column if not exists sb3 jsonb;

create index if not exists matches_deck_idx   on public.matches(deck_id);
create index if not exists decklists_deck_idx on public.decklists(deck_id);

-- ---------- Guide di sideboard (per nostro mazzo × archetipo) ----------
create table if not exists public.sideboard_guides (
  id           uuid primary key default gen_random_uuid(),
  deck_id      uuid not null references public.decks(id) on delete cascade,
  archetype_id uuid not null references public.archetypes(id) on delete cascade,
  play_in      text not null default '',   -- formato lista: "2 Force of Negation"
  play_out     text not null default '',
  draw_in      text not null default '',
  draw_out     text not null default '',
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (deck_id, archetype_id)
);

-- ---------- Sicurezza: stesso codice di gruppo delle altre tabelle ------
alter table public.decks            enable row level security;
alter table public.sideboard_guides enable row level security;

do $$
declare t text;
begin
  foreach t in array array['decks','sideboard_guides'] loop
    execute format('drop policy if exists "group access" on public.%I', t);
    execute format(
      'create policy "group access" on public.%I for all to anon, authenticated
         using (private.has_group_key()) with check (private.has_group_key())', t);
  end loop;
end $$;

grant select, insert, update, delete on public.decks, public.sideboard_guides to anon, authenticated;

-- ---------- Dati esistenti → mazzo "Bant" -------------------------------
-- Il default sulle colonne fa sì che anche il sito v1 (che non conosce
-- deck_id) continui a salvare i match nel mazzo giusto.
do $$
declare bant uuid;
begin
  insert into public.decks (name) values ('Bant') on conflict (name) do nothing;
  select id into bant from public.decks where name = 'Bant';

  update public.decklists set deck_id = bant where deck_id is null;
  update public.matches   set deck_id = bant where deck_id is null;

  execute format('alter table public.decklists alter column deck_id set default %L::uuid', bant);
  execute format('alter table public.matches   alter column deck_id set default %L::uuid', bant);

  -- Il vecchio "piano di sideboard" testuale diventa le note della guida di Bant
  insert into public.sideboard_guides (deck_id, archetype_id, notes)
  select bant, a.id, a.sideboard_plan
  from public.archetypes a
  where a.sideboard_plan <> ''
  on conflict (deck_id, archetype_id) do nothing;
end $$;
