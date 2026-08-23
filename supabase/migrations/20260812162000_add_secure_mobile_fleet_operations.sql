/*
  # Secure mobile fleet operations

  - drivers can record fuel only for vehicles assigned to them
  - fleet managers can record fuel for every vehicle
  - damage and repair suggestions are stored separately from completed repairs
  - every new report creates an active vehicle alert for fleet managers
*/

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
]
WHERE id = 'fuel-receipts';

CREATE TABLE IF NOT EXISTS public.vehicle_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  event_vehicle_id uuid REFERENCES public.event_vehicles(id) ON DELETE SET NULL,
  reported_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  report_type text NOT NULL CHECK (report_type IN ('damage', 'suggestion')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 4000),
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'planned', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_reports_vehicle_status
  ON public.vehicle_reports(vehicle_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_reports_reported_by
  ON public.vehicle_reports(reported_by, created_at DESC);

ALTER TABLE public.vehicle_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fleet users can view vehicle reports" ON public.vehicle_reports;
CREATE POLICY "Fleet users can view vehicle reports"
  ON public.vehicle_reports
  FOR SELECT TO authenticated
  USING (
    reported_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (
          employee.role IN ('admin', 'manager')
          OR employee.access_level IN ('admin', 'manager')
          OR 'fleet_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "Vehicle reports are inserted through secure RPC" ON public.vehicle_reports;
CREATE POLICY "Vehicle reports are inserted through secure RPC"
  ON public.vehicle_reports
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Fleet managers can update vehicle reports" ON public.vehicle_reports;
CREATE POLICY "Fleet managers can update vehicle reports"
  ON public.vehicle_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "Fleet managers can delete vehicle reports" ON public.vehicle_reports;
CREATE POLICY "Fleet managers can delete vehicle reports"
  ON public.vehicle_reports
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.can_record_vehicle_operation(
  p_vehicle_id uuid,
  p_event_vehicle_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.employees employee
        WHERE employee.id = auth.uid()
          AND (
            employee.role = 'admin'
            OR employee.access_level = 'admin'
            OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_assignments assignment
        WHERE assignment.vehicle_id = p_vehicle_id
          AND assignment.employee_id = auth.uid()
          AND assignment.status = 'active'
      )
      OR EXISTS (
        SELECT 1
        FROM public.event_vehicles assignment
        WHERE assignment.vehicle_id = p_vehicle_id
          AND assignment.driver_id = auth.uid()
          AND assignment.status NOT IN ('completed', 'cancelled')
          AND (p_event_vehicle_id IS NULL OR assignment.id = p_event_vehicle_id)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.record_vehicle_fuel_entry(
  p_vehicle_id uuid,
  p_event_vehicle_id uuid,
  p_liters numeric,
  p_price_per_liter numeric,
  p_odometer_reading integer,
  p_payment_method text DEFAULT NULL,
  p_receipt_path text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.fuel_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_mileage integer;
  v_entry public.fuel_entries%ROWTYPE;
BEGIN
  IF NOT public.can_record_vehicle_operation(p_vehicle_id, p_event_vehicle_id) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do zapisania tankowania dla tego pojazdu.';
  END IF;

  IF p_liters IS NULL OR p_liters <= 0 OR p_liters > 1000 THEN
    RAISE EXCEPTION 'Podaj prawidłową ilość paliwa.';
  END IF;

  IF p_price_per_liter IS NULL OR p_price_per_liter <= 0 OR p_price_per_liter > 1000 THEN
    RAISE EXCEPTION 'Podaj prawidłową cenę jednostkową.';
  END IF;

  SELECT current_mileage
  INTO v_current_mileage
  FROM public.vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono pojazdu.';
  END IF;

  IF p_odometer_reading IS NULL OR p_odometer_reading < COALESCE(v_current_mileage, 0) THEN
    RAISE EXCEPTION 'Stan licznika nie może być niższy niż ostatnio zapisany przebieg (% km).',
      COALESCE(v_current_mileage, 0);
  END IF;

  INSERT INTO public.fuel_entries (
    vehicle_id,
    date,
    time,
    odometer_reading,
    fuel_type,
    liters,
    price_per_liter,
    total_cost,
    payment_method,
    receipt_url,
    filled_by,
    notes
  ) VALUES (
    p_vehicle_id,
    CURRENT_DATE,
    LOCALTIME,
    p_odometer_reading,
    'other',
    round(p_liters, 2),
    round(p_price_per_liter, 2),
    round(p_liters * p_price_per_liter, 2),
    NULLIF(btrim(p_payment_method), ''),
    NULLIF(btrim(p_receipt_path), ''),
    auth.uid(),
    NULLIF(btrim(p_notes), '')
  )
  RETURNING * INTO v_entry;

  UPDATE public.vehicles
  SET current_mileage = GREATEST(COALESCE(current_mileage, 0), p_odometer_reading),
      updated_at = now()
  WHERE id = p_vehicle_id;

  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_vehicle_issue(
  p_vehicle_id uuid,
  p_event_vehicle_id uuid,
  p_report_type text,
  p_title text,
  p_description text,
  p_severity text DEFAULT 'medium'
)
RETURNS public.vehicle_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.vehicle_reports%ROWTYPE;
BEGIN
  IF NOT public.can_record_vehicle_operation(p_vehicle_id, p_event_vehicle_id) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do zgłoszenia uwagi dla tego pojazdu.';
  END IF;

  IF p_report_type NOT IN ('damage', 'suggestion') THEN
    RAISE EXCEPTION 'Nieprawidłowy typ zgłoszenia.';
  END IF;

  IF p_severity NOT IN ('low', 'medium', 'high', 'critical') THEN
    RAISE EXCEPTION 'Nieprawidłowy priorytet zgłoszenia.';
  END IF;

  INSERT INTO public.vehicle_reports (
    vehicle_id,
    event_vehicle_id,
    reported_by,
    report_type,
    title,
    description,
    severity
  ) VALUES (
    p_vehicle_id,
    p_event_vehicle_id,
    auth.uid(),
    p_report_type,
    btrim(p_title),
    btrim(p_description),
    p_severity
  )
  RETURNING * INTO v_report;

  INSERT INTO public.vehicle_alerts (
    vehicle_id,
    alert_type,
    priority,
    title,
    message,
    icon,
    is_blocking,
    related_id
  ) VALUES (
    p_vehicle_id,
    CASE WHEN p_report_type = 'damage' THEN 'repair' ELSE 'other' END,
    p_severity,
    CASE WHEN p_report_type = 'damage' THEN 'Nowa szkoda: ' ELSE 'Sugestia kierowcy: ' END
      || btrim(p_title),
    btrim(p_description),
    CASE WHEN p_report_type = 'damage' THEN 'AlertTriangle' ELSE 'Wrench' END,
    p_report_type = 'damage' AND p_severity = 'critical',
    v_report.id
  );

  RETURN v_report;
END;
$$;

-- Receipt files are private and scoped to the vehicle UUID in the first path segment.
DROP POLICY IF EXISTS "Authenticated users can upload fuel receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view fuel receipts" ON storage.objects;
DROP POLICY IF EXISTS "Fleet managers can delete fuel receipts" ON storage.objects;

CREATE POLICY "Authorized drivers can upload fuel receipts"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fuel-receipts'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.can_record_vehicle_operation(((storage.foldername(name))[1])::uuid, NULL)
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.employees employee
        WHERE employee.id = auth.uid()
          AND (
            employee.role = 'admin'
            OR employee.access_level = 'admin'
            OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      )
    )
  );

CREATE POLICY "Authorized fleet users can view fuel receipts"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'fuel-receipts'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (
      public.can_record_vehicle_operation(((storage.foldername(name))[1])::uuid, NULL)
      OR EXISTS (
        SELECT 1
        FROM public.employees employee
        WHERE employee.id = auth.uid()
          AND employee.is_active = true
          AND (
            employee.role IN ('admin', 'manager')
            OR employee.access_level IN ('admin', 'manager')
            OR 'fleet_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
            OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      )
    )
  );

CREATE POLICY "Owners and fleet managers can delete fuel receipts securely"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'fuel-receipts'
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.employees employee
        WHERE employee.id = auth.uid()
          AND employee.is_active = true
          AND (
            employee.role = 'admin'
            OR employee.access_level = 'admin'
            OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      )
    )
  );

REVOKE ALL ON FUNCTION public.can_record_vehicle_operation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_vehicle_fuel_entry(uuid, uuid, numeric, numeric, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_vehicle_issue(uuid, uuid, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_vehicle_fuel_entry(uuid, uuid, numeric, numeric, integer, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_vehicle_issue(uuid, uuid, text, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_record_vehicle_operation(uuid, uuid)
  TO authenticated;

ALTER TABLE public.vehicle_reports REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vehicle_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_reports;
  END IF;
END;
$$;
