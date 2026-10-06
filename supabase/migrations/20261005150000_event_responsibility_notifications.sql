BEGIN;
-- Match notification recipients to the permission used to accept preparation.
CREATE OR REPLACE FUNCTION public.queue_event_for_warehouse()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE nid uuid; inserted_id uuid;
BEGIN
 IF NEW.status::text<>'offer_accepted' THEN RETURN NEW; END IF;
 INSERT INTO public.event_warehouse_handoffs(event_id) VALUES(NEW.id) ON CONFLICT DO NOTHING RETURNING event_id INTO inserted_id;
 IF inserted_id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('event','Nowa realizacja do przygotowania',format('Wydarzenie „%s” zostało zaakceptowane. Przyjmij realizację, sprawdź zasoby i zaplanuj brakujące zamówienia.',NEW.name),'info','event',NEW.id::text,'/crm/events/'||NEW.id||'?tab=overview',
 jsonb_build_object('warehouse_key','warehouse-request:'||NEW.id,'event_id',NEW.id,'event_name',NEW.name,'initial_tab','warehouse'))
 ON CONFLICT DO NOTHING RETURNING id INTO nid;
 IF nid IS NOT NULL THEN
 INSERT INTO public.notification_recipients(notification_id,user_id)
 SELECT nid,e.id FROM public.employees e WHERE public.employee_can_prepare_event(e.id,NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS event_operation_notification_once
 ON public.notifications ((metadata->>'event_operation_key'))
 WHERE metadata ? 'event_operation_key';

-- Only responsible people receive operational transitions, not everyone with
-- a sales/warehouse permission. No historical transitions are replayed.
CREATE OR REPLACE FUNCTION public.notify_event_operation(
 p_event uuid,p_kind text,p_key text,p_title text,p_message text,p_manager uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE nid uuid; ev public.events%ROWTYPE;
BEGIN
 SELECT * INTO STRICT ev FROM public.events WHERE id=p_event;
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('event',p_title,format('Wydarzenie „%s”. %s',ev.name,p_message),'info','event',p_event::text,
 '/crm/events/'||p_event||'?tab=overview',jsonb_build_object('event_operation_key',p_key,
 'kind',p_kind,'event_id',p_event,'initial_tab','details'))
 ON CONFLICT DO NOTHING RETURNING id INTO nid;
 IF nid IS NULL THEN RETURN; END IF;
 INSERT INTO public.notification_recipients(notification_id,user_id)
 SELECT DISTINCT nid,e.id FROM public.employees e
 WHERE e.is_active AND public.employee_can_access_company(e.id,ev.my_company_id)
 AND (
  (p_kind='manager_appointed' AND e.id=p_manager)
  OR (p_kind<>'manager_appointed' AND (
   e.id=p_manager
   OR ev.created_by IN(e.id,e.auth_user_id)
   OR EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id=p_event AND o.status::text='accepted' AND o.created_by IN(e.id,e.auth_user_id))
   OR EXISTS(SELECT 1 FROM public.offers o JOIN public.tasks t ON t.id=o.inquiry_id
      WHERE o.event_id=p_event AND o.status::text='accepted' AND t.inquiry_owner_id=e.id)
   OR (p_kind IN('realization_started','realization_completed') AND EXISTS(
      SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=p_event AND h.accepted_by=e.id))
  ))
 ) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.notify_event_operation(uuid,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_realization_responsibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.manager_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.manager_id IS DISTINCT FROM OLD.manager_id) THEN
  PERFORM public.notify_event_operation(NEW.event_id,'manager_appointed',
   'manager:'||NEW.event_id||':'||NEW.manager_id||':'||coalesce(NEW.appointed_at,statement_timestamp())::text,
   'Wyznaczono Cię na kierownika realizacji',
   CASE WHEN EXISTS(SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=NEW.event_id AND h.ready_at IS NOT NULL)
    THEN 'Magazyn potwierdził już gotowość. Możesz przejąć realizację.'
    ELSE 'Odpowiadasz za realizację. Otrzymasz powiadomienie, gdy magazyn potwierdzi gotowość.' END,NEW.manager_id);
 END IF;
 IF NEW.started_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.started_at IS NULL) THEN
  PERFORM public.notify_event_operation(NEW.event_id,'realization_started','started:'||NEW.event_id,
   'Kierownik przejął realizację',coalesce(NEW.manager_name,'Kierownik')||' rozpoczął realizację wydarzenia.');
 END IF;
 IF NEW.completed_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.completed_at IS NULL) THEN
  PERFORM public.notify_event_operation(NEW.event_id,'realization_completed','completed:'||NEW.event_id,
   'Realizacja zakończona',coalesce(NEW.manager_name,'Kierownik')||' potwierdził zakończenie realizacji.');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_realization_responsibility() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_realization_responsibility
 AFTER INSERT OR UPDATE OF manager_id,started_at,completed_at ON public.event_realizations
 FOR EACH ROW EXECUTE FUNCTION public.notify_realization_responsibility();

CREATE OR REPLACE FUNCTION public.notify_warehouse_ready()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manager uuid;
BEGIN
 IF NEW.ready_at IS NULL OR (TG_OP='UPDATE' AND OLD.ready_at IS NOT NULL) THEN RETURN NEW; END IF;
 SELECT manager_id INTO manager FROM public.event_realizations WHERE event_id=NEW.event_id;
 PERFORM public.notify_event_operation(NEW.event_id,'warehouse_ready','ready:'||NEW.event_id,
  'Magazyn potwierdził gotowość', 'Przygotowanie magazynowe zakończone. Kierownik może przejąć realizację.',manager);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_warehouse_ready() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_warehouse_ready AFTER INSERT OR UPDATE OF ready_at ON public.event_warehouse_handoffs
 FOR EACH ROW EXECUTE FUNCTION public.notify_warehouse_ready();
NOTIFY pgrst,'reload schema';
COMMIT;
