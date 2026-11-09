-- Elementy w schematach zarządzanych przez Supabase, których nie obejmuje „supabase db dump”:
-- reguły dostępu do plików (storage) i kanałów (realtime), wyzwalacze na auth/storage wołające nasze funkcje,
-- tabele w publikacji supabase_realtime. Wynik: SQL do uruchomienia w nowym projekcie po odtworzeniu schematu.
-- Pusta ścieżka wyszukiwania: nazwy w regułach i wyzwalaczach z pełnym schematem (public.employees, …).
set search_path = '';

select '-- wygenerowano ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ' ze starego projektu';

select format('drop policy if exists %I on %I.%I;', policyname, schemaname, tablename) || E'\n' ||
       format('create policy %I on %I.%I as %s for %s to %s%s%s;',
         policyname, schemaname, tablename, permissive, cmd,
         (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
         case when qual is not null then ' using (' || qual || ')' else '' end,
         case when with_check is not null then ' with check (' || with_check || ')' else '' end)
  from pg_policies
 where schemaname in ('storage', 'realtime')
 order by schemaname, tablename, policyname;

select format('drop trigger if exists %I on %s;', t.tgname, t.tgrelid::regclass) || E'\n' || pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('auth', 'storage') and not t.tgisinternal
   and p.pronamespace::regnamespace::text not in ('auth', 'storage')
 order by 1;

select format($f$do $m$ begin if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = %L and tablename = %L) then alter publication supabase_realtime add table %I.%I; end if; end $m$;$f$,
              schemaname, tablename, schemaname, tablename)
  from pg_publication_tables
 where pubname = 'supabase_realtime'
 order by schemaname, tablename;
