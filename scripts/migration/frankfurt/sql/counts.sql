-- Dokładna liczba wierszy w każdej tabeli (nazwa<TAB>liczba) — do porównania starego i nowego projektu.
set statement_timeout = 0;
select format('%s.%s', table_schema, table_name),
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and (table_schema in ('public', 'private', 'supabase_migrations')
        or (table_schema = 'auth' and table_name in ('users', 'identities')))
 order by 1;
