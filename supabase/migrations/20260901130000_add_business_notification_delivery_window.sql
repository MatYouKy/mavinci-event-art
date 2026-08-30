/*
  # Business notification delivery window

  High-score tender notifications and operational reminders should reach staff
  only between 08:00 and 15:00 in Europe/Warsaw. Notifications detected outside
  that window are retained in an outbox and delivered from 08:00 the next day.
*/

CREATE OR REPLACE FUNCTION public.crm_business_notification_window_is_open(
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (p_at AT TIME ZONE 'Europe/Warsaw')::time >= time '08:00'
     AND (p_at AT TIME ZONE 'Europe/Warsaw')::time < time '15:00';
$$;

CREATE OR REPLACE FUNCTION public.next_crm_business_notification_delivery_at(
  p_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH local_clock AS (
    SELECT p_at AT TIME ZONE 'Europe/Warsaw' AS local_at
  )
  SELECT CASE
    WHEN local_at::time < time '08:00'
      THEN (local_at::date + time '08:00') AT TIME ZONE 'Europe/Warsaw'
    WHEN local_at::time < time '15:00'
      THEN p_at
    ELSE ((local_at::date + 1) + time '08:00') AT TIME ZONE 'Europe/Warsaw'
  END
  FROM local_clock;
$$;

CREATE TABLE IF NOT EXISTS public.crm_business_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deduplication_key text NOT NULL UNIQUE,
  notification_kind text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  category text NOT NULL DEFAULT 'system',
  action_url text,
  related_entity_type text,
  related_entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_user_ids uuid[] NOT NULL,
  deliver_after timestamptz NOT NULL,
  delivered_notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  delivered_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_business_notification_outbox_has_recipients
    CHECK (cardinality(recipient_user_ids) > 0)
);

CREATE INDEX IF NOT EXISTS idx_crm_business_notification_outbox_pending
  ON public.crm_business_notification_outbox(deliver_after, created_at)
  WHERE delivered_at IS NULL;

ALTER TABLE public.crm_business_notification_outbox ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enqueue_crm_business_notification(
  p_deduplication_key text,
  p_notification_kind text,
  p_title text,
  p_message text,
  p_type text,
  p_category text,
  p_action_url text,
  p_related_entity_type text,
  p_related_entity_id uuid,
  p_metadata jsonb,
  p_recipient_user_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id_value uuid;
  outbox_id_value uuid;
BEGIN
  IF NULLIF(trim(p_deduplication_key), '') IS NULL THEN
    RAISE EXCEPTION 'deduplication_key is required';
  END IF;

  IF COALESCE(cardinality(p_recipient_user_ids), 0) = 0 THEN
    RETURN NULL;
  END IF;

  IF public.crm_business_notification_window_is_open(now()) THEN
    INSERT INTO public.notifications(
      title, message, type, category, action_url,
      related_entity_type, related_entity_id, metadata, created_at
    ) VALUES (
      p_title, p_message, p_type, p_category, p_action_url,
      p_related_entity_type, p_related_entity_id,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'notification_kind', p_notification_kind,
        'delivery_window', '08:00-15:00 Europe/Warsaw'
      ),
      now()
    )
    RETURNING id INTO notification_id_value;

    INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
    SELECT notification_id_value, recipient_id, false
    FROM (
      SELECT DISTINCT unnest(p_recipient_user_ids) AS recipient_id
    ) recipients
    ON CONFLICT (notification_id, user_id) DO NOTHING;

    RETURN notification_id_value;
  END IF;

  INSERT INTO public.crm_business_notification_outbox(
    deduplication_key, notification_kind, title, message, type, category,
    action_url, related_entity_type, related_entity_id, metadata,
    recipient_user_ids, deliver_after
  ) VALUES (
    p_deduplication_key, p_notification_kind, p_title, p_message,
    p_type, p_category, p_action_url, p_related_entity_type,
    p_related_entity_id, COALESCE(p_metadata, '{}'::jsonb),
    ARRAY(SELECT DISTINCT unnest(p_recipient_user_ids)),
    public.next_crm_business_notification_delivery_at(now())
  )
  ON CONFLICT (deduplication_key) DO UPDATE SET
    recipient_user_ids = EXCLUDED.recipient_user_ids,
    metadata = EXCLUDED.metadata,
    deliver_after = LEAST(
      public.crm_business_notification_outbox.deliver_after,
      EXCLUDED.deliver_after
    ),
    updated_at = now()
  WHERE public.crm_business_notification_outbox.delivered_at IS NULL
  RETURNING id INTO outbox_id_value;

  IF outbox_id_value IS NULL THEN
    SELECT id INTO outbox_id_value
    FROM public.crm_business_notification_outbox
    WHERE deduplication_key = p_deduplication_key;
  END IF;

  RETURN outbox_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.flush_crm_business_notification_outbox()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_record record;
  notification_id_value uuid;
  delivered_count integer := 0;
BEGIN
  IF NOT public.crm_business_notification_window_is_open(now()) THEN
    RETURN 0;
  END IF;

  FOR queued_record IN
    SELECT outbox.*
    FROM public.crm_business_notification_outbox outbox
    WHERE outbox.delivered_at IS NULL
      AND outbox.deliver_after <= now()
    ORDER BY outbox.deliver_after, outbox.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      INSERT INTO public.notifications(
        title, message, type, category, action_url,
        related_entity_type, related_entity_id, metadata, created_at
      ) VALUES (
        queued_record.title,
        queued_record.message,
        queued_record.type,
        queued_record.category,
        queued_record.action_url,
        queued_record.related_entity_type,
        queued_record.related_entity_id,
        queued_record.metadata || jsonb_build_object(
          'notification_kind', queued_record.notification_kind,
          'delivery_window', '08:00-15:00 Europe/Warsaw',
          'queued_at', queued_record.created_at
        ),
        now()
      )
      RETURNING id INTO notification_id_value;

      INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
      SELECT notification_id_value, recipient_id, false
      FROM (
        SELECT DISTINCT unnest(queued_record.recipient_user_ids) AS recipient_id
      ) recipients
      ON CONFLICT (notification_id, user_id) DO NOTHING;

      UPDATE public.crm_business_notification_outbox
      SET delivered_notification_id = notification_id_value,
          delivered_at = now(),
          attempt_count = attempt_count + 1,
          last_error = NULL,
          updated_at = now()
      WHERE id = queued_record.id;

      delivered_count := delivered_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.crm_business_notification_outbox
      SET attempt_count = attempt_count + 1,
          last_error = LEFT(SQLERRM, 1000),
          updated_at = now()
      WHERE id = queued_record.id;
    END;
  END LOOP;

  RETURN delivered_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_event_operational_alerts_in_delivery_window()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.crm_business_notification_window_is_open(now()) THEN
    RETURN 0;
  END IF;

  RETURN public.process_event_operational_alerts();
END;
$$;

REVOKE ALL ON TABLE public.crm_business_notification_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_crm_business_notification(text,text,text,text,text,text,text,text,uuid,jsonb,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flush_crm_business_notification_outbox() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_event_operational_alerts_in_delivery_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_crm_business_notification(text,text,text,text,text,text,text,text,uuid,jsonb,uuid[]) TO service_role;

DO $schedule_business_notifications$
DECLARE
  job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname IN ($1, $2, $3)'
      USING
        'notify-overdue-event-workflows',
        'process-event-operational-alerts',
        'flush-crm-business-notification-outbox'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;

    EXECUTE 'SELECT cron.schedule($1,$2,$3)'
      USING
        'process-event-operational-alerts',
        '20 * * * *',
        'SELECT public.process_event_operational_alerts_in_delivery_window();';

    EXECUTE 'SELECT cron.schedule($1,$2,$3)'
      USING
        'flush-crm-business-notification-outbox',
        '*/5 * * * *',
        'SELECT public.flush_crm_business_notification_outbox();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule business notification delivery: %', SQLERRM;
END;
$schedule_business_notifications$;

COMMENT ON TABLE public.crm_business_notification_outbox IS
  'Deferred high-value CRM notifications delivered only from 08:00 to 15:00 Europe/Warsaw.';
COMMENT ON FUNCTION public.process_event_operational_alerts_in_delivery_window() IS
  'Runs incomplete-event and overdue-workflow reminders only during the Warsaw delivery window.';
