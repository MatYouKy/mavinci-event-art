-- KSeF: automatyczna synchronizacja po przeniesieniu do Frankfurtu i alert przestoju — 2026-11-17.
--
-- CO I DLACZEGO
-- 1. Od 11.11.2026 codzienne pobieranie faktur z KSeF (pg_cron → Edge Function sync-ksef-daily) kończyło się odmową
--    403: funkcja porównywała klucz service_role zapisany w Vault z kluczem, który ma w środowisku, a po przeniesieniu
--    projektu to nie te same klucze. Teraz wywołanie jest podpisane osobnym losowym sekretem z Vault
--    (ksef_daily_worker_secret, nagłówek X-Ksef-Daily-Worker-Secret), który funkcja sprawdza w bazie — tak jak worker
--    e-maili (verify_scheduled_email_worker_secret). Sekret tworzy ta migracja; nikt go nie wpisuje ani nie kopiuje.
--    Klucz ksef_daily_service_role_key w Vault nie jest już używany (można go usunąć w panelu Supabase → Vault).
--    Wymaga wdrożenia nowej wersji sync-ksef-daily (verify_jwt = false w supabase/config.toml — funkcja sama
--    sprawdza sekret).
-- 2. public.invoke_daily_ksef_sync(p_force boolean DEFAULT false): harmonogram bez zmian (09:00 czasu polskiego);
--    `SELECT public.invoke_daily_ksef_sync(true);` w SQL Editorze uruchamia synchronizację od razu (ostatnie 31 dni —
--    nadrabia przestój Mavinci od 10.11 i NASTROJOWO od 26.10).
-- 3. „Kondycja systemu” (process_crm_system_health_alerts): nowy alarm „brak udanej synchronizacji KSeF od ponad 26 h”
--    dla każdej aktywnej działalności z włączonym automatem — niezależnie od przyczyny. Dotąd alarm liczył tylko błędy
--    zapisane w logu KSeF, a odmowa 403 następuje przed zapisem logu, więc od 11.11 nie było żadnego alarmu.
--    Alarm raz dziennie, z nazwą działalności, datą ostatniej udanej synchronizacji i ostatnim błędem; odbiorcy:
--    osoby z „Zarządzaniem finansami” tej działalności (w tym administratorzy).
-- Wymaga: pg_net, pg_cron, supabase_vault, pgcrypto (są w projekcie). Plik można uruchomić ponownie.
BEGIN;

-- 1. Sekret wywołania (tylko Vault) -----------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ksef_daily_worker_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ksef_daily_worker_secret',
      'Podpis wywołania sync-ksef-daily z pg_cron (public.invoke_daily_ksef_sync).');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_ksef_daily_worker_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(p_secret, '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'ksef_daily_worker_secret' AND decrypted_secret = p_secret
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.verify_ksef_daily_worker_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_ksef_daily_worker_secret(text) TO service_role;
COMMENT ON FUNCTION public.verify_ksef_daily_worker_secret(text) IS
  'Czy podany sekret to ksef_daily_worker_secret z Vault (Edge Function sync-ksef-daily, tylko service_role).';

-- 2. Wywołanie synchronizacji --------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.invoke_daily_ksef_sync();

CREATE OR REPLACE FUNCTION public.invoke_daily_ksef_sync(p_force boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_project_url text;
  v_worker_secret text;
  v_request_id bigint;
BEGIN
  -- pg_cron działa w UTC: tylko jedna z dwóch godzin harmonogramu to 09:00 w Warszawie.
  IF NOT coalesce(p_force, false) AND to_char(now() AT TIME ZONE 'Europe/Warsaw', 'HH24:MI') <> '09:00' THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_project_url FROM vault.decrypted_secrets WHERE name = 'ksef_daily_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_worker_secret FROM vault.decrypted_secrets WHERE name = 'ksef_daily_worker_secret' LIMIT 1;

  -- Bez cichego pominięcia: brak konfiguracji kończy zadanie pg_cron błędem.
  IF NULLIF(btrim(v_project_url), '') IS NULL OR NULLIF(btrim(v_worker_secret), '') IS NULL THEN
    RAISE EXCEPTION 'KSeF: brak konfiguracji harmonogramu w Vault (ksef_daily_project_url / ksef_daily_worker_secret).';
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/sync-ksef-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Ksef-Daily-Worker-Secret', v_worker_secret
    ),
    body := jsonb_build_object('source', CASE WHEN p_force THEN 'manual' ELSE 'pg_cron' END),
    timeout_milliseconds := 300000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_daily_ksef_sync(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_daily_ksef_sync(boolean) TO service_role;
COMMENT ON FUNCTION public.invoke_daily_ksef_sync(boolean) IS
  'Pobieranie faktur KSeF o 09:00 czasu polskiego (pg_cron, zmiana czasu uwzględniona); p_force = true — od razu. Podpis wywołania: ksef_daily_worker_secret z Vault.';

-- Harmonogram bez zmian (polecenie `SELECT public.invoke_daily_ksef_sync();` korzysta z wartości domyślnej).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-ksef-sync-0900-warsaw') THEN
    PERFORM cron.schedule('daily-ksef-sync-0900-warsaw', '0 7,8 * * *', 'SELECT public.invoke_daily_ksef_sync();');
  END IF;
END $$;

-- 3. Kondycja systemu: alarm przestoju KSeF ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_crm_system_health_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  service_record record;
  recipient record;
  stale record;
  notification_id_value uuid;
  alert_key_value text;
  sent_count integer := 0;
BEGIN
  FOR service_record IN
    SELECT * FROM (
      SELECT 'push'::text AS service_key, 'Powiadomienia push'::text AS service_label,
        (SELECT COUNT(*) FROM public.notification_push_deliveries WHERE status='failed' AND created_at > now()-interval '24 hours')::integer AS failed,
        (SELECT COUNT(*) FROM public.notification_push_deliveries WHERE status='processing' AND created_at < now()-interval '15 minutes')::integer AS pending
      UNION ALL
      SELECT 'ksef', 'Synchronizacja KSeF',
        (SELECT COUNT(*) FROM public.ksef_sync_log WHERE status::text='error' AND started_at > now()-interval '24 hours')::integer, 0
      UNION ALL
      SELECT 'webhooks', 'Webhooki przychodzące',
        (SELECT COUNT(*) FROM public.inbound_events WHERE status='failed' AND created_at > now()-interval '24 hours')::integer,
        (SELECT COUNT(*) FROM public.inbound_events WHERE status='received' AND created_at < now()-interval '15 minutes')::integer
      UNION ALL
      SELECT 'email_ai', 'Analiza wiadomości AI',
        (SELECT COUNT(*) FROM public.email_ai_qualifications WHERE status='failed' AND created_at > now()-interval '24 hours')::integer,
        (SELECT COUNT(*) FROM public.email_ai_qualifications WHERE status IN ('pending','processing') AND created_at < now()-interval '30 minutes')::integer
    ) services
    WHERE services.failed > 0 OR services.pending > 0
  LOOP
    alert_key_value := format('system-health:%s:%s', service_record.service_key, CURRENT_DATE);
    IF EXISTS (SELECT 1 FROM public.system_health_alert_log WHERE alert_key=alert_key_value) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications(title,message,type,category,action_url,metadata,created_at)
    VALUES (
      'Integracja wymaga uwagi',
      format('%s: błędy z ostatnich 24 h: %s, operacje zablokowane w kolejce: %s.',service_record.service_label,service_record.failed,service_record.pending),
      CASE WHEN service_record.failed > 0 THEN 'error' ELSE 'warning' END,
      'system','/crm/settings/system-health',
      jsonb_build_object('kind','system_health','service',service_record.service_key,'failed',service_record.failed,'pending',service_record.pending),now()
    ) RETURNING id INTO notification_id_value;

    FOR recipient IN
      SELECT DISTINCT auth_user.id AS user_id
      FROM public.employees employee
      JOIN auth.users auth_user ON auth_user.id=COALESCE(employee.auth_user_id,employee.id)
      WHERE employee.is_active=true AND (employee.role='admin' OR employee.access_level='admin')
    LOOP
      INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      VALUES (notification_id_value,recipient.user_id,false)
      ON CONFLICT (notification_id,user_id) DO NOTHING;
    END LOOP;

    INSERT INTO public.system_health_alert_log(alert_key,notification_id,details)
    VALUES (alert_key_value,notification_id_value,jsonb_build_object('service',service_record.service_key,'failed',service_record.failed,'pending',service_record.pending));
    sent_count := sent_count + 1;
  END LOOP;

  -- Przestój KSeF: działalność z włączonym automatem bez udanej synchronizacji od ponad 26 h (harmonogram 09:00),
  -- niezależnie od przyczyny (także odmowa wywołania, po której nic nie trafia do logu).
  alert_key_value := format('system-health:ksef_stale:%s', CURRENT_DATE);
  IF NOT EXISTS (SELECT 1 FROM public.system_health_alert_log WHERE alert_key=alert_key_value) THEN
    SELECT
      array_agg(company.id ORDER BY company.name) AS company_ids,
      string_agg(format('%s (ostatnia udana: %s%s)', company.name,
        COALESCE(to_char(credentials.auto_sync_last_success_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'), 'nigdy'),
        CASE WHEN NULLIF(btrim(credentials.auto_sync_last_error), '') IS NULL THEN ''
             ELSE '; ostatni błąd: ' || left(btrim(credentials.auto_sync_last_error), 160) END),
        ', ' ORDER BY company.name) AS summary
    INTO stale
    FROM public.ksef_credentials credentials
    JOIN public.my_companies company ON company.id = credentials.my_company_id
    WHERE credentials.is_active AND credentials.auto_sync_enabled AND company.is_active
      AND COALESCE(credentials.auto_sync_last_success_at, '-infinity'::timestamptz) < now() - interval '26 hours';

    IF stale.company_ids IS NOT NULL THEN
      INSERT INTO public.notifications(title,message,type,category,action_url,metadata,created_at)
      VALUES (
        'KSeF: brak synchronizacji faktur',
        format('Brak udanej synchronizacji z KSeF od ponad 26 godzin: %s. Faktury z tego okresu nie trafiły do CRM.', stale.summary),
        'error', 'system', '/crm/settings/system-health',
        jsonb_build_object('kind','system_health','service','ksef_stale','company_ids',to_jsonb(stale.company_ids)), now()
      ) RETURNING id INTO notification_id_value;

      FOR recipient IN
        SELECT DISTINCT auth_user.id AS user_id
        FROM public.employees employee
        JOIN auth.users auth_user ON auth_user.id = COALESCE(employee.auth_user_id, employee.id)
        WHERE employee.is_active = true
          AND EXISTS (SELECT 1 FROM unnest(stale.company_ids) company_id
                      WHERE private.employee_finance_company_level(employee.id, company_id) = 'finance_manage')
      LOOP
        INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
        VALUES (notification_id_value,recipient.user_id,false)
        ON CONFLICT (notification_id,user_id) DO NOTHING;
      END LOOP;

      INSERT INTO public.system_health_alert_log(alert_key,notification_id,details)
      VALUES (alert_key_value,notification_id_value,jsonb_build_object('service','ksef_stale','company_ids',to_jsonb(stale.company_ids)));
      sent_count := sent_count + 1;
    END IF;
  END IF;

  RETURN sent_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_crm_system_health_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_crm_system_health_alerts() TO service_role;

-- 4. Kontrola ------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'ksef_daily_worker_secret'
                   AND length(decrypted_secret) = 64) THEN
    RAISE EXCEPTION 'Brak sekretu ksef_daily_worker_secret w Vault.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'ksef_daily_project_url'
                   AND decrypted_secret LIKE 'https://%.supabase.co%') THEN
    RAISE EXCEPTION 'Brak adresu projektu ksef_daily_project_url w Vault.';
  END IF;
  IF to_regprocedure('public.invoke_daily_ksef_sync()') IS NOT NULL THEN
    RAISE EXCEPTION 'Została stara wersja public.invoke_daily_ksef_sync().';
  END IF;
  IF has_function_privilege('authenticated', 'public.invoke_daily_ksef_sync(boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.verify_ksef_daily_worker_secret(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.verify_ksef_daily_worker_secret(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Funkcje harmonogramu KSeF są dostępne z API.';
  END IF;
END $$;

COMMIT;
