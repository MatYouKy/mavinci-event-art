CREATE OR REPLACE FUNCTION public.can_direct_realization(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.crm_record_id_scope_allows('events',p_event_id) AND EXISTS(
 SELECT 1 FROM public.events e JOIN public.employees employee ON employee.id=public.sales_employee_id()
 WHERE e.id=p_event_id AND employee.is_active AND public.employee_can_access_company(employee.id,e.my_company_id)
 AND (employee.role='admin' OR employee.access_level='admin' OR e.created_by IN (employee.id,employee.auth_user_id)
 OR 'events_manage'=ANY(coalesce(employee.permissions,'{}'))));
$$;
NOTIFY pgrst,'reload schema';
