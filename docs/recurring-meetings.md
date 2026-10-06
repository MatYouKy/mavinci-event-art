# Spotkania cykliczne

CRM i aplikacja mobilna pozwalają wybrać spotkanie jednorazowe, codzienne,
co tydzień lub co dwa tygodnie. Dzień i godzina wynikają z pierwszego terminu.
Cykl zachowuje godzinę w Europe/Warsaw, również przy zmianie czasu.
Każde wystąpienie ma własne ID, uczestników i przypomnienia.

Edycja: tylko ten termin albo ten i kolejne. Zmiana cyklu wymaga wybrania
przyszłego terminu i zakresu „To i kolejne”. „Nie powtarzaj” w tym zakresie
zachowuje wybrany termin jako jednorazowy i kończy poprzednią serię.
Usunięcie jednego terminu nie odtwarza go podczas uzupełniania cyklu.
Usunięcie przyszłych terminów pozostawia historię.

## Wdrożenie

Najpierw zastosować `supabase/migrations/20260929120000_recurring_meetings.sql`
w Supabase, następnie wdrożyć CRM oraz nową wersję aplikacji mobilnej.
Migracja wymaga działającego pg_cron oraz istniejącego mechanizmu wysyłki
push z notification_recipients. Migracja została zastosowana w produkcyjnym
projekcie Supabase `fuuljhhuhfojtmmfmskq` 29.09.2026 i wpisana do historii
migracji jako `20260929120000`. Potwierdzono aktywność obu harmonogramów
oraz prywatność tabeli serii i funkcji harmonogramu.
Nie uruchamiano buildu, testów, typecheck ani lintingu zgodnie z .build-policy.md.

Migracja tworzy harmonogramy `refresh-meeting-series` (codziennie) i
`process-meeting-reminders` (co minutę). Kolejne terminy są materializowane
na 180 dni naprzód; cykl nie kończy się po tym czasie. W widokach kalendarza
terminy dalsze niż to okno pojawią się w miarę jego przesuwania.
Odległy pierwszy termin jest zapisywany od razu.

Nowe i edytowane spotkania obsługuje serwer (`server_reminders=true`).
Pozostałe istniejące spotkania zachowują dotychczasową obsługę.
Aplikacja mobilna usuwa nieaktualne przypomnienia lokalne po otwarciu,
powrocie na pierwszy plan i otrzymaniu zmiany przez Realtime.
Użytkownicy starszej wersji aplikacji powinni ją zaktualizować, aby nie
planowała lokalnych duplikatów dla spotkań obsługiwanych przez serwer.
Przypomnienia wymagają standardowych uprawnień do powiadomień na telefonie.

Powiadomienia są deduplikowane po ID terminu, godzinie rozpoczęcia i liczbie
minut wyprzedzenia. Scheduler nadrabia do 10 minut opóźnienia, nie wysyła
zaległych przypomnień o spotkaniach, które już minęły. Samo generowanie
kolejnych terminów nie wysyła zaproszeń na każdy z nich.
RPC zapisują termin i uczestników w jednej transakcji; szablony serii oraz
funkcje harmonogramu nie są dostępne bezpośrednio klientom.
