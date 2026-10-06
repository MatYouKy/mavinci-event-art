-- Keep operational progress independent of an invoice issued before the event.
CREATE OR REPLACE FUNCTION public.get_event_operational_states(p_event_ids uuid[])
RETURNS TABLE(event_id uuid,status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT e.id, CASE
 WHEN e.status::text='cancelled' THEN 'cancelled'
 WHEN e.status::text='settled' AND (r.completed_at IS NOT NULL OR (r.manager_id IS NULL AND e.event_end_date<=now())) THEN 'settled'
 WHEN e.status::text IN ('inquiry','offer_to_send','offer_sent') THEN 'inquiry'
 WHEN r.completed_at IS NOT NULL OR (r.manager_id IS NULL AND (e.status::text='completed' OR (e.status::text='invoiced' AND e.event_end_date<=now()))) THEN 'completed'
 WHEN r.started_at IS NOT NULL OR e.status::text='in_progress' THEN 'in_progress'
 WHEN h.ready_at IS NOT NULL OR e.status::text IN ('ready_for_live','ready_for_execution') THEN 'ready_for_live'
 WHEN h.accepted_at IS NOT NULL OR e.status::text='in_preparation' THEN 'in_preparation'
 ELSE 'offer_accepted' END
 FROM public.events e
 LEFT JOIN public.event_realizations r ON r.event_id=e.id
 LEFT JOIN public.event_warehouse_handoffs h ON h.event_id=e.id
 WHERE e.id=ANY(p_event_ids);
$$;

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
  IF ev.status::text NOT IN ('offer_accepted','in_preparation','ready_for_live','in_progress','invoiced','settled') THEN RAISE EXCEPTION 'Wydarzenie nie jest gotowe do przejęcia.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=p_event_id AND h.ready_at IS NOT NULL)
     AND ev.status::text NOT IN ('ready_for_live','in_progress') THEN RAISE EXCEPTION 'Magazyn musi najpierw potwierdzić gotowość do realizacji.' USING ERRCODE='22023'; END IF;
  UPDATE public.event_realizations SET started_at=clock_timestamp(),started_by=public.sales_employee_id() WHERE event_id=p_event_id RETURNING * INTO r;
  UPDATE public.events SET status='in_progress' WHERE id=p_event_id AND status::text NOT IN ('invoiced','settled');
 ELSE
  IF r.completed_at IS NOT NULL THEN RETURN to_jsonb(r); END IF;
  IF r.started_at IS NULL THEN RAISE EXCEPTION 'Najpierw przejmij realizację.' USING ERRCODE='22023'; END IF;
  UPDATE public.event_realizations SET completed_at=clock_timestamp(),completed_by=public.sales_employee_id(),completion_notes=nullif(trim(p_notes),'') WHERE event_id=p_event_id RETURNING * INTO r;
  UPDATE public.events SET status='completed' WHERE id=p_event_id AND status::text NOT IN ('invoiced','settled');
 END IF;
 RETURN to_jsonb(r);
END $$;

NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.appoint_realization_manager(p_event_id uuid,p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result public.event_realizations%ROWTYPE; ev public.events%ROWTYPE; label text;
BEGIN
 IF NOT public.can_direct_realization(p_event_id) THEN RAISE EXCEPTION 'Tylko autor lub osoba zarządzająca wydarzeniem może wyznaczyć kierownika.' USING ERRCODE='42501'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF (ev.status::text IN ('cancelled','completed') OR (ev.status::text IN ('invoiced','settled') AND ev.event_end_date<=now())) THEN RAISE EXCEPTION 'Nie można zmienić kierownika zakończonej realizacji.' USING ERRCODE='22023'; END IF;
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
 'equipment',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',coalesce(i.name,k.name,cable.name,'Sprzęt'),'quantity',x.quantity,'notes',x.notes,'loaded',x.is_loaded)),'[]') FROM public.event_equipment x LEFT JOIN public.equipment_items i ON i.id=x.equipment_id LEFT JOIN public.equipment_kits k ON k.id=x.kit_id LEFT JOIN public.cables cable ON cable.id=x.cable_id WHERE x.event_id=e.id AND NOT coalesce(x.is_optional,false) AND NOT coalesce(x.removed_from_offer,false)),
 'files',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',coalesce(f.name,f.original_name,f.file_name),'path',f.file_path,'url',f.file_url)),'[]') FROM public.event_files f WHERE f.event_id=e.id AND f.folder_id IS NULL AND NOT public.is_sensitive_event_document(f.document_type))
 ) INTO result FROM public.events e LEFT JOIN public.locations l ON l.id=e.location_id LEFT JOIN public.contacts c ON c.id=e.contact_person_id WHERE e.id=p_event_id;
 RETURN result;
END $$;
