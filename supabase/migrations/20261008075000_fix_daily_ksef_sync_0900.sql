BEGIN;

-- Automatic imports are an explicit choice per company, separate from manual
-- KSeF access and from the company's historical CRM records.
ALTER TABLE public.ksef_credentials
  ADD COLUMN IF NOT EXISTS auto_sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_sync_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_sync_last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_sync_last_error text;

ALTER TABLE public.ksef_sync_log
  ADD COLUMN IF NOT EXISTS my_company_id uuid
    REFERENCES public.my_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ksef_sync_log_company_started_idx
  ON public.ksef_sync_log (my_company_id, started_at DESC);

-- User-selected companies: Mavinci and Nastrojowo. Event Rulers retains all
-- historical records and manual settings, but is not an automatic import target.
UPDATE public.ksef_credentials
SET auto_sync_enabled = true, updated_at = now()
WHERE my_company_id IN (
  'd4474f90-5e61-4ba4-928e-c25c0f0659b5'::uuid,
  '0547d91a-42cf-41fa-ad5e-457d9d1c203f'::uuid
);

UPDATE public.ksef_credentials
SET auto_sync_enabled = false, updated_at = now()
WHERE my_company_id = '587a3901-850a-4e0c-baa7-93ec984dc6a5'::uuid;

COMMENT ON COLUMN public.ksef_credentials.auto_sync_enabled IS
  'Opt-in for automatic invoice import at 09:00 Europe/Warsaw; not permission to issue or send invoices.';

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.invoke_daily_ksef_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
BEGIN
  -- pg_cron is UTC: only one of the two candidate times is 09:00 in Warsaw.
  IF to_char(now() AT TIME ZONE 'Europe/Warsaw', 'HH24:MI') <> '09:00' THEN
    RETURN NULL;
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'ksef_daily_project_url' LIMIT 1
    $query$ INTO v_project_url;
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'ksef_daily_service_role_key' LIMIT 1
    $query$ INTO v_service_role_key;
  END IF;

  -- Do not report a successful cron run that silently skipped the HTTP request.
  IF NULLIF(btrim(v_project_url), '') IS NULL
    OR NULLIF(btrim(v_service_role_key), '') IS NULL THEN
    RAISE EXCEPTION 'KSeF: missing scheduler configuration in Vault (ksef_daily_project_url / ksef_daily_service_role_key).';
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/sync-ksef-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key,
      'apikey', v_service_role_key
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 300000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_daily_ksef_sync() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.invoke_daily_ksef_sync() IS
  'Daily KSeF invoice import at 09:00 Europe/Warsaw (DST-aware); credentials held only in Supabase Vault.';

DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('daily-ksef-sync-0930-warsaw', 'daily-ksef-sync-0900-warsaw')
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'daily-ksef-sync-0900-warsaw',
    '0 7,8 * * *',
    'SELECT public.invoke_daily_ksef_sync();'
  );
END;
$schedule$;

COMMIT;
