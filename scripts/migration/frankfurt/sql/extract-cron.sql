-- Aktywne crony jako polecenia cron.schedule (nazwa, harmonogram, polecenie).
select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command)
  from cron.job where active order by jobname;
