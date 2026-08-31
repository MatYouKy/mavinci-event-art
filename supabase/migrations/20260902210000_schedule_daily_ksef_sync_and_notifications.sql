/*
  Daily KSeF synchronization and notifications for newly received invoices.
  The worker is invoked inside the same Supabase project and authenticates with
  the project's service role JWT. No KSeF credential is sent to the scheduler.
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.ksef_invoice_notification_events (
  ksef_invoice_id uuid PRIMARY KEY
    REFERENCES public.ksef_invoices(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL UNIQUE
    REFERENCES public.notifications(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ksef_invoice_notification_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notify_new_received_ksef_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_id uuid;
  v_seller text;
  v_invoice_number text;
  v_amount text;
  v_currency text;
  v_payment_label text;
  v_notification_type text;
BEGIN
  IF NEW.invoice_type::text <> 'received' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ksef_invoice_notification_events event
    WHERE event.ksef_invoice_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  v_seller := COALESCE(NULLIF(BTRIM(NEW.seller_name), ''), 'nieznanego sprzedawcy');
  v_invoice_number := COALESCE(
    NULLIF(BTRIM(NEW.invoice_number), ''),
    NULLIF(BTRIM(NEW.ksef_reference_number), ''),
    'bez numeru'
  );
  v_currency := UPPER(COALESCE(NULLIF(BTRIM(NEW.currency), ''), 'PLN'));
  v_amount := replace(
    to_char(ABS(COALESCE(NEW.amount_to_pay_gross, NEW.gross_amount, 0)), 'FM999999999999990D00'),
    '.',
    ','
  );
  v_payment_label := CASE COALESCE(NEW.payment_status, 'unpaid')
    WHEN 'paid' THEN 'opłacona'
    WHEN 'partially_paid' THEN 'częściowo opłacona'
    WHEN 'overdue' THEN 'po terminie — do opłacenia'
    ELSE 'do opłacenia'
  END;
  v_notification_type := CASE COALESCE(NEW.payment_status, 'unpaid')
    WHEN 'paid' THEN 'success'
    WHEN 'overdue' THEN 'warning'
    ELSE 'info'
  END;

  INSERT INTO public.notifications (
    title, message, type, category, action_url, metadata, created_at
  )
  VALUES (
    'Nowa faktura z KSeF',
    format(
      'Faktura %s od %s na %s %s — %s.',
      v_invoice_number, v_seller, v_amount, v_currency, v_payment_label
    ),
    v_notification_type,
    'system',
    '/crm/invoices?tab=ksef',
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'ksef_invoice_received',
      'ksef_invoice_id', NEW.id,
      'ksef_reference_number', NEW.ksef_reference_number,
      'invoice_number', NEW.invoice_number,
      'my_company_id', NEW.my_company_id,
      'seller_name', NEW.seller_name,
      'gross_amount', COALESCE(NEW.amount_to_pay_gross, NEW.gross_amount),
      'currency', v_currency,
      'payment_status', NEW.payment_status,
      'payment_due_date', NEW.payment_due_date
    )),
    now()
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.ksef_invoice_notification_events (ksef_invoice_id, notification_id)
  VALUES (NEW.id, v_notification_id)
  ON CONFLICT (ksef_invoice_id) DO NOTHING;

  INSERT INTO public.notification_recipients (
    notification_id, user_id, is_read, created_at
  )
  SELECT v_notification_id, auth_user.id, false, now()
  FROM public.employees employee
  JOIN auth.users auth_user
    ON auth_user.id = COALESCE(employee.auth_user_id, employee.id)
  WHERE COALESCE(employee.is_active, true)
    AND (
      employee.role::text = 'admin'
      OR employee.access_level::text = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'invoices_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'invoices_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
    )
    AND (
      employee.role::text = 'admin'
      OR employee.access_level::text = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR (
        (
          cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
          OR NEW.my_company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
        )
        AND (
          COALESCE(employee.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
          OR COALESCE(
            employee.invoice_company_permissions -> NEW.my_company_id::text,
            '[]'::jsonb
          ) ?| ARRAY['view', 'view_own', 'view_all', 'issue', 'manage']
        )
      )
    )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_new_received_ksef_invoice_after_insert
  ON public.ksef_invoices;
CREATE TRIGGER notify_new_received_ksef_invoice_after_insert
  AFTER INSERT ON public.ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_received_ksef_invoice();

REVOKE ALL ON FUNCTION public.notify_new_received_ksef_invoice() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.invoke_daily_ksef_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_project_url text := NULLIF(current_setting('app.settings.supabase_url', true), '');
  v_service_role_key text := NULLIF(current_setting('app.settings.service_role_key', true), '');
  v_request_id bigint;
BEGIN
  -- pg_cron uses UTC. The job runs at both possible UTC offsets and this guard
  -- selects exactly 09:30 in Europe/Warsaw across daylight-saving changes.
  IF to_char(now() AT TIME ZONE 'Europe/Warsaw', 'HH24:MI') <> '09:30' THEN
    RETURN NULL;
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret
         FROM vault.decrypted_secrets
         WHERE name IN ('supabase_url', 'project_url')
         ORDER BY CASE name WHEN 'supabase_url' THEN 0 ELSE 1 END
         LIMIT 1),
        $1
      )
    $query$ INTO v_project_url USING v_project_url;

    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret
         FROM vault.decrypted_secrets
         WHERE name IN ('supabase_service_role_key', 'service_role_key')
         ORDER BY CASE name WHEN 'supabase_service_role_key' THEN 0 ELSE 1 END
         LIMIT 1),
        $1
      )
    $query$ INTO v_service_role_key USING v_service_role_key;
  END IF;

  IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_service_role_key, '') IS NULL THEN
    RAISE WARNING 'KSeF sync skipped: Supabase project URL or service role key is unavailable.';
    RETURN NULL;
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

DO $schedule_daily_ksef_sync$
DECLARE
  v_job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron unavailable; KSeF sync was not scheduled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR v_job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'daily-ksef-sync-0930-warsaw'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING v_job_id;
    END LOOP;

    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING
        'daily-ksef-sync-0930-warsaw',
        '30 7,8 * * *',
        'SELECT public.invoke_daily_ksef_sync();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule KSeF sync: %', SQLERRM;
END;
$schedule_daily_ksef_sync$;

COMMENT ON FUNCTION public.invoke_daily_ksef_sync() IS
  'Invokes the internal KSeF worker every day at 09:30 Europe/Warsaw.';
