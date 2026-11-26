-- Tryb testowy „widok jako” (docs/test-mode.md): zapis w imieniu oglądanej osoby jest wykonywany i wycofywany nagłówkiem
-- `Prefer: tx=rollback`. Domyślnie PostgREST (Data API Supabase) ten nagłówek pomija i zatwierdza zapis — serwer CRM wykrywa to
-- zapisem próbnym przy wejściu („Baza nie wycofuje zapisów próbnych”) i nie otwiera trybu.
--
-- `commit-allow-override`: zapisy jak dotąd są zatwierdzane, ale zapytanie może samo poprosić o wycofanie swojej transakcji
-- (`Prefer: tx=rollback`, w supabase-js `.rollback()`). Klient może tylko zrezygnować z własnego zapisu — nie dostaje żadnych
-- nowych uprawnień; RLS, funkcje i wyzwalacze działają bez zmian.
-- Ustawienie PostgREST w bazie (jak `pgrst.db_plan_enabled` w dokumentacji Supabase) i przeładowanie konfiguracji.

ALTER ROLE authenticator SET pgrst.db_tx_end = 'commit-allow-override';

NOTIFY pgrst, 'reload config';
