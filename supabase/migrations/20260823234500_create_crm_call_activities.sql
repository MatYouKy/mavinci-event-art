/*
  # Połączenia telefoniczne CRM

  Rejestruje połączenia inicjowane z aplikacji mobilnej i ich wynik bez dostępu
  do prywatnego systemowego rejestru połączeń telefonu.
*/

CREATE TABLE IF NOT EXISTS public.crm_call_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  direction text NOT NULL DEFAULT 'outgoing' CHECK (direction IN ('outgoing', 'incoming')),
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'completed', 'cancelled')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('connected', 'no_answer', 'busy', 'voicemail', 'wrong_number')),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text,
  next_action_at timestamptz,
  reminder_sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_call_activities_phone
  ON public.crm_call_activities (phone_number, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_call_activities_contact
  ON public.crm_call_activities (contact_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_call_activities_inquiry
  ON public.crm_call_activities (inquiry_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_call_activities_created_by
  ON public.crm_call_activities (created_by, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_call_activities_followup_due
  ON public.crm_call_activities (next_action_at)
  WHERE status = 'completed' AND next_action_at IS NOT NULL AND reminder_sent_at IS NULL;

ALTER TABLE public.crm_call_activities ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_crm_call_activity(activity_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = auth.uid()
      AND employee.is_active = true
      AND (
        employee.id = activity_owner
        OR employee.role = 'admin'
        OR employee.access_level IN ('admin', 'manager', 'event_manager')
        OR 'contacts_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

DROP POLICY IF EXISTS crm_call_activities_select ON public.crm_call_activities;
CREATE POLICY crm_call_activities_select
  ON public.crm_call_activities FOR SELECT TO authenticated
  USING (public.can_view_crm_call_activity(created_by));

DROP POLICY IF EXISTS crm_call_activities_insert ON public.crm_call_activities;
CREATE POLICY crm_call_activities_insert
  ON public.crm_call_activities FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS crm_call_activities_update ON public.crm_call_activities;
CREATE POLICY crm_call_activities_update
  ON public.crm_call_activities FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid() AND employee.is_active = true
        AND (
          employee.role = 'admin' OR employee.access_level = 'admin'
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid() AND employee.is_active = true
        AND (
          employee.role = 'admin' OR employee.access_level = 'admin'
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.finish_crm_call_activity(
  p_activity_id uuid,
  p_outcome text,
  p_notes text DEFAULT NULL,
  p_next_action_at timestamptz DEFAULT NULL
)
RETURNS public.crm_call_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE activity public.crm_call_activities%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('connected', 'no_answer', 'busy', 'voicemail', 'wrong_number') THEN
    RAISE EXCEPTION 'Nieprawidłowy wynik połączenia';
  END IF;

  SELECT * INTO activity
  FROM public.crm_call_activities
  WHERE id = p_activity_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono połączenia'; END IF;
  IF activity.created_by <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = auth.uid() AND employee.is_active = true
      AND (employee.role = 'admin' OR employee.access_level = 'admin')
  ) THEN
    RAISE EXCEPTION 'Brak uprawnień';
  END IF;

  UPDATE public.crm_call_activities
  SET
    status = 'completed',
    outcome = p_outcome,
    notes = NULLIF(btrim(p_notes), ''),
    next_action_at = p_next_action_at,
    ended_at = now(),
    updated_at = now()
  WHERE id = p_activity_id
  RETURNING * INTO activity;

  IF activity.contact_id IS NOT NULL AND p_outcome = 'connected' THEN
    UPDATE public.contacts SET last_contact_date = now(), updated_at = now()
    WHERE id = activity.contact_id;
  END IF;

  IF activity.inquiry_id IS NOT NULL AND p_outcome = 'connected' THEN
    UPDATE public.tasks
    SET
      last_contact_at = now(),
      first_contact_at = COALESCE(first_contact_at, now()),
      next_action_at = p_next_action_at,
      inquiry_stage = CASE WHEN inquiry_stage = 'new' THEN 'contacted' ELSE inquiry_stage END,
      updated_at = now()
    WHERE id = activity.inquiry_id AND is_inquiry = true;
  END IF;

  RETURN activity;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_crm_call_activity(uuid, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_due_crm_call_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  activity record;
  notification_id uuid;
  processed integer := 0;
  target_name text;
BEGIN
  FOR activity IN
    SELECT call.*
    FROM public.crm_call_activities call
    WHERE call.status = 'completed'
      AND call.next_action_at IS NOT NULL
      AND call.next_action_at <= now()
      AND call.reminder_sent_at IS NULL
    ORDER BY call.next_action_at
    FOR UPDATE SKIP LOCKED
  LOOP
    target_name := COALESCE(activity.metadata->>'display_name', activity.phone_number);
    INSERT INTO public.notifications (
      title, message, type, category, action_url,
      related_entity_type, related_entity_id, metadata, created_at
    ) VALUES (
      'Zaplanowany kontakt telefoniczny',
      format('Czas skontaktować się z: %s (%s).', target_name, activity.phone_number),
      'warning',
      'system',
      CASE
        WHEN activity.inquiry_id IS NOT NULL THEN format('/crm/tasks/%s', activity.inquiry_id)
        WHEN activity.event_id IS NOT NULL THEN format('/crm/events/%s', activity.event_id)
        WHEN activity.contact_id IS NOT NULL THEN format('/crm/contacts/%s', activity.contact_id)
        ELSE '/crm/contacts'
      END,
      CASE
        WHEN activity.inquiry_id IS NOT NULL THEN 'task'
        WHEN activity.event_id IS NOT NULL THEN 'event'
        ELSE NULL
      END,
      COALESCE(activity.inquiry_id, activity.event_id),
      jsonb_build_object(
        'kind', 'crm_call_followup',
        'call_activity_id', activity.id,
        'contact_id', activity.contact_id,
        'inquiry_id', activity.inquiry_id,
        'event_id', activity.event_id,
        'phone_number', activity.phone_number
      ),
      now()
    ) RETURNING id INTO notification_id;

    INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
    VALUES (notification_id, activity.created_by, false)
    ON CONFLICT (notification_id, user_id) DO NOTHING;

    UPDATE public.crm_call_activities
    SET reminder_sent_at = now(), updated_at = now()
    WHERE id = activity.id;
    processed := processed + 1;
  END LOOP;
  RETURN processed;
END;
$$;

REVOKE ALL ON FUNCTION public.process_due_crm_call_followups() FROM PUBLIC;

DO $schedule_crm_call_followups$
DECLARE job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; CRM call follow-ups were not scheduled: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1' USING 'process-crm-call-followups' LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'process-crm-call-followups', '*/5 * * * *', 'SELECT public.process_due_crm_call_followups();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule CRM call follow-ups: %', SQLERRM;
END;
$schedule_crm_call_followups$;

COMMENT ON TABLE public.crm_call_activities IS
  'Auditable CRM history of calls initiated from mobile without reading the private device call log.';
