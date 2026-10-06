ALTER TABLE public.event_warehouse_handoffs
 ADD COLUMN ready_at timestamptz,
 ADD COLUMN ready_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 ADD COLUMN ready_by_name text;

CREATE TABLE public.event_realizations (
 event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 manager_name text,
 appointed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 appointed_at timestamptz,
 started_at timestamptz,
 started_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 completed_at timestamptz,
 completed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 completion_notes text CHECK(length(completion_notes)<=5000)
);
ALTER TABLE public.event_realizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_realizations FROM anon,authenticated;
GRANT SELECT ON public.event_realizations TO authenticated;
CREATE OR REPLACE FUNCTION public.is_realization_manager(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_realizations r JOIN public.employees employee ON employee.id=r.manager_id
 JOIN public.events e ON e.id=r.event_id WHERE r.event_id=p_event_id AND employee.id=public.sales_employee_id()
 AND employee.is_active AND public.employee_can_access_company(employee.id,e.my_company_id));
$$;
CREATE OR REPLACE FUNCTION public.can_direct_realization(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.events e JOIN public.employees employee ON employee.id=public.sales_employee_id()
 WHERE e.id=p_event_id AND employee.is_active AND public.employee_can_access_company(employee.id,e.my_company_id)
 AND (employee.role='admin' OR employee.access_level='admin' OR e.created_by IN (employee.id,employee.auth_user_id)
 OR 'events_manage'=ANY(coalesce(employee.permissions,'{}'))));
$$;
CREATE OR REPLACE FUNCTION public.realization_operational_only(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.is_realization_manager(p_event_id) AND NOT public.can_direct_realization(p_event_id)
 AND NOT EXISTS(SELECT 1 FROM public.employees employee WHERE employee.id=public.sales_employee_id()
 AND coalesce(employee.permissions,'{}') && ARRAY['offers_view','offers_create','offers_manage','finances_view','finances_manage','invoices_view','invoices_create','invoices_manage','contracts_view','contracts_manage']);
$$;
CREATE POLICY realization_read ON public.event_realizations FOR SELECT TO authenticated
 USING(public.is_realization_manager(event_id) OR public.current_employee_can_view_event(event_id));
REVOKE ALL ON FUNCTION public.is_realization_manager(uuid),public.can_direct_realization(uuid),public.realization_operational_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_realization_manager(uuid),public.can_direct_realization(uuid),public.realization_operational_only(uuid) TO authenticated;

-- Presentation only: financial status is never rewritten by warehouse completion.
CREATE OR REPLACE FUNCTION public.get_event_operational_states(p_event_ids uuid[])
RETURNS TABLE(event_id uuid,status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT e.id, CASE
 WHEN e.status::text='cancelled' THEN 'cancelled'
 WHEN e.status::text='settled' THEN 'settled'
 WHEN e.status::text IN ('inquiry','offer_to_send','offer_sent') THEN 'inquiry'
 WHEN r.completed_at IS NOT NULL OR e.status::text='completed' OR (e.status::text='invoiced' AND e.event_end_date<=now()) THEN 'completed'
 WHEN r.started_at IS NOT NULL OR e.status::text='in_progress' THEN 'in_progress'
 WHEN h.ready_at IS NOT NULL OR e.status::text IN ('ready_for_live','ready_for_execution') THEN 'ready_for_live'
 WHEN h.accepted_at IS NOT NULL OR e.status::text='in_preparation' THEN 'in_preparation'
 ELSE 'offer_accepted' END
 FROM public.events e
 LEFT JOIN public.event_realizations r ON r.event_id=e.id
 LEFT JOIN public.event_warehouse_handoffs h ON h.event_id=e.id
 WHERE e.id=ANY(p_event_ids);
$$;
REVOKE ALL ON FUNCTION public.get_event_operational_states(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_operational_states(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_warehouse_event(p_event_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.sales_employee_id(); actor_name text; h public.event_warehouse_handoffs%ROWTYPE; stage text;
BEGIN
 IF actor IS NULL OR NOT public.can_receive_warehouse_event(p_event_id) THEN
 RAISE EXCEPTION 'Nie masz uprawnień do przygotowania tej realizacji.' USING ERRCODE='42501'; END IF;
 IF p_action <> 'ready' OR p_action IS NULL THEN
 RAISE EXCEPTION 'Nieprawidłowa czynność magazynu.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id FOR UPDATE;
 INSERT INTO public.event_warehouse_handoffs(event_id) VALUES(p_event_id) ON CONFLICT DO NOTHING;
 SELECT * INTO h FROM public.event_warehouse_handoffs WHERE event_id=p_event_id FOR UPDATE;
 IF h.ready_at IS NOT NULL THEN RETURN to_jsonb(h); END IF;
 SELECT s.status INTO stage FROM public.get_event_operational_states(ARRAY[p_event_id]) s;
 SELECT coalesce(nullif(concat_ws(' ',name,surname),''),nickname,'Pracownik magazynu') INTO actor_name FROM public.employees WHERE id=actor;
 IF p_action='ready' THEN
   IF stage<>'in_preparation' THEN RAISE EXCEPTION 'Najpierw przyjmij realizację do przygotowania.' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.event_realizations r JOIN public.employees employee ON employee.id=r.manager_id AND employee.is_active WHERE r.event_id=p_event_id) THEN RAISE EXCEPTION 'Autor musi wyznaczyć kierownika realizacji w zakładce Zespół.' USING ERRCODE='22023'; END IF;
   UPDATE public.event_warehouse_handoffs SET ready_at=clock_timestamp(),ready_by=actor,ready_by_name=actor_name WHERE event_id=p_event_id RETURNING * INTO h;
 END IF;
 RETURN to_jsonb(h);
END $$;
REVOKE ALL ON FUNCTION public.advance_warehouse_event(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_warehouse_event(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.appoint_realization_manager(p_event_id uuid,p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result public.event_realizations%ROWTYPE; ev public.events%ROWTYPE; label text;
BEGIN
 IF NOT public.can_direct_realization(p_event_id) THEN RAISE EXCEPTION 'Tylko autor lub osoba zarządzająca wydarzeniem może wyznaczyć kierownika.' USING ERRCODE='42501'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF ev.status::text IN ('cancelled','completed','invoiced','settled') THEN RAISE EXCEPTION 'Nie można zmienić kierownika zakończonej realizacji.' USING ERRCODE='22023'; END IF;
 SELECT concat_ws(' ',e.name,e.surname) INTO label FROM public.employees e
 WHERE e.id=p_employee_id AND e.is_active AND public.employee_can_access_company(e.id,ev.my_company_id)
 AND EXISTS(SELECT 1 FROM public.employee_assignments a WHERE a.employee_id=e.id AND a.event_id=p_event_id AND a.status='accepted');
 IF label IS NULL THEN RAISE EXCEPTION 'Wybierz aktywnego pracownika, który przyjął zaproszenie do zespołu.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.event_realizations(event_id,manager_id,manager_name,appointed_by,appointed_at)
 VALUES(p_event_id,p_employee_id,label,public.sales_employee_id(),now())
 ON CONFLICT(event_id) DO UPDATE SET manager_id=excluded.manager_id,manager_name=excluded.manager_name,appointed_by=excluded.appointed_by,appointed_at=excluded.appointed_at
 WHERE event_realizations.completed_at IS NULL RETURNING * INTO result;
 IF result.event_id IS NULL THEN RAISE EXCEPTION 'Realizacja jest już zakończona.' USING ERRCODE='22023'; END IF;
 RETURN to_jsonb(result);
END $$;
CREATE OR REPLACE FUNCTION public.advance_realization(p_event_id uuid,p_action text,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.event_realizations%ROWTYPE; ev public.events%ROWTYPE;
BEGIN
 IF NOT public.is_realization_manager(p_event_id) THEN RAISE EXCEPTION 'Tylko wyznaczony kierownik może przejąć lub zakończyć realizację.' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('start','complete') THEN RAISE EXCEPTION 'Nieprawidłowa czynność.' USING ERRCODE='22023'; END IF;
 IF length(p_notes)>5000 THEN RAISE EXCEPTION 'Uwagi mogą mieć najwyżej 5000 znaków.' USING ERRCODE='22023'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 SELECT * INTO r FROM public.event_realizations WHERE event_id=p_event_id FOR UPDATE;
 IF ev.status::text='cancelled' THEN RAISE EXCEPTION 'Wydarzenie anulowano.' USING ERRCODE='22023'; END IF;
 IF p_action='start' THEN
  IF r.started_at IS NOT NULL THEN RETURN to_jsonb(r); END IF;
  IF ev.status::text NOT IN ('offer_accepted','in_preparation','ready_for_live','in_progress') THEN RAISE EXCEPTION 'Wydarzenie nie jest gotowe do przejęcia.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=p_event_id AND h.ready_at IS NOT NULL)
     AND ev.status::text NOT IN ('ready_for_live','in_progress') THEN RAISE EXCEPTION 'Magazyn musi najpierw potwierdzić gotowość do realizacji.' USING ERRCODE='22023'; END IF;
  UPDATE public.event_realizations SET started_at=clock_timestamp(),started_by=public.sales_employee_id() WHERE event_id=p_event_id RETURNING * INTO r;
  UPDATE public.events SET status='in_progress' WHERE id=p_event_id;
 ELSE
  IF r.completed_at IS NOT NULL THEN RETURN to_jsonb(r); END IF;
  IF r.started_at IS NULL THEN RAISE EXCEPTION 'Najpierw przejmij realizację.' USING ERRCODE='22023'; END IF;
  UPDATE public.event_realizations SET completed_at=clock_timestamp(),completed_by=public.sales_employee_id(),completion_notes=nullif(trim(p_notes),'') WHERE event_id=p_event_id RETURNING * INTO r;
  UPDATE public.events SET status='completed' WHERE id=p_event_id AND status::text NOT IN ('invoiced','settled');
 END IF;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.appoint_realization_manager(uuid,uuid),public.advance_realization(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.appoint_realization_manager(uuid,uuid),public.advance_realization(uuid,text,text) TO authenticated;

-- Narrow operational payload; appointing a manager never grants commercial permissions.
CREATE OR REPLACE FUNCTION public.get_realization_workspace(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_realization_manager(p_event_id) AND NOT public.can_direct_realization(p_event_id) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'id',e.id,'name',e.name,'description',e.description,'event_date',e.event_date,'event_end_date',e.event_end_date,
 'status',(SELECT s.status FROM public.get_event_operational_states(ARRAY[e.id]) s),
 'operational_only',public.realization_operational_only(e.id),
 'is_manager',public.is_realization_manager(e.id),
 'realization',(SELECT to_jsonb(r) FROM public.event_realizations r WHERE r.event_id=e.id),
 'location',jsonb_build_object('name',l.name,'address',coalesce(l.formatted_address,l.address),'city',l.city,'notes',l.notes,'technical_details',l.technical_details,'rooms',l.rooms,'selected_rooms',e.location_room_ids,'stage_room_id',e.stage_room_id,'contact_name',l.contact_person_name,'phone',l.contact_phone),
 'contact',jsonb_build_object('name',c.full_name,'phone',coalesce(c.phone,c.business_phone),'email',c.email),
 'phases',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'start',p.start_time,'end',p.end_time) ORDER BY p.sequence_order),'[]') FROM public.event_phases p WHERE p.event_id=e.id),
 'agenda',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'time',i.time,'title',i.title,'description',i.description) ORDER BY i.order_index),'[]') FROM public.event_agendas a JOIN public.event_agenda_items i ON i.agenda_id=a.id WHERE a.event_id=e.id),
 'agenda_notes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'content',n.content) ORDER BY n.order_index),'[]') FROM public.event_agendas a JOIN public.event_agenda_notes n ON n.agenda_id=a.id WHERE a.event_id=e.id),
 'vehicles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',coalesce(f.name,v.external_company_name),'role',v.role,'departure',v.departure_time,'arrival',v.arrival_time,'return',v.return_arrival_time,'origin',v.departure_location,'driver',concat_ws(' ',d.name,d.surname),'notes',v.notes)),'[]') FROM public.event_vehicles v LEFT JOIN public.vehicles f ON f.id=v.vehicle_id LEFT JOIN public.employees d ON d.id=v.driver_id WHERE v.event_id=e.id),
 'subcontractors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.task_name,'scope',s.scope_of_work,'deliverables',s.deliverables,'guidelines',s.guidelines,'notes',s.operational_notes,'start',s.scheduled_start,'end',s.scheduled_end,'contact_name',coalesce(s.contact_name_snapshot,sub.contact_person,sub.company_name),'phone',coalesce(s.contact_phone_snapshot,sub.phone),'email',coalesce(s.contact_email_snapshot,sub.email))),'[]') FROM public.subcontractor_tasks s LEFT JOIN public.subcontractors sub ON sub.id=s.subcontractor_id WHERE s.event_id=e.id),
 'files',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',coalesce(f.name,f.original_name,f.file_name),'path',f.file_path,'url',f.file_url)),'[]') FROM public.event_files f WHERE f.event_id=e.id AND f.folder_id IS NULL AND NOT public.is_sensitive_event_document(f.document_type))
 ) INTO result FROM public.events e LEFT JOIN public.locations l ON l.id=e.location_id LEFT JOIN public.contacts c ON c.id=e.contact_person_id WHERE e.id=p_event_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_realization_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_realization_workspace(uuid) TO authenticated;

-- Existing table policies may allow full records to participants. For a leader with
-- operational access only, serve the whitelisted workspace instead of financial rows.
CREATE POLICY realization_operational_event_read ON public.events AS RESTRICTIVE FOR SELECT TO authenticated
 USING(NOT public.realization_operational_only(id));
CREATE POLICY realization_operational_vehicle_read ON public.event_vehicles AS RESTRICTIVE FOR SELECT TO authenticated
 USING(NOT public.realization_operational_only(event_id));
CREATE POLICY realization_operational_subcontractor_read ON public.subcontractor_tasks AS RESTRICTIVE FOR SELECT TO authenticated
 USING(NOT public.realization_operational_only(event_id));

-- Calendar/list RPC uses its existing visibility check, with an explicit, brand-scoped
-- exception for the appointed manager and no financial fields for that role.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.get_events_list(timestamptz,timestamptz,text[])'::regprocedure) INTO d;
 d:=replace(d,'public.crm_record_id_scope_allows(''events'',e.id)','(public.crm_record_id_scope_allows(''events'',e.id) OR public.is_realization_manager(e.id))');
 d:=replace(d,'AND public.current_employee_can_view_event(e.id)','AND (public.current_employee_can_view_event(e.id) OR public.is_realization_manager(e.id))');
 d:=replace(d,'''budget'', e.budget','''budget'', CASE WHEN public.realization_operational_only(e.id) THEN NULL ELSE e.budget END');
 d:=replace(d,'''final_cost'', e.final_cost','''final_cost'', CASE WHEN public.realization_operational_only(e.id) THEN NULL ELSE e.final_cost END');
 d:=replace(d,'''notes'', e.notes','''notes'', CASE WHEN public.realization_operational_only(e.id) THEN NULL ELSE e.notes END');
 EXECUTE d;
END $$;
CREATE OR REPLACE FUNCTION public.get_my_realizations()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'event_date',e.event_date,'event_end_date',e.event_end_date,'status',e.status,
 'operational_status',(SELECT s.status FROM public.get_event_operational_states(ARRAY[e.id]) s),'location_name',l.name)),'[]')
 FROM public.event_realizations r JOIN public.events e ON e.id=r.event_id LEFT JOIN public.locations l ON l.id=e.location_id
 WHERE public.is_realization_manager(e.id);
$$;
REVOKE ALL ON FUNCTION public.get_my_realizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_realizations() TO authenticated;
NOTIFY pgrst,'reload schema';
-- The assigned leader owns the operational scope, but direct event writes remain
-- blocked; transitions go through advance_realization's strict action checks.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.crm_record_scope_allows(text,jsonb)'::regprocedure) INTO d;
 EXECUTE replace(d,'SELECT (p_module=', 'SELECT (p_module=''events'' AND public.is_realization_manager((p_row->>''id'')::uuid)) OR (p_module=');
 SELECT pg_get_functiondef('public.crm_record_id_scope_allows(text,uuid)'::regprocedure) INTO d;
 EXECUTE replace(d,'BEGIN',E'BEGIN\n IF p_module=''events'' AND public.is_realization_manager(p_id) THEN RETURN true; END IF;');
END $$;
CREATE POLICY realization_operational_event_write ON public.events AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(NOT public.realization_operational_only(id)) WITH CHECK(NOT public.realization_operational_only(id));
-- Guard the four inspected legacy SECURITY DEFINER readers as well as table access.
DO $$ DECLARE signature text; d text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.get_event_financial_info(uuid)','public.get_event_financial_summary(uuid)','public.get_event_cash_summary(uuid)','public.get_event_invoices(uuid)'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO d;
  IF position('BEGIN' IN d)=0 THEN RAISE EXCEPTION 'Unexpected reader definition: %',signature; END IF;
  EXECUTE replace(d,'BEGIN',E'BEGIN\n IF public.realization_operational_only(p_event_id) THEN RAISE EXCEPTION ''Dane rozliczeniowe nie należą do zakresu kierownika realizacji.'' USING ERRCODE=''42501''; END IF;');
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.get_event_details_for_user(event_id uuid,user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF public.sales_employee_id() IS NULL OR user_id NOT IN (public.sales_employee_id(),auth.uid()) THEN RETURN NULL; END IF;
 IF public.realization_operational_only(event_id) THEN RETURN public.get_realization_workspace(event_id)::json; END IF;
 IF NOT public.current_employee_can_view_event(event_id) THEN RETURN NULL; END IF;
 RETURN public.get_event_details(event_id);
END $$;
