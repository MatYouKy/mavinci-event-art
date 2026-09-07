/*
  Trwała kolejka pojedynczych wiadomości CRM.

  Wiadomości są zamrażane w chwili planowania. Worker uruchamiany co minutę
  pobiera wyłącznie należne rekordy i ponawia przejściowe błędy maksymalnie 3 razy.
*/

CREATE TABLE IF NOT EXISTS public.scheduled_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  email_account_id uuid REFERENCES public.employee_email_accounts(id) ON DELETE SET NULL,
  function_name text NOT NULL CHECK (
    function_name IN ('send-email', 'send-offer-email', 'send-invoice-email')
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'processing', 'retry', 'sent', 'failed', 'cancelled')
  ),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due
  ON public.scheduled_emails(status, scheduled_at, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_created_by
  ON public.scheduled_emails(created_by, created_at DESC);

ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_emails_read_own ON public.scheduled_emails;
CREATE POLICY scheduled_emails_read_own
  ON public.scheduled_emails FOR SELECT TO authenticated
  USING (created_by = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.scheduled_emails FROM anon, authenticated;
GRANT SELECT ON public.scheduled_emails TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_due_scheduled_emails(p_limit integer DEFAULT 5)
RETURNS SETOF public.scheduled_emails
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scheduled_emails
  SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'retry' END,
      next_attempt_at = CASE WHEN attempt_count < 3 THEN now() ELSE NULL END,
      claimed_at = NULL,
      last_error = COALESCE(last_error, 'Przerwane przetwarzanie — automatyczne odzyskanie'),
      updated_at = now()
  WHERE status = 'processing'
    AND claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH due AS (
    SELECT email.id
    FROM public.scheduled_emails email
    WHERE email.status IN ('scheduled', 'retry')
      AND email.scheduled_at <= now()
      AND COALESCE(email.next_attempt_at, email.scheduled_at) <= now()
    ORDER BY email.scheduled_at, email.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 10)
  )
  UPDATE public.scheduled_emails email
  SET status = 'processing',
      attempt_count = email.attempt_count + 1,
      claimed_at = now(),
      updated_at = now()
  FROM due
  WHERE email.id = due.id
  RETURNING email.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_email(p_email_id uuid)
RETURNS public.scheduled_emails
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result public.scheduled_emails%ROWTYPE;
BEGIN
  UPDATE public.scheduled_emails
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = p_email_id
    AND created_by = auth.uid()
    AND status IN ('scheduled', 'retry')
  RETURNING * INTO result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wiadomości nie można już anulować';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_emails(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_emails(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_email(uuid) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_scheduled_email_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  project_url text := 'https://fuuljhhuhfojtmmfmskq.supabase.co';
  anon_key text;
  worker_secret text;
  request_id bigint;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name IN ('supabase_anon_key', 'anon_key')
      ORDER BY CASE name WHEN 'supabase_anon_key' THEN 0 ELSE 1 END LIMIT 1
    $query$ INTO anon_key;
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'scheduled_email_worker_secret' LIMIT 1
    $query$ INTO worker_secret;
    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name IN ('supabase_url', 'project_url')
         ORDER BY CASE name WHEN 'supabase_url' THEN 0 ELSE 1 END LIMIT 1), $1
      )
    $query$ INTO project_url USING project_url;
  END IF;

  IF NULLIF(anon_key, '') IS NULL OR NULLIF(worker_secret, '') IS NULL THEN
    RAISE WARNING 'Scheduled email worker skipped: add supabase_anon_key and scheduled_email_worker_secret to Vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/process-scheduled-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'apikey', anon_key,
      'X-Scheduled-Email-Worker-Secret', worker_secret
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 120000
  ) INTO request_id;
  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_scheduled_email_worker()
  FROM PUBLIC, anon, authenticated;

DO $schedule_email_worker$
DECLARE job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; scheduled email worker was not scheduled: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'process-scheduled-emails'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'process-scheduled-emails', '* * * * *',
        'SELECT public.invoke_scheduled_email_worker();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule scheduled email worker: %', SQLERRM;
END;
$schedule_email_worker$;

COMMENT ON TABLE public.scheduled_emails IS
  'Persistent queue for one-to-one CRM emails scheduled by employees.';
