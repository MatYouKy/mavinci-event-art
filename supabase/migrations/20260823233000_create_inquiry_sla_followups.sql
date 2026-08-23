/*
  # Serwerowe SLA i follow-upy zapytań

  Jedno źródło prawdy dla przeglądarki i aplikacji mobilnej. Harmonogram działa
  w bazie nawet wtedy, gdy żadna aplikacja nie jest uruchomiona.
*/

ALTER TABLE public.employee_notification_settings
  ADD COLUMN IF NOT EXISTS inquiry_followups_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inquiry_escalations_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.inquiry_sla_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled boolean NOT NULL DEFAULT true,
  unassigned_minutes integer NOT NULL DEFAULT 15 CHECK (unassigned_minutes BETWEEN 1 AND 10080),
  first_contact_minutes integer NOT NULL DEFAULT 30 CHECK (first_contact_minutes BETWEEN 1 AND 10080),
  repeat_minutes integer NOT NULL DEFAULT 120 CHECK (repeat_minutes BETWEEN 5 AND 10080),
  escalation_minutes integer NOT NULL DEFAULT 60 CHECK (escalation_minutes BETWEEN 5 AND 10080),
  max_owner_reminders smallint NOT NULL DEFAULT 2 CHECK (max_owner_reminders BETWEEN 1 AND 10),
  offer_followup_days integer[] NOT NULL DEFAULT ARRAY[1, 3, 7],
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inquiry_sla_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS first_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_first_contact_due_at timestamptz;

UPDATE public.tasks task
SET
  first_contact_at = COALESCE(task.first_contact_at, task.last_contact_at),
  sla_first_contact_due_at = COALESCE(
    task.sla_first_contact_due_at,
    task.created_at + make_interval(mins => settings.first_contact_minutes)
  )
FROM public.inquiry_sla_settings settings
WHERE settings.id = 1
  AND task.is_inquiry = true;

CREATE TABLE IF NOT EXISTS public.inquiry_followup_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('unassigned', 'first_contact', 'next_action', 'offer_followup', 'manager_escalation')),
  sequence_no smallint NOT NULL DEFAULT 1,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'completed', 'cancelled')),
  dedupe_key text NOT NULL UNIQUE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_followup_schedule_due
  ON public.inquiry_followup_schedule (due_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_inquiry_followup_schedule_inquiry
  ON public.inquiry_followup_schedule (inquiry_id, created_at DESC);

ALTER TABLE public.inquiry_sla_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_followup_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inquiry_sla_settings_select ON public.inquiry_sla_settings;
CREATE POLICY inquiry_sla_settings_select
  ON public.inquiry_sla_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS inquiry_sla_settings_manage ON public.inquiry_sla_settings;
CREATE POLICY inquiry_sla_settings_manage
  ON public.inquiry_sla_settings FOR ALL TO authenticated
  USING (public.is_inquiry_admin())
  WITH CHECK (public.is_inquiry_admin());

DROP POLICY IF EXISTS inquiry_followup_schedule_select ON public.inquiry_followup_schedule;
CREATE POLICY inquiry_followup_schedule_select
  ON public.inquiry_followup_schedule FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks inquiry
      WHERE inquiry.id = inquiry_followup_schedule.inquiry_id
        AND public.can_view_inquiry(inquiry.inquiry_owner_id)
    )
  );

CREATE OR REPLACE FUNCTION public.prepare_inquiry_sla_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.inquiry_sla_settings%ROWTYPE;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT * INTO settings FROM public.inquiry_sla_settings WHERE id = 1;

  IF NEW.sla_first_contact_due_at IS NULL THEN
    NEW.sla_first_contact_due_at := COALESCE(NEW.created_at, now())
      + make_interval(mins => COALESCE(settings.first_contact_minutes, 30));
  END IF;

  IF NEW.last_contact_at IS NOT NULL AND NEW.first_contact_at IS NULL THEN
    NEW.first_contact_at := NEW.last_contact_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_inquiry_sla_fields_before_write ON public.tasks;
CREATE TRIGGER prepare_inquiry_sla_fields_before_write
  BEFORE INSERT OR UPDATE OF is_inquiry, last_contact_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.prepare_inquiry_sla_fields();

CREATE OR REPLACE FUNCTION public.sync_inquiry_followup_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.inquiry_sla_settings%ROWTYPE;
  followup_day integer;
  proposal_anchor timestamptz;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT * INTO settings FROM public.inquiry_sla_settings WHERE id = 1;

  IF settings.is_enabled IS DISTINCT FROM true
     OR NEW.inquiry_stage IN ('won', 'lost')
     OR NEW.status::text IN ('completed', 'cancelled')
     OR NEW.board_column = 'completed'
  THEN
    UPDATE public.inquiry_followup_schedule
    SET status = 'cancelled', updated_at = now()
    WHERE inquiry_id = NEW.id AND status = 'pending';
    RETURN NEW;
  END IF;

  IF NEW.inquiry_owner_id IS NULL THEN
    INSERT INTO public.inquiry_followup_schedule (inquiry_id, kind, due_at, dedupe_key)
    VALUES (
      NEW.id,
      'unassigned',
      COALESCE(NEW.created_at, now()) + make_interval(mins => settings.unassigned_minutes),
      'unassigned:' || NEW.id::text
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  ELSE
    UPDATE public.inquiry_followup_schedule
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE inquiry_id = NEW.id AND kind = 'unassigned' AND status = 'pending';
  END IF;

  IF NEW.inquiry_owner_id IS NOT NULL AND NEW.first_contact_at IS NULL THEN
    INSERT INTO public.inquiry_followup_schedule (inquiry_id, kind, due_at, dedupe_key)
    VALUES (
      NEW.id,
      'first_contact',
      NEW.sla_first_contact_due_at,
      'first-contact:' || NEW.id::text
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  ELSE
    UPDATE public.inquiry_followup_schedule
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE inquiry_id = NEW.id AND kind = 'first_contact' AND status = 'pending';
  END IF;

  IF NEW.next_action_at IS NOT NULL AND NEW.first_contact_at IS NOT NULL THEN
    UPDATE public.inquiry_followup_schedule
    SET status = 'cancelled', updated_at = now()
    WHERE inquiry_id = NEW.id AND kind = 'next_action' AND status = 'pending';

    INSERT INTO public.inquiry_followup_schedule (inquiry_id, kind, due_at, dedupe_key, metadata)
    VALUES (
      NEW.id,
      'next_action',
      NEW.next_action_at,
      'next-action:' || NEW.id::text || ':' || floor(extract(epoch FROM NEW.next_action_at))::bigint::text,
      jsonb_build_object('source_due_at', NEW.next_action_at)
    ) ON CONFLICT (dedupe_key) DO UPDATE
      SET due_at = EXCLUDED.due_at, status = 'pending', updated_at = now();
  ELSE
    UPDATE public.inquiry_followup_schedule
    SET status = 'cancelled', updated_at = now()
    WHERE inquiry_id = NEW.id AND kind = 'next_action' AND status = 'pending';
  END IF;

  IF NEW.inquiry_stage IN ('proposal', 'negotiation')
     AND NEW.linked_offer_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.inquiry_stage IS DISTINCT FROM OLD.inquiry_stage
       OR NEW.linked_offer_id IS DISTINCT FROM OLD.linked_offer_id
     )
  THEN
    proposal_anchor := COALESCE(NEW.last_contact_at, now());
    FOREACH followup_day IN ARRAY settings.offer_followup_days LOOP
      IF followup_day > 0 THEN
        INSERT INTO public.inquiry_followup_schedule (
          inquiry_id, kind, sequence_no, due_at, dedupe_key, metadata
        ) VALUES (
          NEW.id,
          'offer_followup',
          followup_day,
          proposal_anchor + make_interval(days => followup_day),
          'offer-followup:' || NEW.id::text || ':' || followup_day::text || ':' || floor(extract(epoch FROM proposal_anchor))::bigint::text,
          jsonb_build_object('offer_id', NEW.linked_offer_id, 'anchor', proposal_anchor)
        ) ON CONFLICT (dedupe_key) DO NOTHING;
      END IF;
    END LOOP;
  ELSIF NEW.inquiry_stage NOT IN ('proposal', 'negotiation') OR NEW.linked_offer_id IS NULL THEN
    UPDATE public.inquiry_followup_schedule
    SET status = 'cancelled', updated_at = now()
    WHERE inquiry_id = NEW.id AND kind = 'offer_followup' AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_inquiry_followup_schedule_after_write ON public.tasks;
CREATE TRIGGER sync_inquiry_followup_schedule_after_write
  AFTER INSERT OR UPDATE OF inquiry_owner_id, inquiry_stage, next_action_at, last_contact_at, linked_offer_id, status, board_column
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_inquiry_followup_schedule();

CREATE OR REPLACE FUNCTION public.apply_inquiry_sla_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);

  UPDATE public.tasks task
  SET sla_first_contact_due_at = task.created_at + make_interval(mins => NEW.first_contact_minutes)
  WHERE task.is_inquiry = true AND task.first_contact_at IS NULL
    AND task.inquiry_stage NOT IN ('won', 'lost');

  UPDATE public.inquiry_followup_schedule schedule
  SET due_at = task.created_at + make_interval(mins => NEW.unassigned_minutes), updated_at = now()
  FROM public.tasks task
  WHERE schedule.inquiry_id = task.id AND schedule.kind = 'unassigned' AND schedule.status = 'pending';

  UPDATE public.inquiry_followup_schedule schedule
  SET due_at = task.created_at + make_interval(mins => NEW.first_contact_minutes), updated_at = now()
  FROM public.tasks task
  WHERE schedule.inquiry_id = task.id AND schedule.kind = 'first_contact' AND schedule.status = 'pending';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_inquiry_sla_settings_change_before_update ON public.inquiry_sla_settings;
CREATE TRIGGER apply_inquiry_sla_settings_change_before_update
  BEFORE UPDATE ON public.inquiry_sla_settings
  FOR EACH ROW EXECUTE FUNCTION public.apply_inquiry_sla_settings_change();

-- Tworzy powiadomienie tylko raz, a notification_recipients uruchamia istniejący push.
CREATE OR REPLACE FUNCTION public.process_due_inquiry_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item record;
  inquiry record;
  settings public.inquiry_sla_settings%ROWTYPE;
  new_notification_id uuid;
  recipient_id uuid;
  recipient_count integer;
  processed_count integer := 0;
  notification_title text;
  notification_message text;
  still_relevant boolean;
BEGIN
  SELECT * INTO settings FROM public.inquiry_sla_settings WHERE id = 1;
  IF settings.is_enabled IS DISTINCT FROM true THEN RETURN 0; END IF;

  FOR item IN
    SELECT schedule.*
    FROM public.inquiry_followup_schedule schedule
    WHERE schedule.status = 'pending' AND schedule.due_at <= now()
    ORDER BY schedule.due_at
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT task.* INTO inquiry FROM public.tasks task WHERE task.id = item.inquiry_id;
    still_relevant := FOUND
      AND inquiry.is_inquiry = true
      AND inquiry.inquiry_stage NOT IN ('won', 'lost')
      AND inquiry.status::text NOT IN ('completed', 'cancelled')
      AND inquiry.board_column <> 'completed';

    IF item.kind = 'unassigned' THEN
      still_relevant := still_relevant AND inquiry.inquiry_owner_id IS NULL;
    ELSIF item.kind = 'first_contact' THEN
      still_relevant := still_relevant AND inquiry.inquiry_owner_id IS NOT NULL AND inquiry.first_contact_at IS NULL;
    ELSIF item.kind = 'next_action' THEN
      still_relevant := still_relevant AND inquiry.inquiry_owner_id IS NOT NULL
        AND inquiry.next_action_at IS NOT NULL AND inquiry.next_action_at <= now();
    ELSIF item.kind = 'offer_followup' THEN
      still_relevant := still_relevant AND inquiry.inquiry_owner_id IS NOT NULL
        AND inquiry.inquiry_stage IN ('proposal', 'negotiation');
    ELSIF item.kind = 'manager_escalation' THEN
      still_relevant := still_relevant AND (
        inquiry.inquiry_owner_id IS NULL OR inquiry.first_contact_at IS NULL
        OR (inquiry.next_action_at IS NOT NULL AND inquiry.next_action_at <= now())
      );
    END IF;

    IF NOT still_relevant THEN
      UPDATE public.inquiry_followup_schedule SET status = 'cancelled', updated_at = now() WHERE id = item.id;
      CONTINUE;
    END IF;

    notification_title := CASE item.kind
      WHEN 'unassigned' THEN 'Nieprzypisane zapytanie wymaga reakcji'
      WHEN 'first_contact' THEN 'Przekroczono czas pierwszego kontaktu'
      WHEN 'next_action' THEN 'Czas na zaplanowany kontakt'
      WHEN 'offer_followup' THEN 'Follow-up po wysłaniu oferty'
      ELSE 'Eskalacja zapytania sprzedażowego'
    END;
    notification_message := format('„%s” oczekuje na działanie w lejku sprzedaży.', inquiry.title);

    INSERT INTO public.notifications (
      title, message, type, category, action_url,
      related_entity_type, related_entity_id, metadata, created_at
    ) VALUES (
      notification_title,
      notification_message,
      CASE WHEN item.kind = 'manager_escalation' THEN 'error' ELSE 'warning' END,
      'tasks',
      format('/crm/tasks/%s', inquiry.id),
      'task',
      inquiry.id,
      jsonb_build_object(
        'kind', 'inquiry_followup',
        'actionable', item.kind IN ('first_contact', 'next_action', 'offer_followup'),
        'followup_kind', item.kind,
        'followup_schedule_id', item.id,
        'inquiry_id', inquiry.id,
        'due_at', item.due_at,
        'sequence_no', item.sequence_no
      ),
      now()
    ) RETURNING id INTO new_notification_id;

    recipient_count := 0;
    IF item.kind = 'unassigned' THEN
      FOR recipient_id IN
        SELECT employee.id
        FROM public.employees employee
        LEFT JOIN public.employee_notification_settings preferences ON preferences.employee_id = employee.id
        WHERE employee.is_active = true
          AND COALESCE(preferences.inquiry_followups_enabled, true)
          AND (
            employee.role = 'admin' OR employee.access_level = 'admin'
            OR 'inquiries_view_pool' = ANY(COALESCE(employee.permissions, '{}'::text[]))
            OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      LOOP
        INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
        VALUES (new_notification_id, recipient_id, false)
        ON CONFLICT (notification_id, user_id) DO NOTHING;
        recipient_count := recipient_count + 1;
      END LOOP;
    ELSIF item.kind = 'manager_escalation' THEN
      FOR recipient_id IN
        SELECT employee.id
        FROM public.employees employee
        LEFT JOIN public.employee_notification_settings preferences ON preferences.employee_id = employee.id
        WHERE employee.is_active = true
          AND COALESCE(preferences.inquiry_escalations_enabled, true)
          AND (
            employee.role = 'admin' OR employee.access_level = 'admin'
            OR (
              employee.is_sales_team_manager = true
              AND employee.sales_team_id IS NOT DISTINCT FROM (
                SELECT owner.sales_team_id FROM public.employees owner WHERE owner.id = inquiry.inquiry_owner_id
              )
            )
          )
      LOOP
        INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
        VALUES (new_notification_id, recipient_id, false)
        ON CONFLICT (notification_id, user_id) DO NOTHING;
        recipient_count := recipient_count + 1;
      END LOOP;
    ELSIF inquiry.inquiry_owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.employees employee
      LEFT JOIN public.employee_notification_settings preferences ON preferences.employee_id = employee.id
      WHERE employee.id = inquiry.inquiry_owner_id AND employee.is_active = true
        AND COALESCE(preferences.inquiry_followups_enabled, true)
    ) THEN
      INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
      VALUES (new_notification_id, inquiry.inquiry_owner_id, false)
      ON CONFLICT (notification_id, user_id) DO NOTHING;
      recipient_count := 1;
    END IF;

    IF recipient_count = 0 THEN
      DELETE FROM public.notifications WHERE id = new_notification_id;
      new_notification_id := NULL;
    END IF;

    UPDATE public.inquiry_followup_schedule
    SET status = 'sent', sent_at = now(), notification_id = new_notification_id, updated_at = now()
    WHERE id = item.id;

    IF item.kind IN ('first_contact', 'next_action') AND item.sequence_no < settings.max_owner_reminders THEN
      INSERT INTO public.inquiry_followup_schedule (
        inquiry_id, kind, sequence_no, due_at, dedupe_key, metadata
      ) VALUES (
        inquiry.id,
        item.kind,
        item.sequence_no + 1,
        now() + make_interval(mins => settings.repeat_minutes),
        'repeat:' || item.id::text || ':' || (item.sequence_no + 1)::text,
        item.metadata || jsonb_build_object('repeats_schedule_id', item.id)
      ) ON CONFLICT (dedupe_key) DO NOTHING;
    ELSIF item.kind IN ('unassigned', 'first_contact', 'next_action') THEN
      INSERT INTO public.inquiry_followup_schedule (
        inquiry_id, kind, sequence_no, due_at, dedupe_key, metadata
      ) VALUES (
        inquiry.id,
        'manager_escalation',
        1,
        now() + make_interval(mins => settings.escalation_minutes),
        'escalation:' || item.id::text,
        jsonb_build_object('source_kind', item.kind, 'source_schedule_id', item.id)
      ) ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;

    processed_count := processed_count + 1;
  END LOOP;

  RETURN processed_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_inquiry_followup(
  p_inquiry_id uuid,
  p_next_action_at timestamptz DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inquiry public.tasks%ROWTYPE;
BEGIN
  SELECT * INTO inquiry FROM public.tasks WHERE id = p_inquiry_id AND is_inquiry = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono zapytania'; END IF;
  IF NOT public.can_manage_inquiry(inquiry.inquiry_owner_id) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;

  UPDATE public.tasks
  SET
    last_contact_at = now(),
    first_contact_at = COALESCE(first_contact_at, now()),
    next_action_at = p_next_action_at,
    inquiry_stage = CASE WHEN inquiry_stage = 'new' THEN 'contacted' ELSE inquiry_stage END,
    updated_at = now()
  WHERE id = p_inquiry_id
  RETURNING * INTO inquiry;

  UPDATE public.inquiry_followup_schedule
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE inquiry_id = p_inquiry_id
    AND status = 'pending'
    AND kind IN ('first_contact', 'next_action', 'manager_escalation');

  RETURN inquiry;
END;
$$;

CREATE OR REPLACE FUNCTION public.snooze_inquiry_followup(
  p_inquiry_id uuid,
  p_minutes integer DEFAULT 60
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inquiry public.tasks%ROWTYPE;
BEGIN
  SELECT * INTO inquiry FROM public.tasks WHERE id = p_inquiry_id AND is_inquiry = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono zapytania'; END IF;
  IF NOT public.can_manage_inquiry(inquiry.inquiry_owner_id) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  IF p_minutes NOT BETWEEN 5 AND 10080 THEN RAISE EXCEPTION 'Nieprawidłowy czas odroczenia'; END IF;

  UPDATE public.tasks
  SET next_action_at = now() + make_interval(mins => p_minutes), updated_at = now()
  WHERE id = p_inquiry_id
  RETURNING * INTO inquiry;
  RETURN inquiry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_inquiry_followup(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snooze_inquiry_followup(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.process_due_inquiry_followups() FROM PUBLIC;

-- Zasilamy harmonogram również dla zapytań istniejących przed migracją.
INSERT INTO public.inquiry_followup_schedule (inquiry_id, kind, due_at, dedupe_key)
SELECT task.id, 'unassigned', task.created_at + make_interval(mins => settings.unassigned_minutes), 'unassigned:' || task.id::text
FROM public.tasks task CROSS JOIN public.inquiry_sla_settings settings
WHERE task.is_inquiry = true AND task.inquiry_owner_id IS NULL
  AND task.inquiry_stage NOT IN ('won', 'lost') AND settings.id = 1
ON CONFLICT (dedupe_key) DO NOTHING;

INSERT INTO public.inquiry_followup_schedule (inquiry_id, kind, due_at, dedupe_key)
SELECT task.id, 'first_contact', task.sla_first_contact_due_at, 'first-contact:' || task.id::text
FROM public.tasks task
WHERE task.is_inquiry = true AND task.inquiry_owner_id IS NOT NULL AND task.first_contact_at IS NULL
  AND task.inquiry_stage NOT IN ('won', 'lost')
ON CONFLICT (dedupe_key) DO NOTHING;

INSERT INTO public.inquiry_followup_schedule (inquiry_id, kind, due_at, dedupe_key, metadata)
SELECT task.id, 'next_action', task.next_action_at,
  'next-action:' || task.id::text || ':' || floor(extract(epoch FROM task.next_action_at))::bigint::text,
  jsonb_build_object('source_due_at', task.next_action_at)
FROM public.tasks task
WHERE task.is_inquiry = true AND task.next_action_at IS NOT NULL AND task.first_contact_at IS NOT NULL
  AND task.inquiry_stage NOT IN ('won', 'lost')
ON CONFLICT (dedupe_key) DO NOTHING;

DO $schedule_inquiry_followups$
DECLARE job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; inquiry SLA processor was not scheduled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1' USING 'process-inquiry-followups' LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'process-inquiry-followups', '*/5 * * * *', 'SELECT public.process_due_inquiry_followups();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule inquiry SLA processor: %', SQLERRM;
END;
$schedule_inquiry_followups$;

COMMENT ON TABLE public.inquiry_followup_schedule IS
  'Deduplicated server-side queue for inquiry reminders, offer follow-ups and manager escalations.';
