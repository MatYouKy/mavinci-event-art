BEGIN;

-- Naprawa kolejności: 20260812162000_add_secure_mobile_fleet_operations nie była zastosowana na bazie
-- (stan z 31.10.2026), a późniejsza 20260812170000 nadpisała już can_record_vehicle_operation.
-- Zastosowanie 162000 po fakcie przywróciłoby starszą wersję funkcji — ta migracja ponownie
-- ustawia definicję z 20260812170000 (bez zmian). Uruchom PO 20260812162000.

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
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_handovers pickup
        WHERE pickup.vehicle_id = p_vehicle_id
          AND pickup.driver_id = auth.uid()
          AND pickup.usage_source = 'ad_hoc'
          AND pickup.handover_type = 'pickup'
          AND NOT EXISTS (
            SELECT 1
            FROM public.vehicle_handovers returned
            WHERE returned.usage_session_id = pickup.usage_session_id
              AND returned.handover_type = 'return'
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_record_vehicle_operation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_record_vehicle_operation(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
