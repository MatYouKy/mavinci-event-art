-- „Uzgodnij automatycznie” w CRM kończył się błędem „UPDATE requires a WHERE clause” (21000) (2026-11-03).
--
-- Supabase dla zapytań z API (PostgREST, rola authenticator) ładuje rozszerzenie safeupdate, które odrzuca UPDATE i DELETE
-- bez klauzuli WHERE — także wewnątrz funkcji. W reconcile_bank_month jedna instrukcja na tabeli roboczej recon_tx nie miała
-- WHERE, więc uzgodnienie działało z SQL Editora, ale nie z przycisku w CRM. Poprawka punktowa: dopisane „WHERE true”
-- (zmienia wszystkie wiersze tabeli roboczej, jak dotąd). Przegląd wszystkich funkcji w public/private nie wykazał innych
-- UPDATE/DELETE bez WHERE. Plik można bezpiecznie uruchomić ponownie.
BEGIN;

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reconcile_bank_month(uuid,integer,integer)'::regprocedure);
  v_old text := 'UPDATE recon_tx SET text_compact = replace(text_norm, '' '', '''');';
  v_new text := 'UPDATE recon_tx SET text_compact = replace(text_norm, '' '', '''') WHERE true;  -- WHERE wymagany przez safeupdate (wywołania z API)';
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'reconcile_bank_month ma już poprawkę — pomijam.';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'reconcile_bank_month ma nieoczekiwaną treść (brak instrukcji text_compact). Sprawdź ręcznie.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;

COMMIT;
