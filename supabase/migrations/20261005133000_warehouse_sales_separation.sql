BEGIN;
-- Keep event visibility separate from permission to take warehouse responsibility.
CREATE OR REPLACE FUNCTION public.employee_can_prepare_event(p_employee uuid,p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees e JOIN public.events v ON v.id=p_event
 WHERE e.id=p_employee AND e.is_active AND 'equipment_manage'=ANY(coalesce(e.permissions,'{}'))
 AND public.employee_can_access_company(e.id,v.my_company_id)
 AND v.status::text IN ('offer_accepted','in_preparation','ready_for_live','ready_for_execution','in_progress','completed','invoiced','settled')
 AND e.id IS DISTINCT FROM v.created_by
 AND NOT EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id=v.id AND o.created_by=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.offers o JOIN public.tasks t ON t.id=o.inquiry_id WHERE o.event_id=v.id AND t.inquiry_owner_id=e.id));
$$;
REVOKE ALL ON FUNCTION public.employee_can_prepare_event(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.can_prepare_warehouse_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.employee_can_prepare_event(public.sales_employee_id(),p_event_id);
$$;
REVOKE ALL ON FUNCTION public.can_prepare_warehouse_event(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_prepare_warehouse_event(uuid) TO authenticated;
DO $$ DECLARE fn text; definition text; BEGIN
 FOREACH fn IN ARRAY ARRAY['public.accept_warehouse_event(uuid)','public.advance_warehouse_event(uuid,text)'] LOOP
  SELECT pg_get_functiondef(fn::regprocedure) INTO definition;
  IF position('public.can_receive_warehouse_event(p_event_id)' IN definition)=0 THEN RAISE EXCEPTION 'Nieoczekiwana definicja funkcji %',fn; END IF;
  EXECUTE replace(definition,'public.can_receive_warehouse_event(p_event_id)','public.can_prepare_warehouse_event(p_event_id)');
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.guard_warehouse_event_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF NEW.status::text NOT IN ('in_preparation','ready_for_live','ready_for_execution') THEN RETURN NEW; END IF;
 IF auth.role()='authenticated' AND NOT public.can_prepare_warehouse_event(NEW.id) THEN
  RAISE EXCEPTION 'Przyjęcie i gotowość przygotowania potwierdza magazyn, a nie sprzedawca wydarzenia.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.can_contact_event_warehouse(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.current_employee_can_view_event(p_event_id)
 AND public.current_employee_can_access_event_company(p_event_id)
 AND public.can_manage_event_workflows(p_event_id);
$$;
REVOKE ALL ON FUNCTION public.can_contact_event_warehouse(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_contact_event_warehouse(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_event_warehouse_recipients(p_event_id uuid)
RETURNS TABLE(id uuid,name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT coalesce(public.can_contact_event_warehouse(p_event_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do kontaktu z magazynem' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id, coalesce(nullif(concat_ws(' ',e.name,e.surname),''),e.nickname,'Pracownik magazynu')
 FROM public.employees e WHERE public.employee_can_prepare_event(e.id,p_event_id)
 AND e.id<>public.sales_employee_id() ORDER BY e.surname,e.name;
END $$;
REVOKE ALL ON FUNCTION public.get_event_warehouse_recipients(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_event_warehouse_recipients(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.send_event_warehouse_message(p_event_id uuid,p_recipient uuid,p_message text,p_request boolean,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events; actor uuid:=public.sales_employee_id(); actor_name text; nid uuid; message_key text;
BEGIN
 IF NOT coalesce(public.can_contact_event_warehouse(p_event_id),false) THEN RAISE EXCEPTION 'Brak uprawnień' USING ERRCODE='42501'; END IF;
 IF NOT public.employee_can_prepare_event(p_recipient,p_event_id) OR p_recipient=actor THEN RAISE EXCEPTION 'Wybierz uprawnionego pracownika magazynu'; END IF;
 IF nullif(btrim(p_message),'') IS NULL OR length(p_message)>4000 OR p_request_id IS NULL THEN RAISE EXCEPTION 'Nieprawidłowa treść wiadomości'; END IF;
 SELECT * INTO STRICT ev FROM public.events WHERE id=p_event_id;
 SELECT concat_ws(' ',name,surname) INTO actor_name FROM public.employees WHERE id=actor;
 message_key:='warehouse-message:'||actor::text||':'||p_event_id::text||':'||p_request_id::text;
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('event',CASE WHEN p_request THEN 'Prośba o podjęcie przygotowania' ELSE 'Wiadomość do magazynu' END,
 actor_name||' · '||ev.name||E'\n'||btrim(p_message),'info','event',ev.id::text,'/crm/events/'||ev.id||'?tab=overview',
 jsonb_build_object('warehouse_key',message_key,'event_id',ev.id,'event_name',ev.name,'sender_id',actor,'recipient_id',p_recipient))
 ON CONFLICT DO NOTHING RETURNING id INTO nid;
 IF nid IS NULL THEN SELECT id INTO nid FROM public.notifications WHERE metadata->>'warehouse_key'=message_key; RETURN nid; END IF;
 INSERT INTO public.notification_recipients(notification_id,user_id) VALUES(nid,p_recipient);
 RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.send_event_warehouse_message(uuid,uuid,text,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_event_warehouse_message(uuid,uuid,text,boolean,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
