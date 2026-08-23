/*
  # Reliable tender monitoring

  Adds a configurable score threshold for new-tender notifications and invokes
  the fetch-tenders Edge Function every six hours. The scheduled request uses
  the project's anon key stored in Supabase Vault, so no credential is embedded
  in the migration.
*/

ALTER TABLE public.tender_filter_config
  ADD COLUMN IF NOT EXISTS notification_score_threshold integer NOT NULL DEFAULT 70
  CHECK (notification_score_threshold BETWEEN 0 AND 100);

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_scheduled_tender_scan()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_project_url text := 'https://fuuljhhuhfojtmmfmskq.supabase.co';
  v_anon_key text;
  v_request_id bigint;
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
  END IF;

  IF NULLIF(v_anon_key, '') IS NULL THEN
    RAISE WARNING
      'Tender scan skipped: add the Supabase anon key to Vault as supabase_anon_key';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/fetch-tenders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_scheduled_tender_scan() FROM PUBLIC;

DO $schedule_tender_scan$
DECLARE
  v_job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; tender scan was not scheduled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR v_job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'scan-new-tenders'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING v_job_id;
    END LOOP;

    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING
        'scan-new-tenders',
        '17 */6 * * *',
        'SELECT public.invoke_scheduled_tender_scan();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule tender scan: %', SQLERRM;
END;
$schedule_tender_scan$;

COMMENT ON COLUMN public.tender_filter_config.notification_score_threshold IS
  'Minimum relevance score required to notify tender viewers about a new tender.';
COMMENT ON FUNCTION public.invoke_scheduled_tender_scan() IS
  'Invokes fetch-tenders through pg_net; scheduled every six hours by pg_cron.';
