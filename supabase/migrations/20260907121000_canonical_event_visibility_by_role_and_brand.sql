/*
  # Jedna reguła widoczności wydarzeń

  Zachowuje dotychczasową administrację i przypisania, a dodatkowo:
  - ogranicza widoczność do marek pracownika,
  - udostępnia magazynowi planowanie od wysłania oferty,
  - nie ukrywa wydarzenia po przejściu z offer_accepted do dalszych etapów.
*/

CREATE OR REPLACE FUNCTION public.event_visibility_stage(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_status IN ('inquiry', 'offer_to_send') THEN 'sales'
    WHEN p_status = 'offer_sent' THEN 'planning'
    WHEN p_status IN ('offer_accepted', 'in_preparation', 'ready_for_live', 'ready_for_execution', 'in_progress') THEN 'operational'
    WHEN p_status IN ('completed', 'invoiced', 'settled') THEN 'archive'
    WHEN p_status = 'cancelled' THEN 'cancelled'
    ELSE 'sales'
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.id = auth.uid()
     OR employee.auth_user_id = auth.uid()
  ORDER BY (employee.id = auth.uid()) DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.employee_can_access_company(
  p_employee_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT
      employee.role = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR employee.company_access_mode = 'all'
      OR p_company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
    FROM public.employees employee
    WHERE employee.id = p_employee_id
       OR employee.auth_user_id = p_employee_id
    ORDER BY (employee.id = p_employee_id) DESC
    LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.current_employee_can_access_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.employee_can_access_company(public.current_employee_id(), p_company_id);
$$;

CREATE OR REPLACE FUNCTION public.current_employee_can_view_event(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_row public.employees%ROWTYPE;
  event_row public.events%ROWTYPE;
  employee_permissions text[];
  visibility_stage text;
  has_direct_access boolean;
BEGIN
  SELECT * INTO employee_row
  FROM public.employees employee
  WHERE employee.id = auth.uid()
     OR employee.auth_user_id = auth.uid()
  ORDER BY (employee.id = auth.uid()) DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO event_row
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN RETURN false; END IF;

  employee_permissions := COALESCE(employee_row.permissions, '{}'::text[]);

  IF employee_row.role = 'admin' OR 'admin' = ANY(employee_permissions) THEN
    RETURN true;
  END IF;

  has_direct_access :=
    event_row.created_by IN (employee_row.id, employee_row.auth_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.employee_assignments assignment
      WHERE assignment.event_id = event_row.id
        AND assignment.employee_id = employee_row.id
        AND assignment.status = 'accepted'
    );

  -- Starsze wydarzenia bez marki pozostają dostępne tylko dla autora lub
  -- przypisanego pracownika. Nowe wydarzenia pracownika z zakresem selected
  -- muszą już wskazać markę.
  IF event_row.my_company_id IS NULL AND has_direct_access THEN
    RETURN true;
  END IF;

  IF NOT public.employee_can_access_company(employee_row.id, event_row.my_company_id) THEN
    RETURN false;
  END IF;

  IF 'events_manage' = ANY(employee_permissions)
     OR 'calendar_manage' = ANY(employee_permissions) THEN
    RETURN true;
  END IF;

  IF has_direct_access THEN
    RETURN true;
  END IF;

  visibility_stage := public.event_visibility_stage(event_row.status::text);

  IF 'events_view_planning' = ANY(employee_permissions) THEN
    RETURN visibility_stage IN ('planning', 'operational', 'archive');
  END IF;

  IF 'events_view_operational' = ANY(employee_permissions)
     OR 'calendar_view_accepted_only' = ANY(employee_permissions) THEN
    RETURN visibility_stage IN ('operational', 'archive');
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_can_access_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_employee_can_access_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_employee_can_view_event(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.employee_can_access_company(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_employee_can_access_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_employee_can_view_event(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view events based on calendar permissions" ON public.events;
DROP POLICY IF EXISTS "Users can view events based on canonical visibility" ON public.events;

CREATE POLICY "Users can view events based on canonical visibility"
ON public.events
FOR SELECT
TO authenticated
USING (public.current_employee_can_view_event(events.id));

COMMENT ON FUNCTION public.current_employee_can_view_event(uuid) IS
'Jedno źródło widoczności wydarzenia: rola, marka, przypisanie i etap sprzedażowy/operacyjny.';
