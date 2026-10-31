-- The task creator is already assigned by auto_assign_task_creator.
-- When the inquiry owner is also the creator, preserve that assignment.
-- Keep the unique constraint and all realization permission checks intact.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

CREATE OR REPLACE FUNCTION public.prepare_inquiry_realization(p_inquiry_id uuid, p_event_name text DEFAULT NULL::text, p_event_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_category_id uuid DEFAULT NULL::uuid, p_my_company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t public.tasks; o public.offers; n uuid; amount numeric; resource record; task_uuid uuid;
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
 INSERT INTO public.tasks(title,description,priority,status,board_column,inquiry_id,event_id,assigned_to,created_by,due_date,is_inquiry)
 VALUES('Potwierdź zasoby i przygotuj realizację','Sprawdź dostępność i zamienniki w zaakceptowanej ofercie, następnie zarezerwuj zasoby. Przygotuj umowę i harmonogram.', 'high','todo','todo',t.id,n,t.inquiry_owner_id,public.sales_employee_id(),now()+interval '1 day',false) RETURNING id INTO task_uuid;
 IF t.inquiry_owner_id IS NOT NULL THEN INSERT INTO public.task_assignees(task_id,employee_id,assigned_by) VALUES(task_uuid,t.inquiry_owner_id,public.sales_employee_id()) ON CONFLICT (task_id,employee_id) DO NOTHING; END IF;
 PERFORM public.sales_log(t.id,'handoff','Przygotowano realizację z zaakceptowanej oferty',jsonb_build_object('event_id',n,'offer_id',o.id,'scope',o.accepted_variant_selections,'calculation_snapshot',o.calculation_snapshot,'budget_net',amount));
 RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.prepare_inquiry_realization(uuid,text,timestamptz,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_inquiry_realization(uuid,text,timestamptz,uuid,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
