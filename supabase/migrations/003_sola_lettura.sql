-- =====================================================================
--  Migrazione 003 — accesso in SOLA LETTURA
--  Due codici: group_key (modifica, quello di sempre) e view_key (solo lettura).
--  Il database rifiuta qualsiasi scrittura fatta con il codice di sola lettura.
--  Si può rieseguire senza danni (il view_key esistente non viene cambiato).
--  Per cambiare il codice di sola lettura:
--    update private.settings set value = 'nuovo-codice' where key = 'view_key';
-- =====================================================================

insert into private.settings (key, value)
values ('view_key', 'vista-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10))
on conflict (key) do nothing;

-- 'edit' | 'view' | null in base all'header x-group-key
create or replace function private.access_level()
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
           when h <> '' and h = (select value from private.settings where key = 'group_key') then 'edit'
           when h <> '' and h = (select value from private.settings where key = 'view_key')  then 'view'
           else null
         end
  from (select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-group-key', '') as h) x;
$$;

create or replace function private.can_read()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.access_level() is not null; $$;

grant execute on function private.access_level() to anon, authenticated;
grant execute on function private.can_read()     to anon, authenticated;

-- Usata dall'app al login per sapere se l'utente può modificare
create or replace function public.access_level()
returns text
language sql stable security definer
set search_path = ''
as $$ select private.access_level(); $$;
grant execute on function public.access_level() to anon, authenticated;

-- Il codice di sola lettura, visibile solo a chi ha il codice di modifica (per il bottone "invita")
create or replace function public.get_view_key()
returns text
language sql stable security definer
set search_path = ''
as $$ select case when private.has_group_key() then (select value from private.settings where key = 'view_key') end; $$;
grant execute on function public.get_view_key() to anon, authenticated;

-- Politiche: leggere con uno dei due codici, scrivere solo con il codice di modifica
do $$
declare t text;
begin
  foreach t in array array['archetypes','decklists','matches','decks','sideboard_guides'] loop
    execute format('drop policy if exists "group access" on public.%I', t);
    execute format('drop policy if exists "read access" on public.%I', t);
    execute format('drop policy if exists "write access" on public.%I', t);
    execute format('create policy "read access" on public.%I for select to anon, authenticated using (private.can_read())', t);
    execute format('create policy "write access" on public.%I for all to anon, authenticated
                      using (private.has_group_key()) with check (private.has_group_key())', t);
  end loop;
end $$;
