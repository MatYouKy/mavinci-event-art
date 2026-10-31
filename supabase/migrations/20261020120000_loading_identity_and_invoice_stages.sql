BEGIN;

CREATE OR REPLACE FUNCTION public.set_event_equipment_loaded(p_equipment_id uuid, p_loaded boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event public.events%ROWTYPE; v_employee public.employees%ROWTYPE; v_event_id uuid;
BEGIN
 IF auth.uid() IS NULL OR p_loaded IS NULL THEN RAISE EXCEPTION 'Wymagane jest zalogowanie i stan załadunku.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=public.current_employee_id() AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak aktywnego konta pracownika.' USING ERRCODE='42501'; END IF;
 SELECT event_id INTO v_event_id FROM public.event_equipment WHERE id=p_equipment_id;
 SELECT * INTO v_event FROM public.events WHERE id=v_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pozycji sprzętu.' USING ERRCODE='P0002'; END IF;
 IF NOT coalesce(public.employee_can_access_company(v_employee.id,v_event.my_company_id),false)
 OR NOT (coalesce(public.can_prepare_warehouse_event(v_event.id),false)
   OR coalesce(public.is_realization_manager(v_event.id),false)
   OR (coalesce(public.crm_record_id_scope_allows('events',v_event.id),false) AND (
     'admin'=ANY(coalesce(v_employee.permissions,'{}')) OR 'events_manage'=ANY(coalesce(v_employee.permissions,'{}'))
     OR coalesce(v_event.created_by IN (v_employee.id,auth.uid()),false)
     OR EXISTS(SELECT 1 FROM public.employee_assignments WHERE event_id=v_event.id AND employee_id=v_employee.id AND status='accepted'))))
 THEN RAISE EXCEPTION 'Nie masz uprawnień do załadunku tego wydarzenia.' USING ERRCODE='42501'; END IF;
 IF coalesce(v_event.loading_locked,false) AND NOT p_loaded THEN
   RAISE EXCEPTION 'Załadunek jest zatwierdzony. Najpierw odblokuj checklistę.';
 END IF;
 UPDATE public.event_equipment SET is_loaded=p_loaded,
   loaded_at=CASE WHEN p_loaded THEN now() ELSE NULL END,
   loaded_by=CASE WHEN p_loaded THEN auth.uid() ELSE NULL END
 WHERE id=p_equipment_id AND event_id=v_event.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pozycja sprzętu została usunięta. Odśwież checklistę.'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_event_equipment_loaded(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_event_equipment_loaded(uuid,boolean) TO authenticated;

-- Keep all existing payment evidence and alias handling; advances alone cannot close an event.
DO $migration$ DECLARE definition text; needle text := 'WHEN NOT EXISTS (SELECT 1 FROM issued WHERE invoice_type IN (''vat'', ''advance'', ''final'')) THEN NULL'; BEGIN
 definition:=pg_get_functiondef('public.event_invoice_lifecycle_state(uuid)'::regprocedure);
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja oceny faktur.'; END IF;
 EXECUTE replace(definition,needle,'WHEN NOT EXISTS (SELECT 1 FROM issued WHERE invoice_type IN (''vat'', ''final'')) THEN NULL');
 definition:=pg_get_functiondef('public.sync_event_invoice_lifecycle(uuid)'::regprocedure);
 needle:='  v_target := public.event_invoice_lifecycle_state(p_event_id);';
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja synchronizacji faktur.'; END IF;
 EXECUTE replace(definition,needle,E'  IF v_current NOT IN (''completed'', ''invoiced'', ''settled'') THEN RETURN; END IF;\n' || needle);
END; $migration$;

CREATE OR REPLACE FUNCTION public.sync_invoice_status_on_event_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status::text='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
   PERFORM public.sync_event_invoice_lifecycle(NEW.id);
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.sync_invoice_status_on_event_completion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_invoice_status_on_event_completion AFTER UPDATE OF status ON public.events
FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_status_on_event_completion();
-- Repair only future events awaiting warehouse acknowledgement, with advances only.
-- Past events need individual review; do not infer their historical operational stage.
UPDATE public.events e SET status='offer_accepted',updated_at=now()
WHERE e.status::text='invoiced' AND e.event_date>now()
 AND public.event_invoice_lifecycle_state(e.id) IS NULL
 AND EXISTS(SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=e.id AND h.accepted_at IS NULL AND h.ready_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.event_realizations r WHERE r.event_id=e.id AND (r.started_at IS NOT NULL OR r.completed_at IS NOT NULL));
COMMIT;
