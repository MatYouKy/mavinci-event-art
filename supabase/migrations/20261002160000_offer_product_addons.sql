BEGIN;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS totals_include_logistics boolean NOT NULL DEFAULT false;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS pricing_addons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.offer_items ADD COLUMN IF NOT EXISTS pricing_configuration jsonb;

CREATE OR REPLACE FUNCTION public.offer_addons_valid(p_addons jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE a jsonb; seen text[] := '{}'; k text; n numeric;
BEGIN
 IF jsonb_typeof(p_addons) IS DISTINCT FROM 'array' OR jsonb_array_length(p_addons)>40 THEN RETURN false; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_addons) LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR coalesce(length(a->>'id'),0)=0 OR (a->>'id')=ANY(seen) THEN RETURN false; END IF;
  IF jsonb_typeof(a->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'unit') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'description') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  seen:=array_append(seen,a->>'id');
  IF coalesce(a->>'kind','') NOT IN ('over_limit','quantity','optional') OR coalesce(length(trim(a->>'name')),0)=0 OR length(a->>'name')>120 OR coalesce(length(trim(a->>'unit')),0)=0 OR length(a->>'unit')>20 OR coalesce(length(a->>'description'),0)>500 OR jsonb_typeof(a->'enabled') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['quantity','included_quantity','unit_price'] LOOP
   IF jsonb_typeof(a->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   n:=(a->>k)::numeric;
   IF n<0 OR n<>round(n,2) OR n>(CASE WHEN k='unit_price' THEN 99999999 ELSE 100000 END) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE public.offer_products ADD CONSTRAINT offer_products_pricing_addons_valid CHECK(public.offer_addons_valid(pricing_addons));

CREATE OR REPLACE FUNCTION public.offer_configuration_total(c jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE a jsonb; result numeric; qty numeric;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(c->'base_unit_price') IS DISTINCT FROM 'number' OR NOT public.offer_addons_valid(c->'addons') THEN RAISE EXCEPTION 'Nieprawidłowa konfiguracja dodatków.'; END IF;
 result:=(c->>'base_unit_price')::numeric;
 IF result<0 OR result>999999999 OR result<>round(result,2) THEN RAISE EXCEPTION 'Nieprawidłowa cena bazowa.'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(c->'addons') LOOP
  qty:=CASE a->>'kind' WHEN 'optional' THEN CASE WHEN (a->>'enabled')::boolean THEN 1 ELSE 0 END WHEN 'over_limit' THEN greatest(0,(a->>'quantity')::numeric-(a->>'included_quantity')::numeric) ELSE (a->>'quantity')::numeric END;
  result:=result+round(qty*(a->>'unit_price')::numeric,2);
 END LOOP;
 IF result>999999999 THEN RAISE EXCEPTION 'Wartość konfiguracji jest zbyt wysoka.'; END IF;
 RETURN round(result,2);
END $$;

CREATE OR REPLACE FUNCTION public.apply_offer_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE addons jsonb; channel text; extras numeric;
BEGIN
 SELECT sales_channel INTO channel FROM public.offers WHERE id=NEW.offer_id;
 -- Seller prices are governed by an individual price list. Do not bypass that contract.
 IF channel='seller_portal' THEN
  IF coalesce(jsonb_array_length(NEW.pricing_configuration->'addons'),0)>0 THEN RAISE EXCEPTION 'Konfiguracja dodatków wymaga oferty CRM. Ceny portalu pochodzą z indywidualnego cennika.'; END IF;
  NEW.pricing_configuration:=NULL;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND NEW.pricing_configuration IS NULL AND NEW.product_id IS NOT NULL THEN
  SELECT pricing_addons INTO addons FROM public.offer_products WHERE id=NEW.product_id;
  IF coalesce(jsonb_array_length(addons),0)>0 THEN
   NEW.pricing_configuration:=jsonb_build_object('version',1,'base_unit_price',NEW.unit_price,'addons',addons);
  END IF;
 END IF;
 IF NEW.pricing_configuration IS NOT NULL THEN
  IF TG_OP='UPDATE' AND NEW.pricing_configuration IS NOT DISTINCT FROM OLD.pricing_configuration AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
   extras:=public.offer_configuration_total(NEW.pricing_configuration)-(NEW.pricing_configuration->>'base_unit_price')::numeric;
   NEW.pricing_configuration:=jsonb_set(NEW.pricing_configuration,'{base_unit_price}',to_jsonb(NEW.unit_price-extras));
  END IF;
  NEW.unit_price:=public.offer_configuration_total(NEW.pricing_configuration);
  IF jsonb_array_length(NEW.pricing_configuration->'addons')>0 THEN NEW.offer_page_variant_override:='default'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
  IF NEW.quantity<=0 OR coalesce(NEW.discount_percent,0)<0 OR coalesce(NEW.discount_percent,0)>100 THEN RAISE EXCEPTION 'Nieprawidłowa ilość lub rabat pozycji.'; END IF;
  NEW.discount_amount:=round(NEW.unit_price*NEW.quantity*coalesce(NEW.discount_percent,0)/100,2);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_apply_offer_configuration BEFORE INSERT OR UPDATE ON public.offer_items FOR EACH ROW EXECUTE FUNCTION public.apply_offer_configuration();

-- A legacy duplicate trigger overwrote gross totals with undiscounted net totals.
-- Keep the canonical calculator and the dedicated deferred seller calculator.
DROP TRIGGER IF EXISTS trigger_recalculate_offer_totals ON public.offer_items;

CREATE OR REPLACE FUNCTION public.add_offer_item_without_duplicate(p_offer_id uuid, p_item jsonb, p_move_recommendation boolean, p_expected_recommendations jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE proposals jsonb; item public.offer_items; result_id uuid; has_proposal boolean;
BEGIN
 SELECT recommended_items INTO proposals FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty lub nie masz prawa jej zmieniać.'; END IF;
 item:=jsonb_populate_record(NULL::public.offer_items,p_item);
 IF item.product_id IS NULL THEN RAISE EXCEPTION 'Wybierz produkt.'; END IF;
 IF EXISTS(SELECT 1 FROM public.offer_items WHERE offer_id=p_offer_id AND product_id=item.product_id) THEN RAISE EXCEPTION 'Ten produkt jest już w głównej ofercie. Zmień ilość istniejącej pozycji.'; END IF;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(proposals) r WHERE r->>'product_id'=item.product_id::text) INTO has_proposal;
 IF has_proposal THEN
  IF NOT p_move_recommendation THEN RAISE EXCEPTION 'Produkt jest w propozycjach. Otwórz ponownie dodawanie i potwierdź przeniesienie.'; END IF;
  IF proposals IS DISTINCT FROM p_expected_recommendations THEN RAISE EXCEPTION 'Propozycje zostały zmienione. Otwórz ponownie dodawanie produktu.'; END IF;
  UPDATE public.offers SET recommended_items=(SELECT coalesce(jsonb_agg(r ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(proposals) WITH ORDINALITY a(r,ordinal) WHERE r->>'product_id' IS DISTINCT FROM item.product_id::text) WHERE id=p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak uprawnień do przeniesienia produktu.'; END IF;
 ELSIF p_move_recommendation THEN RAISE EXCEPTION 'Propozycja została już zmieniona lub usunięta. Odśwież ofertę.';
 END IF;
 INSERT INTO public.offer_items(offer_id,product_id,product_variant_id,variant_prices_net,show_variant_prices_in_pdf,show_product_variants_in_pdf,name,description,quantity,unit,unit_price,unit_cost,discount_percent,discount_amount,transport_cost,logistics_cost,display_order,notes,pricing_configuration)
 VALUES(p_offer_id,item.product_id,item.product_variant_id,item.variant_prices_net,item.show_variant_prices_in_pdf,item.show_product_variants_in_pdf,item.name,item.description,item.quantity,item.unit,item.unit_price,item.unit_cost,item.discount_percent,item.discount_amount,item.transport_cost,item.logistics_cost,item.display_order,item.notes,item.pricing_configuration) RETURNING id INTO result_id;
 RETURN result_id;
END $function$;

CREATE OR REPLACE FUNCTION public.calculate_offer_totals(offer_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_subtotal numeric(12, 2) := 0;
  v_total_cost numeric(12, 2) := 0;
  v_saved_discount_amount numeric(12, 2) := 0;
  v_saved_discount_percent numeric(7, 4) := 0;
  v_discount_amount numeric(12, 2) := 0;
  v_discount_percent numeric(7, 4) := 0;
  v_tax_percent numeric(5, 2) := 23;
  v_tax_amount numeric(12, 2) := 0;
  v_total_amount numeric(12, 2) := 0;
BEGIN
  SELECT
    COALESCE(discount_amount, 0),
    COALESCE(discount_percent, 0),
    COALESCE(tax_percent, 23)
  INTO
    v_saved_discount_amount,
    v_saved_discount_percent,
    v_tax_percent
  FROM public.offers
  WHERE id = offer_uuid;

  SELECT
    COALESCE(SUM(COALESCE(total, 0)), 0),
    COALESCE(SUM(COALESCE(unit_cost, 0) * COALESCE(quantity, 0)), 0)
  INTO v_subtotal, v_total_cost
  FROM public.offer_items
  WHERE offer_id = offer_uuid;

  v_subtotal := v_subtotal + coalesce((SELECT CASE WHEN logistics_enabled THEN logistics_price_net ELSE 0 END FROM public.offers WHERE id=offer_uuid),0);
  IF v_saved_discount_amount > 0 THEN
    v_discount_amount := LEAST(v_subtotal, v_saved_discount_amount);
  ELSE
    v_discount_amount := LEAST(
      v_subtotal,
      ROUND(v_subtotal * v_saved_discount_percent / 100, 2)
    );
  END IF;

  v_discount_percent := CASE
    WHEN v_subtotal > 0 THEN v_discount_amount / v_subtotal * 100
    ELSE 0
  END;
  v_tax_amount := ROUND((v_subtotal - v_discount_amount) * v_tax_percent / 100, 2);
  v_total_amount := ROUND(v_subtotal - v_discount_amount + v_tax_amount, 2);

  UPDATE public.offers
  SET
    subtotal = v_subtotal,
    totals_include_logistics = true,
    discount_percent = v_discount_percent,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total_amount = v_total_amount,
    total_cost = v_total_cost,
    margin_amount = v_total_amount - v_total_cost,
    margin_percent = CASE
      WHEN v_total_amount > 0
        THEN (v_total_amount - v_total_cost) / v_total_amount * 100
      ELSE 0
    END
  WHERE id = offer_uuid;
END;
$function$;
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
 IF t.inquiry_owner_id IS NOT NULL THEN INSERT INTO public.task_assignees(task_id,employee_id,assigned_by) VALUES(task_uuid,t.inquiry_owner_id,public.sales_employee_id()); END IF;
 PERFORM public.sales_log(t.id,'handoff','Przygotowano realizację z zaakceptowanej oferty',jsonb_build_object('event_id',n,'offer_id',o.id,'scope',o.accepted_variant_selections,'calculation_snapshot',o.calculation_snapshot,'budget_net',amount));
 RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.recalculate_offer_after_logistics() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.sales_channel IS DISTINCT FROM 'seller_portal' AND (NEW.logistics_enabled IS DISTINCT FROM OLD.logistics_enabled OR NEW.logistics_price_net IS DISTINCT FROM OLD.logistics_price_net) THEN
  PERFORM public.calculate_offer_totals(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recalculate_offer_after_logistics AFTER UPDATE OF logistics_enabled, logistics_price_net ON public.offers FOR EACH ROW EXECUTE FUNCTION public.recalculate_offer_after_logistics();
NOTIFY pgrst,'reload schema';
COMMIT;
