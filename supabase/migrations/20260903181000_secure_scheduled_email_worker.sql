/*
  Worker zaplanowanych wiadomości korzysta z sekretu wygenerowanego i
  przechowywanego wyłącznie w Vault. Dzięki temu nie wymaga ręcznego
  synchronizowania sekretu między bazą a Edge Functions.
*/

DO $scheduled_email_worker_secret$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault is required for the scheduled email worker';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'scheduled_email_worker_secret'
  ) THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'scheduled_email_worker_secret',
      'Internal authentication secret for the scheduled email worker'
    );
  END IF;
END;
$scheduled_email_worker_secret$;

CREATE OR REPLACE FUNCTION public.verify_scheduled_email_worker_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(p_secret, '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'scheduled_email_worker_secret'
        AND decrypted_secret = p_secret
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.verify_scheduled_email_worker_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_scheduled_email_worker_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_scheduled_email_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  project_url text := 'https://fuuljhhuhfojtmmfmskq.supabase.co';
  worker_secret text;
  request_id bigint;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
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

  IF NULLIF(worker_secret, '') IS NULL THEN
    RAISE WARNING 'Scheduled email worker skipped: missing scheduled_email_worker_secret in Vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/process-scheduled-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
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

COMMENT ON FUNCTION public.verify_scheduled_email_worker_secret(text) IS
  'Validates the internal scheduled-email worker secret stored in Vault.';
