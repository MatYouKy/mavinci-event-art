BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Presentation changes preserve prices, configuration snapshots and event resources.
-- Accepted-offer guards, history and PDF revision tracking remain active.

CREATE OR REPLACE FUNCTION public.apply_offer_audience_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.offers; source text; c jsonb; selected jsonb; fresh boolean; extras numeric;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

 SELECT * INTO STRICT o FROM public.offers WHERE id=NEW.offer_id FOR UPDATE;
 IF o.sales_channel='seller_portal' THEN RETURN NEW; END IF;
 c:=NEW.pricing_configuration;
 fresh:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN fresh:=NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id; END IF;
 IF coalesce(c#>>'{product_package,selected_id}','')<>'' THEN source:='manual';
 ELSIF c ? 'quantity_source' THEN source:=c->>'quantity_source';
 ELSIF fresh THEN
  IF NEW.product_variant_id IS NOT NULL THEN SELECT quantity_source INTO source FROM public.offer_product_variants WHERE id=NEW.product_variant_id AND product_id=NEW.product_id;
  ELSE SELECT quantity_source INTO source FROM public.offer_products WHERE id=NEW.product_id; END IF;
 ELSE source:=coalesce(OLD.pricing_configuration->>'quantity_source','manual'); END IF;
 source:=coalesce(source,'manual');
 IF source<>'manual' OR c IS NOT NULL THEN
  IF c IS NULL THEN c:=jsonb_build_object('version',1,'base_unit_price',NEW.unit_price,'addons','[]'::jsonb); END IF;
  c:=jsonb_set(c,'{quantity_source}',to_jsonb(source));
  c:=public.resolve_offer_audience_configuration(c,o.guest_count,o.guests_per_table,o.table_count);
  IF (c ? 'audience_snapshot') AND o.pricing_source='calculation' THEN RAISE EXCEPTION 'Przeliczniki osób wymagają źródła wyceny: Pozycje oferty. Zmień źródło zamiast nadpisywać zaakceptowaną kalkulację.'; END IF;
  IF TG_OP='UPDATE' AND NOT(c ? 'audience_snapshot') AND NEW.pricing_configuration IS NOT DISTINCT FROM OLD.pricing_configuration AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
   extras:=public.offer_configuration_total(c)-(c->>'base_unit_price')::numeric;
   c:=jsonb_set(c,'{base_unit_price}',to_jsonb(NEW.unit_price-extras));
  END IF;
  NEW.pricing_configuration:=c;
  IF source='guests' THEN NEW.quantity:=o.guest_count; NEW.unit:='osoba';
  ELSIF source='tables' THEN NEW.quantity:=coalesce(o.table_count,ceil(o.guest_count::numeric/o.guests_per_table)); NEW.unit:='stół'; END IF;
  NEW.unit_price:=public.offer_configuration_total(c);
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.apply_offer_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE addons jsonb; channel text; extras numeric;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

 SELECT sales_channel INTO channel FROM public.offers WHERE id=NEW.offer_id;
 -- Seller prices are governed by an individual price list. Do not bypass that contract.
 IF channel='seller_portal' THEN
  IF NEW.pricing_configuration ? 'modular' THEN RAISE EXCEPTION 'Produkt konfigurowalny wymaga oferty CRM.'; END IF;
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
 IF TG_OP='INSERT' AND NOT coalesce(NEW.pricing_configuration ? 'modular',false) AND EXISTS(SELECT 1 FROM public.offer_products WHERE id=NEW.product_id AND configuration_schema IS NOT NULL) THEN
  RAISE EXCEPTION 'Ten produkt wymaga konfiguracji wymiarów lub składników w ofercie.';
 END IF;
 IF NEW.pricing_configuration ? 'modular' THEN
  NEW.unit_price:=public.offer_configuration_total(NEW.pricing_configuration);
  NEW.pricing_configuration:=jsonb_set(NEW.pricing_configuration,'{base_unit_price}',to_jsonb(NEW.unit_price));
  NEW.offer_page_variant_override:='default'; NEW.show_product_variants_in_pdf:=false; NEW.show_variant_prices_in_pdf:=false; NEW.product_variant_id:=NULL; NEW.unit:='zestaw';
 END IF;
 IF NEW.pricing_configuration IS NOT NULL THEN
  IF NOT (NEW.pricing_configuration ? 'modular') AND TG_OP='UPDATE' AND NEW.pricing_configuration IS NOT DISTINCT FROM OLD.pricing_configuration AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.calculate_offer_item_duration_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

 IF NEW.days IS NULL OR NEW.days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'Podaj liczbę dni od 1 do 3650'; END IF;
 IF TG_OP='INSERT' OR NEW.days IS DISTINCT FROM OLD.days OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
   NEW.discount_amount:=round(NEW.unit_price*NEW.quantity*NEW.days*coalesce(NEW.discount_percent,0)/100,2);
 END IF;
 NEW.subtotal:=round(NEW.unit_price*NEW.quantity*NEW.days-coalesce(NEW.discount_amount,0),2);
 NEW.total:=NEW.subtotal+coalesce(NEW.transport_cost,0)+coalesce(NEW.logistics_cost,0);
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.snapshot_offer_item_staff_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

 IF TG_OP='INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id OR (NEW.pricing_configuration->'product_package') IS DISTINCT FROM (OLD.pricing_configuration->'product_package') OR OLD.staff_cost_snapshot IS NULL THEN
  NEW.staff_cost_snapshot:=CASE WHEN nullif(NEW.pricing_configuration->'product_package','null'::jsonb) IS NOT NULL THEN '[]'::jsonb ELSE public.product_staff_cost_lines(NEW.product_id,NEW.product_variant_id) END;
 ELSE
  NEW.staff_cost_snapshot:=OLD.staff_cost_snapshot;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_recalculate_offer_totals()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

IF TG_OP = 'DELETE' THEN
PERFORM calculate_offer_totals(OLD.offer_id);
RETURN OLD;
ELSE
PERFORM calculate_offer_totals(NEW.offer_id);
RETURN NEW;
END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_individual_seller_offer_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offer_id uuid := COALESCE(NEW.offer_id, OLD.offer_id);
  v_offer record;
  v_base numeric := 0;
  v_client numeric := 0;
  v_requires_approval boolean := false;
  v_earnings numeric := 0;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

  SELECT sales_channel, commercial_model, partner_commission_rate
  INTO v_offer
  FROM public.offers
  WHERE id = v_offer_id;

  IF v_offer.sales_channel <> 'seller_portal' THEN RETURN NULL; END IF;

  SELECT
    COALESCE(sum(item.base_partner_unit_price * item.quantity), 0),
    COALESCE(sum(item.client_unit_price * item.quantity), 0),
    COALESCE(bool_or(item.requires_internal_approval), false)
  INTO v_base, v_client, v_requires_approval
  FROM public.offer_items item
  WHERE item.offer_id = v_offer_id;

  v_earnings := CASE
    WHEN v_offer.commercial_model = 'commission'
      THEN round(v_client * COALESCE(v_offer.partner_commission_rate, 0) / 100, 2)
    ELSE v_client - v_base
  END;

  UPDATE public.offers SET
    partner_base_net = v_base,
    client_total_net = v_client,
    partner_earnings_amount = v_earnings,
    partner_commission_amount = CASE
      WHEN v_offer.commercial_model = 'commission' THEN v_earnings ELSE 0
    END,
    total_base_price = v_base,
    subtotal = v_client,
    tax_percent = 23,
    tax_amount = round(v_client * 0.23, 2),
    total_amount = round(v_client * 1.23, 2),
    total_final_price = round(v_client * 1.23, 2),
    requires_internal_approval = v_requires_approval,
    partner_approval_status = CASE WHEN v_requires_approval THEN 'required' ELSE 'not_required' END
  WHERE id = v_offer_id;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_event_requires_subcontractors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_event_id uuid;
v_needs_subcontractors boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

-- Get event_id from the offer
IF TG_OP = 'DELETE' THEN
SELECT event_id INTO v_event_id FROM offers WHERE id = OLD.offer_id;
ELSE
SELECT event_id INTO v_event_id FROM offers WHERE id = COALESCE(NEW.offer_id, OLD.offer_id);
END IF;

-- Skip if no event_id
IF v_event_id IS NULL THEN
RETURN COALESCE(NEW, OLD);
END IF;

-- Check if any offer items for this event need subcontractors
SELECT EXISTS (
SELECT 1 
FROM offer_items oi
JOIN offers o ON o.id = oi.offer_id
WHERE o.event_id = v_event_id
AND oi.needs_subcontractor = true
) INTO v_needs_subcontractors;

-- Update the event
UPDATE events
SET requires_subcontractors = v_needs_subcontractors
WHERE id = v_event_id;

RETURN COALESCE(NEW, OLD);
END;
$function$;


CREATE OR REPLACE FUNCTION public.reorder_offer_items(p_offer_id uuid,p_item_ids uuid[],p_expected_item_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_ids uuid[]; changed integer; expected_changes integer;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.sales_can_manage_offer(p_offer_id),false) THEN
  RAISE EXCEPTION 'Brak uprawnień do edycji oferty.';
 END IF;
 PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty.'; END IF;
 PERFORM 1 FROM public.offer_items WHERE offer_id=p_offer_id ORDER BY id FOR UPDATE;
 SELECT coalesce(array_agg(id ORDER BY display_order,id),'{}'::uuid[]) INTO current_ids FROM public.offer_items WHERE offer_id=p_offer_id;
 IF current_ids IS DISTINCT FROM p_expected_item_ids THEN
  RAISE EXCEPTION 'Lista pozycji została zmieniona. Odśwież ofertę i ponów zmianę kolejności.';
 END IF;
 IF p_item_ids IS NULL OR cardinality(p_item_ids)<>cardinality(current_ids)
  OR array_position(p_item_ids,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT id) FROM unnest(p_item_ids) id)<>cardinality(current_ids)
  OR NOT(p_item_ids @> current_ids AND p_item_ids <@ current_ids) THEN
  RAISE EXCEPTION 'Nieprawidłowa lista pozycji oferty.';
 END IF;
 SELECT count(*) INTO expected_changes FROM public.offer_items i
 JOIN unnest(p_item_ids) WITH ORDINALITY x(id,ordinal) ON i.id=x.id
 WHERE i.offer_id=p_offer_id AND i.display_order IS DISTINCT FROM (x.ordinal-1)::integer;
 UPDATE public.offer_items i SET display_order=(x.ordinal-1)::integer
 FROM unnest(p_item_ids) WITH ORDINALITY x(id,ordinal)
 WHERE i.id=x.id AND i.offer_id=p_offer_id AND i.display_order IS DISTINCT FROM (x.ordinal-1)::integer;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>expected_changes THEN RAISE EXCEPTION 'Nie udało się zapisać całej kolejności.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_offer_items(uuid,uuid[],uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_offer_items(uuid,uuid[],uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
