CREATE OR REPLACE FUNCTION public.get_event_responsibility_team(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT (public.current_employee_can_view_event(p_event_id) OR public.is_realization_manager(p_event_id) OR public.can_direct_realization(p_event_id)) THEN
  RAISE EXCEPTION 'Brak dostępu do zespołu wydarzenia.' USING ERRCODE='42501';
 END IF;
 RETURN (
 WITH responsibilities AS (
  SELECT employee.id employee_id,'Autor / opiekun wydarzenia' label,'accepted' status
  FROM public.events ev JOIN public.employees employee ON ev.created_by IN (employee.id,employee.auth_user_id) WHERE ev.id=p_event_id
  UNION ALL
  SELECT employee.id,'Sprzedawca','accepted' FROM public.offers o JOIN public.employees employee ON o.created_by IN (employee.id,employee.auth_user_id)
  WHERE o.event_id=p_event_id AND o.status::text='accepted'
  UNION ALL
  SELECT p.employee_id,'Sprzedawca polecający','accepted' FROM public.events ev JOIN public.sales_partner_profiles p ON p.id=ev.referring_sales_partner_id WHERE ev.id=p_event_id AND p.employee_id IS NOT NULL
  UNION ALL
  SELECT accepted_by,'Przygotowanie magazynu','accepted' FROM public.event_warehouse_handoffs WHERE event_id=p_event_id AND accepted_at IS NOT NULL
  UNION ALL
  SELECT manager_id,'Kierownik realizacji','accepted' FROM public.event_realizations WHERE event_id=p_event_id
  UNION ALL
  SELECT driver_id,'Kierowca',coalesce(invitation_status,'pending') FROM public.event_vehicles WHERE event_id=p_event_id AND coalesce(status,'planned')<>'cancelled' AND driver_id IS NOT NULL AND coalesce(invitation_status,'pending')<>'rejected'
 ), grouped AS (
 SELECT employee_id,array_agg(DISTINCT label ORDER BY label) roles,
 CASE WHEN bool_and(status='accepted') THEN 'accepted' ELSE 'pending' END status
 FROM responsibilities WHERE employee_id IS NOT NULL GROUP BY employee_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id','responsibility-'||employee.id,'employee_id',employee.id,'status',g.status,
 'responsibility_roles',g.roles,'automatic_member',true,
 'employee',jsonb_build_object('id',employee.id,'name',employee.name,'surname',employee.surname,'phone_number',employee.phone_number,'email',employee.email)
 ) ORDER BY employee.surname,employee.name),'[]'::jsonb)
 FROM grouped g JOIN public.employees employee ON employee.id=g.employee_id WHERE employee.is_active
 );
END $$;
REVOKE ALL ON FUNCTION public.get_event_responsibility_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_responsibility_team(uuid) TO authenticated;
-- Driver readiness applies only to active transport assignments.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.event_workflow_requirement_is_met(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'  CASE requirement_key', $guard$
  IF requirement_key IN ('driver_assigned','drivers_assigned') THEN
   RETURN NOT EXISTS(SELECT 1 FROM public.event_vehicles v WHERE v.event_id=p_event_id AND coalesce(v.status,'planned')<>'cancelled' AND v.driver_id IS NULL);
  END IF;
  CASE requirement_key$guard$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
