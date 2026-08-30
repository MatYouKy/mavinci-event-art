/*
  Weryfikacja dostępności pojedynczego modelu sprzętu.

  Funkcja nie zwraca globalnego katalogu ani danych wydarzeń. Jest używana jako
  bezpieczna korekta dla modeli ewidencjonowanych ilościowo bez equipment_units.
*/

CREATE OR REPLACE FUNCTION public.check_single_equipment_availability_for_event(
  p_event_id uuid,
  p_equipment_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  total_quantity integer,
  reserved_quantity integer,
  available_quantity integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer := 0;
  v_reserved integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.employees actor
    WHERE actor.auth_user_id = auth.uid()
      AND (
        actor.role::text = 'admin'
        OR 'admin' = ANY(COALESCE(actor.permissions, ARRAY[]::text[]))
        OR 'equipment_manage' = ANY(COALESCE(actor.permissions, ARRAY[]::text[]))
        OR 'events_manage' = ANY(COALESCE(actor.permissions, ARRAY[]::text[]))
        OR EXISTS (
          SELECT 1
          FROM public.events event
          WHERE event.id = p_event_id
            AND event.created_by = actor.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.employee_assignments assignment
          WHERE assignment.event_id = p_event_id
            AND assignment.employee_id = actor.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to check equipment availability'
      USING ERRCODE = '42501';
  END IF;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.equipment_units unit WHERE unit.equipment_id = p_equipment_id
    ) THEN (
      SELECT COUNT(*)::integer
      FROM public.equipment_units unit
      WHERE unit.equipment_id = p_equipment_id
        AND unit.status::text IN ('available', 'reserved', 'in_use')
    )
    ELSE GREATEST(COALESCE(item.total_quantity, 0), 0)::integer
  END
  INTO v_total
  FROM public.equipment_items item
  WHERE item.id = p_equipment_id;

  WITH overlapping_events AS (
    SELECT event.id
    FROM public.events event
    WHERE event.id <> p_event_id
      AND COALESCE(event.status::text, '') <> 'cancelled'
      AND event.event_date < p_end_date
      AND COALESCE(event.event_end_date, event.event_date + interval '1 day') > p_start_date
  ),
  direct_reservations AS (
    SELECT COALESCE(SUM(reservation.quantity), 0)::integer AS quantity
    FROM public.event_equipment reservation
    WHERE reservation.event_id IN (SELECT id FROM overlapping_events)
      AND reservation.equipment_id = p_equipment_id
      AND COALESCE(reservation.status::text, 'reserved') IN ('reserved', 'in_use')
  ),
  kit_reservations AS (
    SELECT COALESCE(SUM(reservation.quantity * kit_item.quantity), 0)::integer AS quantity
    FROM public.event_equipment reservation
    JOIN public.equipment_kit_items kit_item ON kit_item.kit_id = reservation.kit_id
    WHERE reservation.event_id IN (SELECT id FROM overlapping_events)
      AND kit_item.equipment_id = p_equipment_id
      AND COALESCE(reservation.status::text, 'reserved') IN ('reserved', 'in_use')
  )
  SELECT direct.quantity + kit.quantity
  INTO v_reserved
  FROM direct_reservations direct
  CROSS JOIN kit_reservations kit;

  RETURN QUERY SELECT
    COALESCE(v_total, 0),
    COALESCE(v_reserved, 0),
    GREATEST(COALESCE(v_total, 0) - COALESCE(v_reserved, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.check_single_equipment_availability_for_event(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_single_equipment_availability_for_event(uuid, uuid, timestamptz, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION public.check_single_equipment_availability_for_event(uuid, uuid, timestamptz, timestamptz) IS
  'Returns counts for one equipment model and one accessible event; includes direct and kit reservations.';
