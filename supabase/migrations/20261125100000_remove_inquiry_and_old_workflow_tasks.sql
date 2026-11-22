-- Zadania z zapytań i stare automatyczne zadania procesu wydarzenia (decyzja właściciela, 22.11.2026).
--
-- 1. Zapytania nie tworzą zadań: przygotowanie realizacji (prepare_inquiry_realization) nie dodaje już zadania
--    „Potwierdź zasoby i przygotuj realizację” — ten etap prowadzą kroki wydarzenia.
-- 2. Proces wydarzenia nie tworzy nowych zadań (sync_event_workflow_tasks_internal) — zastąpiły je kroki wydarzenia
--    z powiadomieniami. Istniejące zadania procesu nadal zamykają się same po spełnieniu warunku.
-- 3. Usunięcie (nieodwracalne):
--    - dawne przypisania zapytań do pracowników (`task_assignees` przy wierszach `is_inquiry`) — przez nie zapytania
--      wyglądały na listach jak zadania; same zapytania zostają w lejku z opiekunem (`inquiry_owner_id`),
--    - automatyczne zadania „Potwierdź zasoby i przygotuj realizację” utworzone przy przygotowaniu realizacji,
--    - automatyczne zadania procesu wydarzenia utworzone przed 1.11.2026 na tablicy Mateusza Kwiatkowskiego
--      (stan 22.11.2026: 846 zadań z 165 wydarzeń, 82 otwarte; żadne nie ma komentarzy, plików ani czasu pracy).
--    Zadania z komentarzami, plikami albo wpisami czasu pracy zostają (zabezpieczenie).

CREATE OR REPLACE FUNCTION public.prepare_inquiry_realization(p_inquiry_id uuid, p_event_name text DEFAULT NULL::text, p_event_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_category_id uuid DEFAULT NULL::uuid, p_my_company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t public.tasks; o public.offers; n uuid; amount numeric; resource record;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL OR NOT public.current_employee_can_access_company(p_my_company_id) THEN RAISE EXCEPTION 'Brak uprawnień do realizacji w wybranej działalności'; END IF;
 IF t.accepted_offer_id IS NULL THEN RAISE EXCEPTION 'Najpierw zapisz akceptację klienta'; END IF;
 IF EXISTS(SELECT 1 FROM public.inquiry_activity WHERE inquiry_id=t.id AND kind='handoff') THEN RETURN t.event_id; END IF;
 SELECT * INTO STRICT o FROM public.offers WHERE id=t.accepted_offer_id AND inquiry_id=t.id AND status='accepted' FOR UPDATE;
 n:=public.convert_inquiry_to_event(t.id,p_event_name,p_event_date,p_category_id,p_my_company_id);
 IF NOT public.current_employee_can_access_event_company(n) THEN RAISE EXCEPTION 'Brak dostępu do działalności wydarzenia'; END IF;
 IF o.pricing_source='calculation' THEN
 SELECT coalesce(sum(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric*greatest(1,coalesce((i->>'days')::numeric,1)),2)),0) INTO amount FROM jsonb_array_elements(o.calculation_snapshot->'event_calculation_items') i;
 ELSIF o.package_mode THEN SELECT price_net INTO STRICT amount FROM public.offer_packages WHERE id=o.accepted_package_id AND offer_id=o.id;
 ELSE amount:=coalesce(o.subtotal,0)-coalesce(o.discount_amount,0); END IF;
 IF o.pricing_source<>'calculation' AND (o.package_mode OR NOT o.totals_include_logistics) AND coalesce((to_jsonb(o)->>'logistics_enabled')::boolean,false) THEN amount:=amount+coalesce((to_jsonb(o)->>'logistics_price_net')::numeric,0); END IF;
 UPDATE public.events SET budget=amount,expected_revenue=amount,financial_source='offer',status='offer_accepted' WHERE id=n AND status::text IN ('inquiry','offer_to_send','offer_sent','offer_accepted');
 -- Planned scope is explicit; actual reservations still require checking availability.
 FOR resource IN SELECT * FROM public.get_offer_selected_equipment(o.id,o.accepted_package_id) LOOP
 INSERT INTO public.event_equipment(event_id,offer_id,equipment_id,kit_id,quantity,reservation_status,auto_added)
 SELECT n,o.id,CASE WHEN resource.item_type='item' THEN resource.item_id END,CASE WHEN resource.item_type='kit' THEN resource.item_id END,resource.qty,'planned',true WHERE NOT EXISTS(SELECT 1 FROM public.event_equipment WHERE event_id=n AND offer_id=o.id AND (equipment_id=resource.item_id OR kit_id=resource.item_id));
 END LOOP;
 -- Bez zadania „Potwierdź zasoby i przygotuj realizację”: ten etap prowadzą kroki wydarzenia (zapytania nie tworzą zadań).
 PERFORM public.sales_log(t.id,'handoff','Przygotowano realizację z zaakceptowanej oferty',jsonb_build_object('event_id',n,'offer_id',o.id,'scope',o.accepted_variant_selections,'calculation_snapshot',o.calculation_snapshot,'budget_net',amount));
 RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.sync_event_workflow_tasks_internal(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events; inst public.event_workflow_instances; req record; linked record; next jsonb;
 owner record; met boolean; eligible boolean; created_count integer:=0; previous_flag text;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 previous_flag:=current_setting('app.event_workflow_sync',true);
 PERFORM set_config('app.event_workflow_sync','on',true);
 PERFORM public.ensure_event_workflow_instance(p_event_id);
 SELECT * INTO inst FROM public.event_workflow_instances WHERE event_id=p_event_id;
 SELECT * INTO owner FROM private.event_workflow_owner(p_event_id);
 next:=private.event_workflow_next_action(p_event_id);
 FOR req IN SELECT r.* FROM public.event_workflow_requirements r
  JOIN public.event_workflow_stages s ON s.id=r.stage_id
  WHERE s.template_id=inst.template_id AND r.auto_create_task AND r.is_required
 LOOP
  met:=public.event_workflow_requirement_is_met(p_event_id,req.id);
  IF req.requirement_key='invoice_issued' THEN
   met:=EXISTS(SELECT 1 FROM public.invoices i WHERE i.status IN('issued','sent','paid','overdue')
    AND i.invoice_type IN('vat','final') AND i.is_proforma IS NOT TRUE
    AND (EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id AND a.event_id=p_event_id AND a.allocation_weight>0)
      OR(i.event_id=p_event_id AND NOT EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id))));
  END IF;
  SELECT l.*,t.status::text task_status INTO linked FROM public.event_workflow_tasks l JOIN public.tasks t ON t.id=l.task_id
   WHERE l.instance_id=inst.id AND l.requirement_id=req.id;
  eligible:=coalesce(next->>'requirement_id'=req.id::text AND next->>'status' IN('actionable','snoozed'),false);
  IF met AND linked.task_id IS NOT NULL AND (linked.task_status NOT IN('completed','cancelled') OR linked.deferred) THEN
   UPDATE public.event_workflow_tasks SET deferred=false,completed_by_workflow=true WHERE instance_id=inst.id AND requirement_id=req.id;
   UPDATE public.tasks SET status='completed',board_column='completed',updated_at=now() WHERE id=linked.task_id;
  ELSIF NOT met AND eligible AND owner.employee_id IS NOT NULL THEN
   IF linked.task_id IS NULL THEN
    -- Nowych zadań procesu już nie tworzymy — prowadzą to kroki wydarzenia z powiadomieniami (22.11.2026).
    -- Istniejące zadania nadal zamykają się same po spełnieniu warunku albo są odkładane.
    NULL;
   ELSIF linked.deferred OR linked.completed_by_workflow THEN
    UPDATE public.event_workflow_tasks SET deferred=false,completed_by_workflow=false WHERE instance_id=inst.id AND requirement_id=req.id;
    UPDATE public.tasks SET status='todo',board_column='todo',due_date=(next->>'due_at')::timestamptz,updated_at=now() WHERE id=linked.task_id;
   ELSIF linked.task_status='todo' THEN
    UPDATE public.tasks SET due_date=(next->>'due_at')::timestamptz WHERE id=linked.task_id AND due_date IS DISTINCT FROM (next->>'due_at')::timestamptz;
   END IF;
  ELSIF NOT eligible AND linked.task_id IS NOT NULL AND linked.task_status='todo' THEN
   -- Do not alter manually created work or tasks that someone has already started.
   UPDATE public.event_workflow_tasks SET deferred=true WHERE instance_id=inst.id AND requirement_id=req.id;
   UPDATE public.tasks SET status='cancelled',board_column='cancelled',updated_at=now() WHERE id=linked.task_id;
  END IF;
 END LOOP;
 PERFORM private.refresh_event_workflow_attention(p_event_id);
 UPDATE public.notification_recipients nr SET is_read=true,read_at=coalesce(nr.read_at,now())
 FROM public.notifications n WHERE n.id=nr.notification_id AND NOT nr.is_read
  AND n.metadata->>'kind'='event_workflow_digest' AND nr.user_id=owner.user_id
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(n.metadata->'actions','[]'::jsonb)) a WHERE a->>'event_id'=p_event_id::text)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(n.metadata->'actions','[]'::jsonb)) a
    JOIN public.event_workflow_attention attention ON attention.event_id=(a->>'event_id')::uuid
    WHERE attention.next_action->>'status'='actionable' AND attention.next_action->>'requirement_id'=a->>'requirement_id');
 PERFORM set_config('app.event_workflow_sync',coalesce(previous_flag,''),true);
 RETURN created_count;
END $$;

-- Usuwanie zadań wydarzeń nie uruchamia przeliczania procesu (wyzwalacz sprawdza to ustawienie).
SELECT set_config('app.event_workflow_sync', 'on', false);

DELETE FROM public.task_assignees a
USING public.tasks t
WHERE t.id = a.task_id AND t.is_inquiry IS TRUE;

DELETE FROM public.tasks t
WHERE t.is_inquiry IS NOT TRUE
  AND t.inquiry_id IS NOT NULL
  AND t.title = 'Potwierdź zasoby i przygotuj realizację'
  AND NOT EXISTS (SELECT 1 FROM public.task_comments c WHERE c.task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.task_attachments f WHERE f.task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.time_entries e WHERE e.task_id = t.id);

DELETE FROM public.tasks t
WHERE t.created_at < timestamptz '2026-11-01 00:00:00+01'
  AND EXISTS (SELECT 1 FROM public.event_workflow_tasks l WHERE l.task_id = t.id)
  AND EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.employee_id = '8f2b21d2-13c1-4d87-a783-95f524c6a01a')
  AND NOT EXISTS (SELECT 1 FROM public.task_comments c WHERE c.task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.task_attachments f WHERE f.task_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.time_entries e WHERE e.task_id = t.id);

SELECT set_config('app.event_workflow_sync', '', false);
