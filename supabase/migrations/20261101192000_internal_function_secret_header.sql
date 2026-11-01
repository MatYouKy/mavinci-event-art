-- Nagłówek X-Internal-Function-Secret w wywołaniach Edge Functions z bazy (2026-11-01).
--
-- CO: invoke_scheduled_tender_scan() (pg_cron → fetch-tenders), invoke_ai_email_qualification() (pg_cron →
-- qualify-incoming-email) i trigger dispatch_notification_recipient_push() (nowy odbiorca powiadomienia →
-- send-crm-notification-push) dołączają nagłówek 'X-Internal-Function-Secret' z sekretem Vault
-- „internal_function_secret”. Dotychczasowe nagłówki (Authorization/apikey z kluczem anon — bramka verify_jwt)
-- zostają bez zmian.
-- DLACZEGO: Edge Functions wywoływane przez serwer mają odróżniać wywołanie wewnętrzne od dowolnego klienta
-- z publicznym kluczem (docs/edge-functions-access.md, sekcja 7, pkt 1).
-- KOGO DOTYCZY: nikogo z użytkowników. Dopóki sekretu nie ma w Vault, nagłówek jest pomijany (jsonb_strip_nulls),
-- więc działanie się nie zmienia. Sekret ustawia administrator (Vault + INTERNAL_FUNCTION_SECRET w Edge Functions,
-- ta sama wartość) — migracja go nie tworzy i nie zawiera żadnej wartości.
-- Trigger zachowuje EXCEPTION WHEN OTHERS: awaria pusha (także odczytu Vault) nie cofa powiadomienia.
-- Treść funkcji z produkcji (pg_get_functiondef, 2026-11-01); zmienione wyłącznie nagłówki żądania.
-- CREATE OR REPLACE zachowuje uprawnienia (po 20261101190000: bez EXECUTE dla anon i authenticated).
-- Niezależna od pozostałych migracji; można bezpiecznie uruchomić ponownie.
BEGIN;

CREATE OR REPLACE FUNCTION public.invoke_scheduled_tender_scan()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_project_url text := 'https://fuuljhhuhfojtmmfmskq.supabase.co';
  v_anon_key text;
  v_request_id bigint;
  v_internal_secret text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name IN ('supabase_anon_key', 'anon_key')
      ORDER BY CASE name WHEN 'supabase_anon_key' THEN 0 ELSE 1 END
      LIMIT 1
    $query$
    INTO v_anon_key;

    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret
         FROM vault.decrypted_secrets
         WHERE name IN ('supabase_url', 'project_url')
         ORDER BY CASE name WHEN 'supabase_url' THEN 0 ELSE 1 END
         LIMIT 1),
        $1
      )
    $query$
    INTO v_project_url
    USING v_project_url;
    -- Sekret wywołań wewnętrznych (Edge Functions sprawdzają X-Internal-Function-Secret); brak → bez nagłówka.
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_function_secret' LIMIT 1
    $query$ INTO v_internal_secret;
  END IF;

  IF NULLIF(v_anon_key, '') IS NULL THEN
    RAISE WARNING
      'Tender scan skipped: add the Supabase anon key to Vault as supabase_anon_key';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/fetch-tenders',
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key,
      'X-Internal-Function-Secret', NULLIF(v_internal_secret, '')
    )),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_ai_email_qualification()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_project_url text := 'https://fuuljhhuhfojtmmfmskq.supabase.co';
  v_anon_key text;
  v_request_id bigint;
  v_internal_secret text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name IN ('supabase_anon_key', 'anon_key')
      ORDER BY CASE name WHEN 'supabase_anon_key' THEN 0 ELSE 1 END
      LIMIT 1
    $query$ INTO v_anon_key;

    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name IN ('supabase_url', 'project_url')
         ORDER BY CASE name WHEN 'supabase_url' THEN 0 ELSE 1 END LIMIT 1),
        $1
      )
    $query$ INTO v_project_url USING v_project_url;
    -- Sekret wywołań wewnętrznych (Edge Functions sprawdzają X-Internal-Function-Secret); brak → bez nagłówka.
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_function_secret' LIMIT 1
    $query$ INTO v_internal_secret;
  END IF;

  IF NULLIF(v_anon_key, '') IS NULL THEN
    RAISE WARNING 'AI email qualification skipped: add supabase_anon_key to Vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/qualify-incoming-email',
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key,
      'X-Internal-Function-Secret', NULLIF(v_internal_secret, '')
    )),
    body := jsonb_build_object('batchSize', 10),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_notification_recipient_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'pg_temp'
AS $function$
DECLARE
  v_internal_secret text;
BEGIN
  IF COALESCE(NEW.is_read, false) THEN
    RETURN NEW;
  END IF;

  -- Sekret wywołań wewnętrznych z Vault; brak sekretu (lub Vault) → bez nagłówka, jak dotąd.
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_function_secret' LIMIT 1
    $query$ INTO v_internal_secret;
  END IF;

  PERFORM net.http_post(
    url := 'https://fuuljhhuhfojtmmfmskq.supabase.co/functions/v1/send-crm-notification-push',
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Function-Secret', NULLIF(v_internal_secret, '')
    )),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notification_recipients',
      'schema', 'public',
      'record', to_jsonb(NEW),
      'old_record', NULL
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push outage must never roll back the business notification itself.
  RAISE WARNING 'Unable to enqueue push for notification recipient %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

COMMIT;
