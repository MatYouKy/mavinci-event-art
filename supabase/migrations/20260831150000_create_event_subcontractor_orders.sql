-- Additive foundation for event subcontractor orders.
-- Existing contacts, organizations, tasks and costs remain unchanged.

CREATE TABLE IF NOT EXISTS public.organization_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer', 'supplier', 'venue', 'partner')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role)
);

ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subcontractors
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_registered_business boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_settlement_type text NOT NULL DEFAULT 'invoice_vat',
  ADD COLUMN IF NOT EXISTS preferred_payment_method text NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PLN',
  ADD COLUMN IF NOT EXISTS requires_contract boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.subcontractors ADD CONSTRAINT subcontractors_entity_type_check
    CHECK (entity_type IN ('company', 'individual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.subcontractors ADD CONSTRAINT subcontractors_settlement_type_check
    CHECK (default_settlement_type IN ('invoice_vat', 'invoice_no_vat', 'cash', 'civil_contract', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.subcontractors ADD CONSTRAINT subcontractors_payment_method_check
    CHECK (preferred_payment_method IN ('transfer', 'cash', 'card', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_subcontractors_organization ON public.subcontractors(organization_id);
CREATE INDEX IF NOT EXISTS idx_subcontractors_contact ON public.subcontractors(contact_id);

ALTER TABLE public.subcontractor_tasks
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end timestamptz,
  ADD COLUMN IF NOT EXISTS scope_of_work text,
  ADD COLUMN IF NOT EXISTS deliverables text,
  ADD COLUMN IF NOT EXISTS guidelines text,
  ADD COLUMN IF NOT EXISTS operational_notes text,
  ADD COLUMN IF NOT EXISTS settlement_type text NOT NULL DEFAULT 'invoice_vat',
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PLN',
  ADD COLUMN IF NOT EXISTS agreed_cost numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_name_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_email_snapshot text,
  ADD COLUMN IF NOT EXISTS contact_phone_snapshot text,
  ADD COLUMN IF NOT EXISTS guidelines_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS confirmation_token_hash text,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS guidelines_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by_name text,
  ADD COLUMN IF NOT EXISTS response_note text,
  ADD COLUMN IF NOT EXISTS reminder_week_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.subcontractor_tasks ADD CONSTRAINT subcontractor_tasks_guidelines_status_check
    CHECK (guidelines_status IN ('draft', 'sent', 'confirmed', 'declined', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.subcontractor_tasks ADD CONSTRAINT subcontractor_tasks_settlement_type_check
    CHECK (settlement_type IN ('invoice_vat', 'invoice_no_vat', 'cash', 'civil_contract', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.subcontractor_tasks ADD CONSTRAINT subcontractor_tasks_payment_method_check
    CHECK (payment_method IN ('transfer', 'cash', 'card', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.subcontractor_tasks ADD CONSTRAINT subcontractor_tasks_schedule_check
    CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subcontractor_tasks_confirmation_token
  ON public.subcontractor_tasks(confirmation_token_hash)
  WHERE confirmation_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_reminders
  ON public.subcontractor_tasks(guidelines_status, scheduled_start)
  WHERE guidelines_status = 'confirmed' AND status <> 'cancelled';

ALTER TABLE public.subcontractor_contracts
  ADD COLUMN IF NOT EXISTS subcontractor_task_id uuid REFERENCES public.subcontractor_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_task
  ON public.subcontractor_contracts(subcontractor_task_id);

COMMENT ON TABLE public.organization_roles IS
  'Non-exclusive business roles. An organization may be both customer and supplier.';
COMMENT ON TABLE public.subcontractor_tasks IS
  'Event subcontractor order: scope, schedule, settlement, confirmation and reminders.';

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_subcontractor_reminder_worker()
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
      WHERE name = 'subcontractor_reminder_secret' LIMIT 1
    $query$ INTO worker_secret;
  END IF;

  IF NULLIF(anon_key, '') IS NULL OR NULLIF(worker_secret, '') IS NULL THEN
    RAISE WARNING 'Subcontractor reminders skipped: add supabase_anon_key and subcontractor_reminder_secret to Vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/process-subcontractor-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key,
      'apikey', anon_key, 'X-Subcontractor-Reminder-Secret', worker_secret
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 120000
  ) INTO request_id;
  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_subcontractor_reminder_worker() FROM PUBLIC, anon, authenticated;

DO $schedule$
DECLARE job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; subcontractor reminders were not scheduled: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'process-subcontractor-reminders'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'process-subcontractor-reminders', '15 * * * *',
        'SELECT public.invoke_subcontractor_reminder_worker();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule subcontractor reminders: %', SQLERRM;
END;
$schedule$;
