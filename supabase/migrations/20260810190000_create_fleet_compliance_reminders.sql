/*
  # Fleet insurance and technical-inspection compliance

  - Every operational vehicle must have valid OC and a valid technical inspection.
  - Reminders are emitted at 60/30/14/7/3/1 days, on the due date and daily overdue.
  - Adding a renewed policy or a completed inspection immediately resolves the old alert.
  - The reminder log prevents duplicate notifications when the refresh runs more than once.
*/

-- Some hosted environments still have the original, narrower vehicle status
-- constraint. Keep legacy values and add the operational blocking statuses used
-- by fleet compliance before the initial refresh tries to assign them.
ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_status_check;

ALTER TABLE public.vehicles
  ADD CONSTRAINT valid_status CHECK (
    status IN (
      'active',
      'available',
      'in_use',
      'in_service',
      'under_repair',
      'no_insurance',
      'no_inspection',
      'inactive',
      'sold',
      'scrapped'
    )
  );

-- Older migrations introduced two variants of periodic_inspections. Normalize the
-- columns used by the current fleet UI without removing historical data.
ALTER TABLE public.periodic_inspections
  ADD COLUMN IF NOT EXISTS service_provider text,
  ADD COLUMN IF NOT EXISTS performed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS passed boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS defects_noted text,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS inspection_station text,
  ADD COLUMN IF NOT EXISTS next_inspection_due date,
  ADD COLUMN IF NOT EXISTS is_current boolean DEFAULT true;

ALTER TABLE public.periodic_inspections
  ALTER COLUMN inspection_station DROP NOT NULL,
  ALTER COLUMN result DROP NOT NULL,
  ALTER COLUMN odometer_reading DROP NOT NULL;

ALTER TABLE public.periodic_inspections
  DROP CONSTRAINT IF EXISTS periodic_inspections_inspection_type_check;
ALTER TABLE public.periodic_inspections
  ADD CONSTRAINT periodic_inspections_inspection_type_check
  CHECK (inspection_type IN ('technical', 'emissions', 'technical_inspection', 'periodic_service'));

ALTER TABLE public.periodic_inspections
  DROP CONSTRAINT IF EXISTS periodic_inspections_result_check;
ALTER TABLE public.periodic_inspections
  ADD CONSTRAINT periodic_inspections_result_check
  CHECK (result IS NULL OR result IN ('passed', 'failed', 'conditional'));

UPDATE public.periodic_inspections
SET
  service_provider = COALESCE(service_provider, inspection_station),
  passed = COALESCE(passed, result IS DISTINCT FROM 'failed'),
  next_inspection_due = COALESCE(next_inspection_due, valid_until),
  is_current = COALESCE(is_current, true);

CREATE OR REPLACE FUNCTION public.manage_current_inspection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_current, true) THEN
    UPDATE public.periodic_inspections
    SET is_current = false
    WHERE vehicle_id = NEW.vehicle_id
      AND inspection_type = NEW.inspection_type
      AND id <> NEW.id
      AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_manage_current_inspection ON public.periodic_inspections;
CREATE TRIGGER trigger_manage_current_inspection
  AFTER INSERT OR UPDATE OF is_current ON public.periodic_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_current_inspection();

ALTER TABLE public.employee_notification_settings
  ADD COLUMN IF NOT EXISTS fleet_compliance_enabled boolean NOT NULL DEFAULT false;

UPDATE public.employee_notification_settings ens
SET fleet_compliance_enabled = true
FROM public.employees e
WHERE e.id = ens.employee_id
  AND e.is_active = true
  AND (
    e.role = 'admin'
    OR e.access_level = 'admin'
    OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
    OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
  );

INSERT INTO public.employee_notification_settings (
  employee_id,
  contact_form_enabled,
  webhook_notifications_enabled,
  fleet_compliance_enabled
)
SELECT
  e.id,
  false,
  false,
  true
FROM public.employees e
WHERE e.is_active = true
  AND (
    e.role = 'admin'
    OR e.access_level = 'admin'
    OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
    OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
  )
ON CONFLICT (employee_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.vehicle_compliance_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  compliance_type text NOT NULL CHECK (compliance_type IN ('insurance_oc', 'technical_inspection')),
  related_id uuid,
  due_date date,
  reminder_key text NOT NULL,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, compliance_type, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_compliance_reminder_log_vehicle
  ON public.vehicle_compliance_reminder_log(vehicle_id, compliance_type, created_at DESC);

ALTER TABLE public.vehicle_compliance_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fleet managers can view compliance reminder log"
  ON public.vehicle_compliance_reminder_log;
CREATE POLICY "Fleet managers can view compliance reminder log"
  ON public.vehicle_compliance_reminder_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.id = auth.uid()
        AND e.is_active = true
        AND (
          e.role = 'admin'
          OR e.access_level = 'admin'
          OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR 'fleet_view' = ANY(COALESCE(e.permissions, '{}'::text[]))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.create_fleet_compliance_notification(
  p_vehicle_id uuid,
  p_compliance_type text,
  p_related_id uuid,
  p_due_date date,
  p_reminder_key text,
  p_title text,
  p_message text,
  p_notification_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_id uuid;
  v_recipient_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.vehicle_compliance_reminder_log l
    WHERE l.vehicle_id = p_vehicle_id
      AND l.compliance_type = p_compliance_type
      AND l.reminder_key = p_reminder_key
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    LEFT JOIN public.employee_notification_settings ens ON ens.employee_id = e.id
    WHERE e.is_active = true
      AND (
        e.role = 'admin'
        OR e.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
      )
      AND COALESCE(
        ens.fleet_compliance_enabled,
        e.role = 'admin'
          OR e.access_level = 'admin'
          OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
      ) = true
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.notifications (
    title,
    message,
    type,
    category,
    related_entity_type,
    related_entity_id,
    action_url,
    metadata,
    created_at
  )
  VALUES (
    p_title,
    p_message,
    p_notification_type,
    'system',
    'vehicle',
    p_vehicle_id::text,
    '/crm/fleet/' || p_vehicle_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'compliance_type', p_compliance_type,
      'related_id', p_related_id,
      'due_date', p_due_date,
      'reminder_key', p_reminder_key
    )),
    now()
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  SELECT
    v_notification_id,
    e.id,
    false,
    now()
  FROM public.employees e
  LEFT JOIN public.employee_notification_settings ens ON ens.employee_id = e.id
  WHERE e.is_active = true
    AND (
      e.role = 'admin'
      OR e.access_level = 'admin'
      OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
      OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
    )
    AND COALESCE(
      ens.fleet_compliance_enabled,
      e.role = 'admin'
        OR e.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
    ) = true
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_recipient_count = ROW_COUNT;

  IF v_recipient_count = 0 THEN
    DELETE FROM public.notifications WHERE id = v_notification_id;
    RETURN false;
  END IF;

  INSERT INTO public.vehicle_compliance_reminder_log (
    vehicle_id,
    compliance_type,
    related_id,
    due_date,
    reminder_key,
    notification_id
  )
  VALUES (
    p_vehicle_id,
    p_compliance_type,
    p_related_id,
    p_due_date,
    p_reminder_key,
    v_notification_id
  )
  ON CONFLICT (vehicle_id, compliance_type, reminder_key) DO NOTHING;

  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_fleet_compliance_notification(
  uuid, text, uuid, date, text, text, text, text
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_vehicle_status_from_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.vehicles v
  SET status = 'no_insurance'
  WHERE v.status NOT IN ('inactive', 'sold', 'scrapped')
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.alert_type = 'insurance'
        AND va.is_active = true
        AND va.is_blocking = true
    );

  UPDATE public.vehicles v
  SET status = 'no_inspection'
  WHERE v.status NOT IN ('inactive', 'sold', 'scrapped')
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.alert_type = 'insurance'
        AND va.is_active = true
        AND va.is_blocking = true
    )
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.alert_type = 'inspection'
        AND va.is_active = true
        AND va.is_blocking = true
    );

  UPDATE public.vehicles v
  SET status = 'available'
  WHERE v.status IN ('no_insurance', 'no_inspection')
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.is_active = true
        AND va.is_blocking = true
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_vehicles ev
      WHERE ev.vehicle_id = v.id
        AND ev.is_in_use = true
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_vehicle_compliance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle record;
  v_policy_id uuid;
  v_inspection_id uuid;
  v_due_date date;
  v_days integer;
  v_reminder_key text;
  v_title text;
  v_message text;
  v_notification_type text;
  v_created_count integer := 0;
BEGIN
  UPDATE public.insurance_policies
  SET status = CASE WHEN end_date < CURRENT_DATE THEN 'expired' ELSE 'active' END
  WHERE status <> 'cancelled'
    AND status IS DISTINCT FROM CASE WHEN end_date < CURRENT_DATE THEN 'expired' ELSE 'active' END;

  DELETE FROM public.vehicle_alerts
  WHERE alert_type IN ('insurance', 'inspection');

  FOR v_vehicle IN
    SELECT id, COALESCE(NULLIF(name, ''), NULLIF(brand || ' ' || model, ''), 'Pojazd') AS name,
      registration_number
    FROM public.vehicles
    WHERE status NOT IN ('inactive', 'sold', 'scrapped')
  LOOP
    v_policy_id := NULL;
    v_due_date := NULL;

    WITH RECURSIVE coverage AS (
      (
        SELECT ip.id, ip.start_date, ip.end_date
        FROM public.insurance_policies ip
        WHERE ip.vehicle_id = v_vehicle.id
          AND ip.type = 'oc'
          AND ip.status <> 'cancelled'
          AND ip.start_date <= CURRENT_DATE
        ORDER BY ip.end_date DESC
        LIMIT 1
      )
      UNION ALL
      SELECT renewed.id, renewed.start_date, renewed.end_date
      FROM coverage current_coverage
      JOIN LATERAL (
        SELECT ip.id, ip.start_date, ip.end_date
        FROM public.insurance_policies ip
        WHERE ip.vehicle_id = v_vehicle.id
          AND ip.type = 'oc'
          AND ip.status <> 'cancelled'
          AND ip.start_date <= current_coverage.end_date + 1
          AND ip.end_date > current_coverage.end_date
        ORDER BY ip.end_date DESC
        LIMIT 1
      ) renewed ON true
    )
    SELECT id, end_date
    INTO v_policy_id, v_due_date
    FROM coverage
    ORDER BY end_date DESC
    LIMIT 1;

    IF v_due_date IS NULL OR v_due_date <= CURRENT_DATE + 60 THEN
      v_days := CASE WHEN v_due_date IS NULL THEN NULL ELSE v_due_date - CURRENT_DATE END;

      INSERT INTO public.vehicle_alerts (
        vehicle_id, alert_type, priority, title, message, icon,
        is_blocking, is_active, due_date, related_id
      )
      VALUES (
        v_vehicle.id,
        'insurance',
        CASE
          WHEN v_due_date IS NULL OR v_days < 0 THEN 'critical'
          WHEN v_days <= 7 THEN 'high'
          WHEN v_days <= 30 THEN 'medium'
          ELSE 'low'
        END,
        CASE
          WHEN v_due_date IS NULL THEN 'Brak ważnego OC'
          WHEN v_days < 0 THEN 'OC wygasło'
          WHEN v_days = 0 THEN 'OC wygasa dzisiaj'
          ELSE 'OC wygasa wkrótce'
        END,
        CASE
          WHEN v_due_date IS NULL THEN 'Pojazd nie ma potwierdzonej ważnej polisy OC.'
          WHEN v_days < 0 THEN 'Polisa OC wygasła ' || abs(v_days) || ' dni temu (' || to_char(v_due_date, 'DD.MM.YYYY') || ').'
          WHEN v_days = 0 THEN 'Polisa OC wygasa dzisiaj (' || to_char(v_due_date, 'DD.MM.YYYY') || ').'
          ELSE 'Polisa OC wygasa za ' || v_days || ' dni (' || to_char(v_due_date, 'DD.MM.YYYY') || ').'
        END,
        'Shield',
        v_due_date IS NULL OR v_days < 0,
        true,
        v_due_date,
        v_policy_id
      );

      v_reminder_key := CASE
        WHEN v_due_date IS NULL THEN 'missing:' || CURRENT_DATE::text
        WHEN v_days < 0 THEN 'overdue:' || CURRENT_DATE::text
        WHEN v_days = 0 THEN v_due_date::text || ':due'
        WHEN v_days <= 1 THEN v_due_date::text || ':1'
        WHEN v_days <= 3 THEN v_due_date::text || ':3'
        WHEN v_days <= 7 THEN v_due_date::text || ':7'
        WHEN v_days <= 14 THEN v_due_date::text || ':14'
        WHEN v_days <= 30 THEN v_due_date::text || ':30'
        ELSE v_due_date::text || ':60'
      END;
      v_title := CASE
        WHEN v_due_date IS NULL THEN 'Brak OC: ' || v_vehicle.name
        WHEN v_days < 0 THEN 'OC po terminie: ' || v_vehicle.name
        WHEN v_days = 0 THEN 'OC wygasa dzisiaj: ' || v_vehicle.name
        ELSE 'OC wygasa za ' || v_days || ' dni: ' || v_vehicle.name
      END;
      v_message := COALESCE(v_vehicle.registration_number || ' — ', '') ||
        CASE
          WHEN v_due_date IS NULL THEN 'Dodaj ważną polisę OC. Przypomnienie będzie ponawiane codziennie.'
          WHEN v_days < 0 THEN 'Polisa wygasła ' || abs(v_days) || ' dni temu. Dodaj odnowioną polisę OC.'
          WHEN v_days = 0 THEN 'Dodaj odnowioną polisę OC z nowym okresem obowiązywania.'
          ELSE 'Polisa jest ważna do ' || to_char(v_due_date, 'DD.MM.YYYY') || '.'
        END;
      v_notification_type := CASE WHEN v_due_date IS NULL OR v_days < 0 THEN 'error' ELSE 'warning' END;

      IF public.create_fleet_compliance_notification(
        v_vehicle.id, 'insurance_oc', v_policy_id, v_due_date, v_reminder_key,
        v_title, v_message, v_notification_type
      ) THEN
        v_created_count := v_created_count + 1;
      END IF;
    END IF;

    v_inspection_id := NULL;
    v_due_date := NULL;

    SELECT pi.id, pi.valid_until
    INTO v_inspection_id, v_due_date
    FROM public.periodic_inspections pi
    WHERE pi.vehicle_id = v_vehicle.id
      AND pi.inspection_type IN ('technical', 'emissions', 'technical_inspection')
      AND COALESCE(pi.passed, pi.result IS DISTINCT FROM 'failed', true) = true
    ORDER BY pi.valid_until DESC, pi.inspection_date DESC
    LIMIT 1;

    IF v_due_date IS NULL OR v_due_date <= CURRENT_DATE + 60 THEN
      v_days := CASE WHEN v_due_date IS NULL THEN NULL ELSE v_due_date - CURRENT_DATE END;

      INSERT INTO public.vehicle_alerts (
        vehicle_id, alert_type, priority, title, message, icon,
        is_blocking, is_active, due_date, related_id
      )
      VALUES (
        v_vehicle.id,
        'inspection',
        CASE
          WHEN v_due_date IS NULL OR v_days < 0 THEN 'critical'
          WHEN v_days <= 7 THEN 'high'
          WHEN v_days <= 30 THEN 'medium'
          ELSE 'low'
        END,
        CASE
          WHEN v_due_date IS NULL THEN 'Brak ważnego przeglądu'
          WHEN v_days < 0 THEN 'Przegląd po terminie'
          WHEN v_days = 0 THEN 'Przegląd wygasa dzisiaj'
          ELSE 'Zbliża się przegląd techniczny'
        END,
        CASE
          WHEN v_due_date IS NULL THEN 'Pojazd nie ma potwierdzonego ważnego przeglądu technicznego.'
          WHEN v_days < 0 THEN 'Przegląd wygasł ' || abs(v_days) || ' dni temu (' || to_char(v_due_date, 'DD.MM.YYYY') || ').'
          WHEN v_days = 0 THEN 'Ważność przeglądu kończy się dzisiaj (' || to_char(v_due_date, 'DD.MM.YYYY') || ').'
          ELSE 'Przegląd jest ważny jeszcze ' || v_days || ' dni, do ' || to_char(v_due_date, 'DD.MM.YYYY') || '.'
        END,
        'FileText',
        v_due_date IS NULL OR v_days < 0,
        true,
        v_due_date,
        v_inspection_id
      );

      v_reminder_key := CASE
        WHEN v_due_date IS NULL THEN 'missing:' || CURRENT_DATE::text
        WHEN v_days < 0 THEN 'overdue:' || CURRENT_DATE::text
        WHEN v_days = 0 THEN v_due_date::text || ':due'
        WHEN v_days <= 1 THEN v_due_date::text || ':1'
        WHEN v_days <= 3 THEN v_due_date::text || ':3'
        WHEN v_days <= 7 THEN v_due_date::text || ':7'
        WHEN v_days <= 14 THEN v_due_date::text || ':14'
        WHEN v_days <= 30 THEN v_due_date::text || ':30'
        ELSE v_due_date::text || ':60'
      END;
      v_title := CASE
        WHEN v_due_date IS NULL THEN 'Brak przeglądu: ' || v_vehicle.name
        WHEN v_days < 0 THEN 'Przegląd po terminie: ' || v_vehicle.name
        WHEN v_days = 0 THEN 'Przegląd wygasa dzisiaj: ' || v_vehicle.name
        ELSE 'Przegląd za ' || v_days || ' dni: ' || v_vehicle.name
      END;
      v_message := COALESCE(v_vehicle.registration_number || ' — ', '') ||
        CASE
          WHEN v_due_date IS NULL THEN 'Dodaj wykonany przegląd i datę kolejnego badania. Przypomnienie będzie ponawiane codziennie.'
          WHEN v_days < 0 THEN 'Przegląd wygasł ' || abs(v_days) || ' dni temu. Potwierdź wykonanie i podaj nową datę ważności.'
          WHEN v_days = 0 THEN 'Potwierdź wykonanie przeglądu i podaj nową datę ważności.'
          ELSE 'Przegląd jest ważny do ' || to_char(v_due_date, 'DD.MM.YYYY') || '.'
        END;
      v_notification_type := CASE WHEN v_due_date IS NULL OR v_days < 0 THEN 'error' ELSE 'warning' END;

      IF public.create_fleet_compliance_notification(
        v_vehicle.id, 'technical_inspection', v_inspection_id, v_due_date, v_reminder_key,
        v_title, v_message, v_notification_type
      ) THEN
        v_created_count := v_created_count + 1;
      END IF;
    END IF;
  END LOOP;

  PERFORM public.update_vehicle_status_from_alerts();

  DELETE FROM public.vehicle_compliance_reminder_log
  WHERE created_at < now() - INTERVAL '3 years';

  RETURN v_created_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_vehicle_compliance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_compliance() TO service_role;

-- Keep compatibility with the existing fleet UI, which invokes this function
-- after saving an insurance policy.
CREATE OR REPLACE FUNCTION public.generate_vehicle_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refresh_vehicle_compliance();
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_vehicle_alerts() TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_vehicle_compliance_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- refresh_vehicle_compliance updates an insurance row's derived status.
  -- Do not start another refresh from that nested update.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  PERFORM public.refresh_vehicle_compliance();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS refresh_compliance_after_insurance_change ON public.insurance_policies;
CREATE TRIGGER refresh_compliance_after_insurance_change
  AFTER INSERT OR UPDATE OR DELETE ON public.insurance_policies
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refresh_vehicle_compliance_after_change();

DROP TRIGGER IF EXISTS refresh_compliance_after_inspection_change ON public.periodic_inspections;
CREATE TRIGGER refresh_compliance_after_inspection_change
  AFTER INSERT OR UPDATE OR DELETE ON public.periodic_inspections
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refresh_vehicle_compliance_after_change();

-- Supabase Cron / pg_cron runs in GMT. 06:00 GMT means a morning reminder in Poland.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'refresh-fleet-compliance',
  '0 6 * * *',
  'SELECT public.refresh_vehicle_compliance();'
);

-- Populate current alerts immediately when the migration is deployed.
SELECT public.refresh_vehicle_compliance();

COMMENT ON FUNCTION public.refresh_vehicle_compliance() IS
  'Refreshes mandatory OC and technical-inspection alerts and emits deduplicated reminders.';
