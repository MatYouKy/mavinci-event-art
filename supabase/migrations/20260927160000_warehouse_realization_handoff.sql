CREATE TABLE public.event_warehouse_handoffs (
 event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 requested_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz,
 accepted_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 accepted_by_name text,
 CHECK ((accepted_at IS NULL)=(accepted_by_name IS NULL))
);
ALTER TABLE public.event_warehouse_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_warehouse_handoffs FROM anon,authenticated;
GRANT SELECT ON public.event_warehouse_handoffs TO authenticated;
CREATE POLICY warehouse_handoff_read ON public.event_warehouse_handoffs FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id));
CREATE OR REPLACE FUNCTION public.can_receive_warehouse_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees employee JOIN public.events event ON event.id=p_event_id
 WHERE employee.id=public.sales_employee_id() AND 'equipment_manage'=ANY(coalesce(employee.permissions,'{}'))
 AND public.employee_can_access_company(employee.id,event.my_company_id)
 AND event.status::text IN ('offer_accepted','in_preparation','ready_for_live','ready_for_execution','in_progress','completed','invoiced','settled'));
$$;
-- Operational warehouse access is explicit; commercial documents keep their own scopes.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.current_employee_can_view_event(uuid)'::regprocedure) INTO d;
 EXECUTE replace(d,'BEGIN',E'BEGIN\n  IF public.can_receive_warehouse_event(p_event_id) THEN RETURN true; END IF;');
 SELECT pg_get_functiondef('public.crm_record_scope_allows(text,jsonb)'::regprocedure) INTO d;
 EXECUTE replace(d,'SELECT NOT public.crm_record_scope_limited(p_module)',
 'SELECT (p_module=''events'' AND public.can_receive_warehouse_event((p_row->>''id'')::uuid)) OR NOT public.crm_record_scope_limited(p_module)');
 SELECT pg_get_functiondef('public.crm_record_id_scope_allows(text,uuid)'::regprocedure) INTO d;
 EXECUTE replace(d,'BEGIN',E'BEGIN\n IF p_module=''events'' AND public.can_receive_warehouse_event(p_id) THEN RETURN true; END IF;');
END $$;
CREATE UNIQUE INDEX warehouse_notification_once ON public.notifications ((metadata->>'warehouse_key')) WHERE metadata ? 'warehouse_key';
CREATE OR REPLACE FUNCTION public.queue_event_for_warehouse()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE nid uuid; inserted_id uuid;
BEGIN
 IF NEW.status::text<>'offer_accepted' THEN RETURN NEW; END IF;
 INSERT INTO public.event_warehouse_handoffs(event_id) VALUES(NEW.id) ON CONFLICT DO NOTHING RETURNING event_id INTO inserted_id;
 IF inserted_id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('event','Nowa realizacja do przygotowania',format('Wydarzenie „%s” zostało zaakceptowane. Przyjmij realizację, sprawdź zasoby i zaplanuj brakujące zamówienia.',NEW.name),'info','event',NEW.id::text,'/crm/events/'||NEW.id||'?tab=overview',
 jsonb_build_object('warehouse_key','warehouse-request:'||NEW.id,'event_id',NEW.id,'event_name',NEW.name))
 ON CONFLICT DO NOTHING RETURNING id INTO nid;
 IF nid IS NOT NULL THEN
 INSERT INTO public.notification_recipients(notification_id,user_id)
 SELECT nid,e.id FROM public.employees e WHERE e.is_active AND 'equipment_manage'=ANY(coalesce(e.permissions,'{}'))
 AND public.employee_can_access_company(e.id,NEW.my_company_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_event_for_warehouse AFTER INSERT OR UPDATE OF status ON public.events FOR EACH ROW EXECUTE FUNCTION public.queue_event_for_warehouse();
CREATE OR REPLACE FUNCTION public.accept_warehouse_event(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events%ROWTYPE; handoff public.event_warehouse_handoffs%ROWTYPE; actor uuid:=public.sales_employee_id(); actor_name text; nid uuid;
BEGIN
 IF actor IS NULL OR NOT public.can_receive_warehouse_event(p_event_id) THEN
 RAISE EXCEPTION 'Nie masz uprawnień do przyjęcia tej realizacji.' USING ERRCODE='42501'; END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF ev.status::text NOT IN ('offer_accepted','in_preparation') THEN
 RAISE EXCEPTION 'To wydarzenie nie oczekuje na rozpoczęcie przygotowania.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.event_warehouse_handoffs(event_id) VALUES(p_event_id) ON CONFLICT DO NOTHING;
 SELECT * INTO handoff FROM public.event_warehouse_handoffs WHERE event_id=p_event_id FOR UPDATE;
 IF handoff.accepted_at IS NOT NULL THEN RETURN to_jsonb(handoff); END IF;
 SELECT coalesce(nullif(concat_ws(' ',name,surname),''),nickname,'Pracownik magazynu') INTO actor_name FROM public.employees WHERE id=actor;
 UPDATE public.event_warehouse_handoffs SET accepted_by=actor,accepted_by_name=actor_name,accepted_at=clock_timestamp() WHERE event_id=p_event_id RETURNING * INTO handoff;
 UPDATE public.events SET status='in_preparation' WHERE id=p_event_id AND status::text='offer_accepted';
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('event','Magazyn przyjął realizację',format('%s przyjął/przyjęła wydarzenie „%s” do przygotowania.',actor_name,ev.name),'success','event',p_event_id::text,'/crm/events/'||p_event_id||'?tab=overview',
 jsonb_build_object('warehouse_key','warehouse-accepted:'||p_event_id,'event_id',p_event_id,'accepted_by',actor,'accepted_by_name',actor_name,'accepted_at',handoff.accepted_at))
 ON CONFLICT DO NOTHING RETURNING id INTO nid;
 IF nid IS NOT NULL THEN
 INSERT INTO public.notification_recipients(notification_id,user_id)
 SELECT DISTINCT nid,e.id FROM public.employees e WHERE e.is_active AND e.id<>actor
 AND public.employee_can_access_company(e.id,ev.my_company_id)
 AND (e.id=ev.created_by OR EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id=p_event_id AND o.status::text='accepted' AND o.created_by=e.id)
 OR EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=ev.contact_person_id AND c.owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=ev.organization_id AND o.owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.offers o JOIN public.tasks t ON t.id=o.inquiry_id WHERE o.event_id=p_event_id AND o.status::text='accepted' AND t.inquiry_owner_id=e.id))
 ON CONFLICT DO NOTHING;
 END IF;
 RETURN to_jsonb(handoff);
END $$;
REVOKE ALL ON FUNCTION public.can_receive_warehouse_event(uuid),public.accept_warehouse_event(uuid),public.queue_event_for_warehouse() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_receive_warehouse_event(uuid),public.accept_warehouse_event(uuid) TO authenticated;
-- Existing accepted events get a visible pending handoff without retrospective push messages.
INSERT INTO public.event_warehouse_handoffs(event_id) SELECT id FROM public.events WHERE status::text='offer_accepted' ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
