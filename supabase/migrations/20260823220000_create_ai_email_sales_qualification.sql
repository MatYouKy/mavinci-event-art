/*
  # AI qualification of incoming sales emails

  Incoming messages for biuro@mavinci.pl are queued for server-side AI
  qualification. Conversations, contacts and inquiries are linked without
  exposing the AI provider key to the browser.
*/

CREATE TABLE IF NOT EXISTS public.email_sales_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id uuid NOT NULL REFERENCES public.employee_email_accounts(id) ON DELETE CASCADE,
  participant_email text NOT NULL,
  participant_name text,
  normalized_subject text NOT NULL DEFAULT '',
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'qualified', 'won', 'lost', 'market_research', 'non_sales', 'archived')),
  is_market_research boolean NOT NULL DEFAULT false,
  outcome_reason text,
  ai_summary text,
  first_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_sales_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.email_sales_conversations(id) ON DELETE CASCADE,
  received_email_id uuid REFERENCES public.received_emails(id) ON DELETE CASCADE,
  sent_email_id uuid REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_id text,
  message_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_sales_message_single_source CHECK (
    (received_email_id IS NOT NULL AND sent_email_id IS NULL AND direction = 'incoming')
    OR (received_email_id IS NULL AND sent_email_id IS NOT NULL AND direction = 'outgoing')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sales_messages_received
  ON public.email_sales_conversation_messages(received_email_id)
  WHERE received_email_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sales_messages_sent
  ON public.email_sales_conversation_messages(sent_email_id)
  WHERE sent_email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_sales_conversations_participant
  ON public.email_sales_conversations(email_account_id, lower(participant_email), last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_sales_conversation_messages_timeline
  ON public.email_sales_conversation_messages(conversation_id, message_at DESC);

CREATE TABLE IF NOT EXISTS public.email_ai_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_email_id uuid NOT NULL UNIQUE REFERENCES public.received_emails(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.email_sales_conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'classified', 'skipped_continuation', 'manual_review', 'failed')),
  intent text CHECK (intent IS NULL OR intent IN (
    'event_inquiry', 'market_research', 'vendor', 'job_application', 'invoice', 'spam', 'other'
  )),
  is_new_thread boolean,
  is_sales_opportunity boolean,
  confidence numeric(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  summary text,
  reasoning text,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  prompt_version text NOT NULL DEFAULT 'email-sales-v1',
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_ai_qualifications_queue
  ON public.email_ai_qualifications(status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_ai_email_inquiry
  ON public.tasks ((inquiry_details ->> 'received_email_id'))
  WHERE is_inquiry = true
    AND inquiry_details ->> 'source_kind' = 'email_ai'
    AND inquiry_details ? 'received_email_id';

CREATE OR REPLACE FUNCTION public.normalize_email_sales_subject(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(COALESCE(value, '')), '^((re|fw|fwd|odp|pd|przek)\s*:\s*)+', '', 'i'));
$$;

CREATE OR REPLACE FUNCTION public.extract_email_address(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(COALESCE(
    (regexp_match(COALESCE(value, ''), '<([^>]+)>'))[1],
    (regexp_match(COALESCE(value, ''), '([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})', 'i'))[1],
    btrim(COALESCE(value, ''))
  ));
$$;

CREATE OR REPLACE FUNCTION public.enqueue_received_email_for_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.employee_email_accounts account
    WHERE account.id = NEW.email_account_id
      AND (
        lower(account.email_address) = 'biuro@mavinci.pl'
        OR lower(COALESCE(account.imap_username, '')) = 'biuro@mavinci.pl'
      )
  ) THEN
    INSERT INTO public.email_ai_qualifications(received_email_id)
    VALUES (NEW.id)
    ON CONFLICT (received_email_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enqueue_received_email_for_ai ON public.received_emails;
CREATE TRIGGER trigger_enqueue_received_email_for_ai
  AFTER INSERT ON public.received_emails
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_received_email_for_ai();

CREATE OR REPLACE FUNCTION public.claim_email_ai_qualification(batch_size integer DEFAULT 10)
RETURNS SETOF public.email_ai_qualifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT qualification.id
    FROM public.email_ai_qualifications qualification
    WHERE qualification.status = 'pending'
       OR (
         qualification.status = 'processing'
         AND qualification.claimed_at < now() - interval '10 minutes'
       )
    ORDER BY qualification.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(batch_size, 1), 25)
  )
  UPDATE public.email_ai_qualifications qualification
  SET status = 'processing',
      claimed_at = now(),
      attempt_count = qualification.attempt_count + 1,
      last_error = NULL,
      updated_at = now()
  FROM candidates
  WHERE qualification.id = candidates.id
  RETURNING qualification.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_ai_qualification(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_email_ai_qualification(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.link_sent_email_to_sales_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  SELECT conversation.id
  INTO v_conversation_id
  FROM public.email_sales_conversations conversation
  WHERE conversation.email_account_id = NEW.email_account_id
    AND lower(conversation.participant_email) = public.extract_email_address(NEW.to_address)
    AND conversation.normalized_subject = public.normalize_email_sales_subject(NEW.subject)
    AND conversation.last_message_at >= COALESCE(NEW.sent_at, now()) - interval '365 days'
  ORDER BY conversation.last_message_at DESC
  LIMIT 1;

  IF v_conversation_id IS NOT NULL THEN
    INSERT INTO public.email_sales_conversation_messages(
      conversation_id, sent_email_id, direction, message_id, message_at
    ) VALUES (
      v_conversation_id, NEW.id, 'outgoing', NEW.message_id, COALESCE(NEW.sent_at, now())
    ) ON CONFLICT (sent_email_id) WHERE sent_email_id IS NOT NULL DO NOTHING;

    UPDATE public.email_sales_conversations
    SET last_message_at = GREATEST(last_message_at, COALESCE(NEW.sent_at, now())),
        updated_at = now()
    WHERE id = v_conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_link_sent_email_to_sales_conversation ON public.sent_emails;
CREATE TRIGGER trigger_link_sent_email_to_sales_conversation
  AFTER INSERT ON public.sent_emails
  FOR EACH ROW
  EXECUTE FUNCTION public.link_sent_email_to_sales_conversation();

CREATE OR REPLACE FUNCTION public.sync_inquiry_outcome_to_email_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  UPDATE public.email_sales_conversations
  SET status = CASE NEW.inquiry_stage
        WHEN 'won' THEN 'won'
        WHEN 'lost' THEN 'lost'
        ELSE status
      END,
      outcome_reason = CASE
        WHEN NEW.inquiry_stage = 'lost' THEN NEW.lost_reason
        WHEN NEW.inquiry_stage = 'won' THEN NULL
        ELSE outcome_reason
      END,
      updated_at = now()
  WHERE inquiry_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_inquiry_outcome_to_email_conversation ON public.tasks;
CREATE TRIGGER trigger_sync_inquiry_outcome_to_email_conversation
  AFTER UPDATE OF inquiry_stage, lost_reason ON public.tasks
  FOR EACH ROW
  WHEN (
    NEW.is_inquiry = true
    AND (
      NEW.inquiry_stage IS DISTINCT FROM OLD.inquiry_stage
      OR NEW.lost_reason IS DISTINCT FROM OLD.lost_reason
    )
  )
  EXECUTE FUNCTION public.sync_inquiry_outcome_to_email_conversation();

CREATE OR REPLACE FUNCTION public.can_view_email_sales_context(account_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = auth.uid()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'messages_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'messages_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR EXISTS (
          SELECT 1 FROM public.employee_email_accounts account
          WHERE account.id = account_id AND account.employee_id = employee.id
        )
        OR EXISTS (
          SELECT 1 FROM public.employee_email_account_assignments assignment
          WHERE assignment.email_account_id = account_id
            AND assignment.employee_id = employee.id
        )
      )
  );
$$;

ALTER TABLE public.email_sales_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sales_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_ai_qualifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_sales_conversations_select ON public.email_sales_conversations;
CREATE POLICY email_sales_conversations_select
  ON public.email_sales_conversations FOR SELECT TO authenticated
  USING (public.can_view_email_sales_context(email_account_id));

DROP POLICY IF EXISTS email_sales_conversation_messages_select ON public.email_sales_conversation_messages;
CREATE POLICY email_sales_conversation_messages_select
  ON public.email_sales_conversation_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_sales_conversations conversation
      WHERE conversation.id = email_sales_conversation_messages.conversation_id
        AND public.can_view_email_sales_context(conversation.email_account_id)
    )
  );

DROP POLICY IF EXISTS email_ai_qualifications_select ON public.email_ai_qualifications;
CREATE POLICY email_ai_qualifications_select
  ON public.email_ai_qualifications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.received_emails email
      WHERE email.id = email_ai_qualifications.received_email_id
        AND public.can_view_email_sales_context(email.email_account_id)
    )
  );

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_ai_email_qualification()
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
    $query$ INTO v_anon_key;

    EXECUTE $query$
      SELECT COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name IN ('supabase_url', 'project_url')
         ORDER BY CASE name WHEN 'supabase_url' THEN 0 ELSE 1 END LIMIT 1),
        $1
      )
    $query$ INTO v_project_url USING v_project_url;
  END IF;

  IF NULLIF(v_anon_key, '') IS NULL THEN
    RAISE WARNING 'AI email qualification skipped: add supabase_anon_key to Vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/qualify-incoming-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key,
      'apikey', v_anon_key
    ),
    body := jsonb_build_object('batchSize', 10),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_ai_email_qualification() FROM PUBLIC;

DO $schedule_ai_email_qualification$
DECLARE
  v_job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; AI email qualification was not scheduled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR v_job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'qualify-incoming-sales-emails'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING v_job_id;
    END LOOP;

    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING
        'qualify-incoming-sales-emails',
        '* * * * *',
        'SELECT public.invoke_ai_email_qualification();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule AI email qualification: %', SQLERRM;
END;
$schedule_ai_email_qualification$;

COMMENT ON TABLE public.email_sales_conversations IS
  'Single source of truth linking customers, email correspondence and sales inquiries.';
COMMENT ON TABLE public.email_ai_qualifications IS
  'Server-side AI classification queue and auditable result for incoming email.';
