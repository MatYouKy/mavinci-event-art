/*
  # Produkcyjny silnik kampanii

  Kampania jest wysyłana małymi partiami dopiero po zatwierdzeniu. Worker
  ponownie sprawdza zgodę i listę wykluczeń bezpośrednio przed wysyłką.
*/

ALTER TABLE public.mailing_campaigns
  ADD COLUMN IF NOT EXISTS batch_size integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS send_interval_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_batch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_opens boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS track_clicks boolean NOT NULL DEFAULT false;

ALTER TABLE public.mailing_campaigns DROP CONSTRAINT IF EXISTS mailing_campaigns_batch_size_check;
ALTER TABLE public.mailing_campaigns ADD CONSTRAINT mailing_campaigns_batch_size_check
  CHECK (batch_size BETWEEN 1 AND 20);
ALTER TABLE public.mailing_campaigns DROP CONSTRAINT IF EXISTS mailing_campaigns_send_interval_check;
ALTER TABLE public.mailing_campaigns ADD CONSTRAINT mailing_campaigns_send_interval_check
  CHECK (send_interval_seconds BETWEEN 30 AND 3600);

ALTER TABLE public.mailing_recipients
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

ALTER TABLE public.mailing_recipients DROP CONSTRAINT IF EXISTS mailing_recipients_status_check;
ALTER TABLE public.mailing_recipients ADD CONSTRAINT mailing_recipients_status_check CHECK (
  status IN (
    'pending', 'eligible', 'excluded', 'queued', 'processing', 'retry',
    'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced',
    'failed', 'unsubscribed'
  )
);

CREATE INDEX IF NOT EXISTS idx_mailing_recipients_delivery_queue
  ON public.mailing_recipients(campaign_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_mailing_campaigns_delivery_queue
  ON public.mailing_campaigns(status, scheduled_at, next_batch_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailing_recipients_unsubscribe_token
  ON public.mailing_recipients(unsubscribe_token);

ALTER TABLE public.mailing_campaign_approval_log
  DROP CONSTRAINT IF EXISTS mailing_campaign_approval_log_action_check;
ALTER TABLE public.mailing_campaign_approval_log
  ADD CONSTRAINT mailing_campaign_approval_log_action_check CHECK (
    action IN (
      'created', 'audience_refreshed', 'test_sent', 'submitted', 'approved',
      'rejected', 'scheduled', 'started', 'paused', 'resumed', 'completed',
      'cancelled'
    )
  );

CREATE OR REPLACE FUNCTION public.prepare_mailing_campaign_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE transition text := COALESCE(current_setting('app.mailing_campaign_transition', true), '');
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(public.current_marketing_employee_id(), NEW.updated_by);

  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Nowa kampania musi być wersją roboczą';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'pending_approval' AND transition = 'submit')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'approved' AND transition = 'approve')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'draft' AND transition = 'refresh')
      OR (OLD.status = 'approved' AND NEW.status = 'scheduled' AND transition = 'schedule')
      OR (OLD.status = 'scheduled' AND NEW.status = 'sending' AND transition = 'worker')
      OR (OLD.status = 'sending' AND NEW.status IN ('sent', 'failed') AND transition = 'worker')
      OR (OLD.status IN ('scheduled', 'sending') AND NEW.status = 'paused' AND transition = 'pause')
      OR (OLD.status = 'paused' AND NEW.status = 'scheduled' AND transition = 'resume')
      OR (OLD.status IN ('approved', 'scheduled', 'sending', 'paused') AND NEW.status = 'cancelled' AND transition = 'cancel')
    ) THEN
      RAISE EXCEPTION 'Niedozwolona zmiana statusu kampanii';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'scheduled', 'sending', 'paused', 'sent') AND (
    NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.preview_text IS DISTINCT FROM OLD.preview_text
    OR NEW.segment_ids IS DISTINCT FROM OLD.segment_ids
    OR NEW.audience_rules IS DISTINCT FROM OLD.audience_rules
    OR NEW.email_account_id IS DISTINCT FROM OLD.email_account_id
    OR NEW.track_opens IS DISTINCT FROM OLD.track_opens
    OR NEW.track_clicks IS DISTINCT FROM OLD.track_clicks
  ) THEN
    RAISE EXCEPTION 'Zatwierdzonej lub wysłanej kampanii nie można zmieniać';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND (
    NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.preview_text IS DISTINCT FROM OLD.preview_text
    OR NEW.segment_ids IS DISTINCT FROM OLD.segment_ids
    OR NEW.audience_rules IS DISTINCT FROM OLD.audience_rules
    OR NEW.email_account_id IS DISTINCT FROM OLD.email_account_id
    OR NEW.track_opens IS DISTINCT FROM OLD.track_opens
    OR NEW.track_clicks IS DISTINCT FROM OLD.track_clicks
  ) THEN
    NEW.test_sent_at := NULL;
    NEW.test_sent_to := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND (
    NEW.segment_ids IS DISTINCT FROM OLD.segment_ids
    OR NEW.audience_rules IS DISTINCT FROM OLD.audience_rules
  ) THEN
    NEW.eligible_count := 0;
    NEW.excluded_count := 0;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_mailing_campaign(
  p_campaign_id uuid,
  p_scheduled_at timestamptz DEFAULT now(),
  p_batch_size integer DEFAULT 10,
  p_send_interval_seconds integer DEFAULT 60
)
RETURNS public.mailing_campaigns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result public.mailing_campaigns%ROWTYPE;
  queued_total integer;
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  IF p_batch_size NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Partia musi zawierać od 1 do 20 wiadomości'; END IF;
  IF p_send_interval_seconds NOT BETWEEN 30 AND 3600 THEN RAISE EXCEPTION 'Odstęp musi wynosić od 30 do 3600 sekund'; END IF;

  SELECT * INTO result FROM public.mailing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR result.status <> 'approved' THEN RAISE EXCEPTION 'Kampania nie jest zatwierdzona'; END IF;
  IF result.approved_at IS NULL OR result.test_sent_at IS NULL THEN RAISE EXCEPTION 'Brak zatwierdzenia lub testu kampanii'; END IF;

  -- Ostatnia kontrola zgód przed zamrożeniem kolejki.
  UPDATE public.mailing_recipients recipient
  SET status = 'excluded', exclusion_reason = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.marketing_suppression_list suppression
        WHERE lower(btrim(suppression.email)) = lower(btrim(recipient.email))
          AND suppression.revoked_at IS NULL
      ) THEN 'suppression_list'
      ELSE 'consent_changed'
    END,
    updated_at = now()
  WHERE recipient.campaign_id = p_campaign_id
    AND recipient.status = 'eligible'
    AND (
      EXISTS (
        SELECT 1 FROM public.marketing_suppression_list suppression
        WHERE lower(btrim(suppression.email)) = lower(btrim(recipient.email))
          AND suppression.revoked_at IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.customer_marketing_profiles profile
        WHERE profile.id = recipient.profile_id
          AND profile.marketing_status = 'subscribed'
          AND profile.legal_basis <> 'none'
          AND profile.email_deliverability NOT IN ('bounced', 'invalid')
      )
    );

  UPDATE public.mailing_recipients
  SET status = 'queued', queued_at = now(), next_attempt_at = now(),
      claimed_at = NULL, error_message = NULL, updated_at = now()
  WHERE campaign_id = p_campaign_id AND status = 'eligible';
  GET DIAGNOSTICS queued_total = ROW_COUNT;
  IF queued_total = 0 THEN RAISE EXCEPTION 'Brak odbiorców dopuszczonych do wysyłki'; END IF;

  PERFORM set_config('app.mailing_campaign_transition', 'schedule', true);
  UPDATE public.mailing_campaigns
  SET status = 'scheduled', scheduled_at = GREATEST(COALESCE(p_scheduled_at, now()), now()),
      batch_size = p_batch_size, send_interval_seconds = p_send_interval_seconds,
      next_batch_at = GREATEST(COALESCE(p_scheduled_at, now()), now()),
      paused_at = NULL, cancelled_at = NULL,
      eligible_count = queued_total,
      excluded_count = (SELECT count(*) FROM public.mailing_recipients WHERE campaign_id = p_campaign_id AND status = 'excluded')
  WHERE id = p_campaign_id RETURNING * INTO result;

  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action, metadata)
  VALUES (p_campaign_id, 'scheduled', jsonb_build_object(
    'scheduled_at', result.scheduled_at, 'batch_size', p_batch_size,
    'send_interval_seconds', p_send_interval_seconds, 'recipients', queued_total
  ));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_mailing_campaign(p_campaign_id uuid)
RETURNS public.mailing_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.mailing_campaigns%ROWTYPE;
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  PERFORM set_config('app.mailing_campaign_transition', 'pause', true);
  UPDATE public.mailing_campaigns SET status = 'paused', paused_at = now()
  WHERE id = p_campaign_id AND status IN ('scheduled', 'sending') RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kampanii nie można teraz wstrzymać'; END IF;
  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action) VALUES (p_campaign_id, 'paused');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_mailing_campaign(p_campaign_id uuid)
RETURNS public.mailing_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.mailing_campaigns%ROWTYPE;
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  PERFORM set_config('app.mailing_campaign_transition', 'resume', true);
  UPDATE public.mailing_campaigns
  SET status = 'scheduled', paused_at = NULL, next_batch_at = now(), scheduled_at = LEAST(COALESCE(scheduled_at, now()), now())
  WHERE id = p_campaign_id AND status = 'paused' RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kampania nie jest wstrzymana'; END IF;
  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action) VALUES (p_campaign_id, 'resumed');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_mailing_campaign(p_campaign_id uuid)
RETURNS public.mailing_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.mailing_campaigns%ROWTYPE;
BEGIN
  IF NOT public.can_manage_marketing_campaigns() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  PERFORM set_config('app.mailing_campaign_transition', 'cancel', true);
  UPDATE public.mailing_campaigns SET status = 'cancelled', cancelled_at = now(), next_batch_at = NULL
  WHERE id = p_campaign_id AND status IN ('approved', 'scheduled', 'sending', 'paused') RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kampanii nie można teraz anulować'; END IF;
  UPDATE public.mailing_recipients
  SET status = 'excluded', exclusion_reason = 'campaign_cancelled', updated_at = now()
  WHERE campaign_id = p_campaign_id AND status IN ('queued', 'retry', 'processing');
  INSERT INTO public.mailing_campaign_approval_log(campaign_id, action) VALUES (p_campaign_id, 'cancelled');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_mailing_campaign_batch(p_max_batch integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  campaign public.mailing_campaigns%ROWTYPE;
  recipient_ids uuid[];
  effective_batch integer;
BEGIN
  -- Funkcja jest dostępna wyłącznie dla service_role (grant poniżej).
  UPDATE public.mailing_recipients
  SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'retry' END,
      failed_at = CASE WHEN attempt_count >= 3 THEN now() ELSE failed_at END,
      next_attempt_at = CASE WHEN attempt_count < 3 THEN now() ELSE next_attempt_at END,
      error_message = COALESCE(error_message, 'Przerwane przetwarzanie — automatyczne odzyskanie'),
      claimed_at = NULL, updated_at = now()
  WHERE status = 'processing' AND claimed_at < now() - interval '15 minutes';

  SELECT * INTO campaign
  FROM public.mailing_campaigns
  WHERE status IN ('scheduled', 'sending')
    AND scheduled_at <= now()
    AND COALESCE(next_batch_at, now()) <= now()
  ORDER BY scheduled_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Ponowna kontrola sprzeciwów dokładnie przed pobraniem partii.
  UPDATE public.mailing_recipients recipient
  SET status = 'unsubscribed', exclusion_reason = 'suppression_list', updated_at = now()
  WHERE recipient.campaign_id = campaign.id
    AND recipient.status IN ('queued', 'retry')
    AND EXISTS (
      SELECT 1 FROM public.marketing_suppression_list suppression
      WHERE lower(btrim(suppression.email)) = lower(btrim(recipient.email))
        AND suppression.revoked_at IS NULL
    );

  effective_batch := LEAST(GREATEST(campaign.batch_size, 1), LEAST(GREATEST(p_max_batch, 1), 20));
  WITH claimed AS (
    SELECT recipient.id
    FROM public.mailing_recipients recipient
    WHERE recipient.campaign_id = campaign.id
      AND recipient.status IN ('queued', 'retry')
      AND COALESCE(recipient.next_attempt_at, now()) <= now()
    ORDER BY recipient.created_at, recipient.id
    FOR UPDATE SKIP LOCKED
    LIMIT effective_batch
  ), updated AS (
    UPDATE public.mailing_recipients recipient
    SET status = 'processing', claimed_at = now(), last_attempt_at = now(),
        attempt_count = recipient.attempt_count + 1, updated_at = now()
    FROM claimed WHERE recipient.id = claimed.id
    RETURNING recipient.id, recipient.created_at
  )
  SELECT array_agg(updated.id ORDER BY updated.created_at, updated.id)
  INTO recipient_ids FROM updated;

  IF COALESCE(cardinality(recipient_ids), 0) = 0 AND NOT EXISTS (
    SELECT 1 FROM public.mailing_recipients recipient
    WHERE recipient.campaign_id = campaign.id
      AND recipient.status IN ('queued', 'processing', 'retry')
  ) THEN
    IF campaign.status = 'scheduled' THEN
      PERFORM set_config('app.mailing_campaign_transition', 'worker', true);
      UPDATE public.mailing_campaigns
      SET status = 'sending', started_at = COALESCE(started_at, now())
      WHERE id = campaign.id;
    END IF;
    PERFORM set_config('app.mailing_campaign_transition', 'worker', true);
    UPDATE public.mailing_campaigns
    SET status = 'sent', sent_at = now(), completed_at = now(), next_batch_at = NULL,
        sent_count = (SELECT count(*) FROM public.mailing_recipients WHERE campaign_id = campaign.id AND sent_at IS NOT NULL),
        failed_count = (SELECT count(*) FROM public.mailing_recipients WHERE campaign_id = campaign.id AND status IN ('failed', 'bounced')),
        unsubscribed_count = (SELECT count(*) FROM public.mailing_recipients WHERE campaign_id = campaign.id AND status = 'unsubscribed'),
        last_processed_at = now()
    WHERE id = campaign.id;
    INSERT INTO public.mailing_campaign_approval_log(campaign_id, action)
    VALUES (campaign.id, 'completed');
    RETURN NULL;
  END IF;

  IF campaign.status = 'scheduled' THEN
    PERFORM set_config('app.mailing_campaign_transition', 'worker', true);
    UPDATE public.mailing_campaigns
    SET status = 'sending', started_at = COALESCE(started_at, now()),
        last_processed_at = now(), next_batch_at = now() + make_interval(secs => send_interval_seconds)
    WHERE id = campaign.id;
    INSERT INTO public.mailing_campaign_approval_log(campaign_id, action) VALUES (campaign.id, 'started');
  ELSE
    UPDATE public.mailing_campaigns
    SET last_processed_at = now(), next_batch_at = now() + make_interval(secs => send_interval_seconds)
    WHERE id = campaign.id;
  END IF;

  RETURN jsonb_build_object('campaign_id', campaign.id, 'recipient_ids', COALESCE(to_jsonb(recipient_ids), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_mailing_campaign_batch(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  campaign_status text;
  sent_total integer;
  failed_total integer;
  opened_total integer;
  clicked_total integer;
  unsubscribed_total integer;
  remaining_total integer;
BEGIN
  SELECT status INTO campaign_status FROM public.mailing_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono kampanii'; END IF;

  SELECT
    count(*) FILTER (WHERE sent_at IS NOT NULL),
    count(*) FILTER (WHERE status IN ('failed', 'bounced')),
    count(*) FILTER (WHERE opened_at IS NOT NULL),
    count(*) FILTER (WHERE clicked_at IS NOT NULL),
    count(*) FILTER (WHERE status = 'unsubscribed'),
    count(*) FILTER (WHERE status IN ('queued', 'processing', 'retry'))
  INTO sent_total, failed_total, opened_total, clicked_total, unsubscribed_total, remaining_total
  FROM public.mailing_recipients WHERE campaign_id = p_campaign_id;

  IF campaign_status = 'sending' AND remaining_total = 0 THEN
    PERFORM set_config('app.mailing_campaign_transition', 'worker', true);
    UPDATE public.mailing_campaigns
    SET status = 'sent', sent_at = now(), completed_at = now(), next_batch_at = NULL,
        sent_count = sent_total, failed_count = failed_total,
        opened_count = opened_total, clicked_count = clicked_total,
        unsubscribed_count = unsubscribed_total, last_processed_at = now()
    WHERE id = p_campaign_id;
    INSERT INTO public.mailing_campaign_approval_log(campaign_id, action, metadata)
    VALUES (p_campaign_id, 'completed', jsonb_build_object('sent', sent_total, 'failed', failed_total));
  ELSE
    UPDATE public.mailing_campaigns
    SET sent_count = sent_total, failed_count = failed_total,
        opened_count = opened_total, clicked_count = clicked_total,
        unsubscribed_count = unsubscribed_total, last_processed_at = now()
    WHERE id = p_campaign_id;
  END IF;

  RETURN jsonb_build_object(
    'sent', sent_total, 'failed', failed_total, 'opened', opened_total,
    'clicked', clicked_total, 'unsubscribed', unsubscribed_total,
    'remaining', remaining_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_mailing_campaign_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_mailing_campaign_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mailing_campaign_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_mailing_campaign_batch(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.schedule_mailing_campaign(uuid, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_mailing_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_mailing_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_mailing_campaign(uuid) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_marketing_campaign_worker()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
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
      WHERE name = 'marketing_worker_secret' LIMIT 1
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
    RAISE WARNING 'Marketing worker skipped: add supabase_anon_key and marketing_worker_secret to Vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/process-marketing-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key,
      'apikey', anon_key, 'X-Marketing-Worker-Secret', worker_secret
    ),
    body := jsonb_build_object('source', 'cron'), timeout_milliseconds := 120000
  ) INTO request_id;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_marketing_campaign_worker() FROM PUBLIC, anon, authenticated;

DO $schedule_marketing_worker$
DECLARE job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; marketing worker was not scheduled: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1' USING 'process-marketing-campaigns' LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'process-marketing-campaigns', '* * * * *', 'SELECT public.invoke_marketing_campaign_worker();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule marketing worker: %', SQLERRM;
END;
$schedule_marketing_worker$;

COMMENT ON FUNCTION public.schedule_mailing_campaign(uuid, timestamptz, integer, integer) IS
  'Freezes an approved audience and schedules controlled batched delivery.';
COMMENT ON FUNCTION public.claim_mailing_campaign_batch(integer) IS
  'Service-role-only atomic claim for at most 20 recipients, with consent revalidation.';
