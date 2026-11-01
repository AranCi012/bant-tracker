-- =====================================================================
--  Migrazione 005 — valutazione dei GIOCATORI avversari (Forte / Medio / Scarso)
--  Serve a pesare i risultati delle sidate in base alla bravura di chi abbiamo
--  affrontato. Solo aggiunte. Si può rieseguire senza danni. Richiede la 003.
-- =====================================================================

create table if not exists public.opponent_ratings (
  key        text primary key,            -- nome normalizzato (minuscolo, spazi compattati)
  name       text not null,               -- come lo scriviamo di solito
  rating     smallint not null check (rating between -1 and 1),   -- -1 scarso, 0 medio, 1 forte
  notes      text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.opponent_ratings enable row level security;
drop policy if exists "read access"  on public.opponent_ratings;
drop policy if exists "write access" on public.opponent_ratings;
create policy "read access"  on public.opponent_ratings for select to anon, authenticated using (private.can_read());
create policy "write access" on public.opponent_ratings for all to anon, authenticated
  using (private.has_group_key()) with check (private.has_group_key());
grant select, insert, update, delete on public.opponent_ratings to anon, authenticated;
