-- A salesperson's assigned records remain readable with view/create permission only.
DO $$ DECLARE d text; before_filter text; BEGIN
 SELECT pg_get_functiondef('public.current_employee_can_view_event(uuid)'::regprocedure) INTO d;
 IF position('has_direct_access :=' in d)=0 THEN RAISE EXCEPTION 'Unsupported event visibility helper'; END IF;
 d:=replace(d,'has_direct_access :=',E'has_direct_access :=\n    (employee_permissions && ARRAY[''events_view'',''events_create'',''events_manage'']\n     AND public.crm_record_owned(''events'',to_jsonb(event_row))) OR');
 EXECUTE d;
 SELECT pg_get_functiondef('public.get_events_list(timestamptz,timestamptz,text[])'::regprocedure) INTO d;
 before_filter:=E'AND (\nhas_full_access = true\nOR e.created_by = current_user_id\nOR EXISTS (\nSELECT 1\nFROM employee_assignments ea\nWHERE ea.event_id = e.id\nAND ea.employee_id = current_user_id\n)\n)';
 IF position(before_filter in d)=0 THEN RAISE EXCEPTION 'Unsupported calendar visibility filter'; END IF;
 EXECUTE replace(d,before_filter,'AND public.current_employee_can_view_event(e.id)');
END $$;
CREATE POLICY crm_owned_offer_read ON public.offers FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.sales_employee_id()
 AND coalesce(e.permissions,'{}') && ARRAY['offers_view','offers_create','offers_manage']
 AND public.crm_record_owned('offers',to_jsonb(offers.*))));
NOTIFY pgrst,'reload schema';
