BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.offer_items ADD COLUMN IF NOT EXISTS days integer NOT NULL DEFAULT 1 CHECK (days BETWEEN 1 AND 3650);
ALTER TABLE public.offer_items ALTER COLUMN subtotal DROP EXPRESSION IF EXISTS;
ALTER TABLE public.offer_items ALTER COLUMN total DROP EXPRESSION IF EXISTS;
CREATE OR REPLACE FUNCTION public.calculate_offer_item_duration_totals() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.days IS NULL OR NEW.days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'Podaj liczbę dni od 1 do 3650'; END IF;
 IF TG_OP='INSERT' OR NEW.days IS DISTINCT FROM OLD.days OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
   NEW.discount_amount:=round(NEW.unit_price*NEW.quantity*NEW.days*coalesce(NEW.discount_percent,0)/100,2);
 END IF;
 NEW.subtotal:=round(NEW.unit_price*NEW.quantity*NEW.days-coalesce(NEW.discount_amount,0),2);
 NEW.total:=NEW.subtotal+coalesce(NEW.transport_cost,0)+coalesce(NEW.logistics_cost,0);
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_offer_item_duration_totals BEFORE INSERT OR UPDATE ON public.offer_items
FOR EACH ROW EXECUTE FUNCTION public.calculate_offer_item_duration_totals();

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
 INSERT INTO public.offer_items(offer_id,product_id,product_variant_id,variant_prices_net,show_variant_prices_in_pdf,show_product_variants_in_pdf,name,description,quantity,days,unit,unit_price,unit_cost,discount_percent,discount_amount,transport_cost,logistics_cost,display_order,notes,pricing_configuration)
 VALUES(p_offer_id,item.product_id,item.product_variant_id,item.variant_prices_net,item.show_variant_prices_in_pdf,item.show_product_variants_in_pdf,item.name,item.description,item.quantity,coalesce(item.days,1),item.unit,item.unit_price,item.unit_cost,item.discount_percent,item.discount_amount,item.transport_cost,item.logistics_cost,item.display_order,item.notes,item.pricing_configuration) RETURNING id INTO result_id;
 RETURN result_id;
END $function$;

CREATE OR REPLACE FUNCTION public.save_offer_packages_and_logistics(
 p_offer_id uuid, p_revision bigint, p_packages jsonb, p_enabled boolean, p_logistics jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
DECLARE o public.offers%ROWTYPE; p jsonb; i jsonb; source public.offer_items%ROWTYPE;
 ids uuid[]; pid uuid; idx integer:=0; item_idx integer; list_price numeric; discount numeric;
 cost numeric; price numeric; qty numeric; estimate jsonb;
BEGIN
 SELECT * INTO o FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.sales_can_manage_offer(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do edycji oferty.'; END IF;
 IF o.status='accepted' OR o.sales_channel='seller_portal' THEN RAISE EXCEPTION 'Tej oferty nie można edytować w tym miejscu.'; END IF;
 IF o.content_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Oferta zmieniła się od otwarcia edytora. Zamknij okno i odśwież stronę przed ponownym zapisem.'; END IF;
 IF p_logistics IS NOT NULL THEN
   estimate := nullif(p_logistics->'estimate','null'::jsonb);
   cost := CASE WHEN estimate IS NULL THEN (p_logistics->>'cost_net')::numeric ELSE public.offer_logistics_estimate_total(estimate) END;
   price := (p_logistics->>'price_net')::numeric;
   IF cost IS NULL OR cost<0 OR cost>99999999.99 OR cost<>round(cost,2) OR price IS NULL OR price<0 OR price>99999999.99 OR price<>round(price,2) THEN RAISE EXCEPTION 'Podaj nieujemny koszt i cenę logistyki z maksymalnie dwoma miejscami po przecinku.'; END IF;
   IF length(coalesce(p_logistics->>'description',''))>1000 THEN RAISE EXCEPTION 'Opis logistyki może mieć maksymalnie 1000 znaków.'; END IF;
   UPDATE public.offers SET logistics_cost_net=cost, logistics_estimate=estimate, logistics_price_net=price,
    logistics_enabled=coalesce((p_logistics->>'enabled')::boolean,false),
    logistics_description=nullif(trim(p_logistics->>'description'),'') WHERE id=p_offer_id;
 END IF;
 IF p_packages IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(p_packages)<>'array' OR jsonb_array_length(p_packages)>3 THEN RAISE EXCEPTION 'Oferta może mieć do trzech pakietów.'; END IF;
 IF p_enabled AND jsonb_array_length(p_packages)=0 THEN RAISE EXCEPTION 'Dodaj przynajmniej jeden pakiet.'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_packages) x WHERE coalesce((x->>'is_recommended')::boolean,false))>1 THEN RAISE EXCEPTION 'Rekomenduj najwyżej jeden pakiet.'; END IF;
 SELECT coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) INTO ids FROM jsonb_array_elements(p_packages) x;
 IF EXISTS(SELECT 1 FROM unnest(ids) id GROUP BY id HAVING count(*)>1) OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Nieprawidłowe identyfikatory pakietów.'; END IF;
 DELETE FROM public.offer_packages WHERE offer_id=p_offer_id AND NOT(id=ANY(ids));
 FOR p IN SELECT value FROM jsonb_array_elements(p_packages) LOOP
   pid := (p->>'id')::uuid;
   IF length(trim(coalesce(p->>'name','')))=0 OR length(p->>'name')>120 OR length(coalesce(p->>'description',''))>1000 THEN RAISE EXCEPTION 'Podaj nazwę pakietu (do 120 znaków) i opis (do 1000 znaków).'; END IF;
   IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Dodaj pozycje pakietu.'; END IF;
   IF jsonb_array_length(p->'items') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Pakiet musi zawierać od 1 do 500 pozycji.'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'items') x GROUP BY x->>'offer_item_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Ta sama pozycja występuje w pakiecie dwukrotnie.'; END IF;
   list_price:=0;
   FOR i IN SELECT value FROM jsonb_array_elements(p->'items') LOOP
     SELECT * INTO source FROM public.offer_items WHERE id=(i->>'offer_item_id')::uuid AND offer_id=p_offer_id;
     IF NOT FOUND OR source.product_id IS NULL THEN RAISE EXCEPTION 'Pakiet może zawierać wyłącznie istniejące pozycje tej oferty.'; END IF;
     IF (i->>'product_variant_id')::uuid IS DISTINCT FROM source.product_variant_id THEN RAISE EXCEPTION 'Wariant pozycji zmienił się. Usuń pozycję z pakietu i dodaj ją ponownie.'; END IF;
     qty:=(i->>'quantity')::numeric;
     IF qty IS NULL OR qty<=0 OR qty>99999999.99 OR qty<>round(qty,2) THEN RAISE EXCEPTION 'Nieprawidłowa ilość w pakiecie.'; END IF;
     list_price:=list_price+round(source.unit_price*source.days*qty,2);
   END LOOP;
   discount:=(p->>'discount_amount')::numeric;
   IF discount IS NULL OR discount<0 OR discount>list_price OR discount<>round(discount,2) THEN RAISE EXCEPTION 'Nieprawidłowa wartość rabatu pakietu.'; END IF;
   INSERT INTO public.offer_packages(id,offer_id,name,description,list_price_net,discount_percent,discount_amount,price_net,is_recommended,display_order)
   VALUES(pid,p_offer_id,trim(p->>'name'),nullif(trim(p->>'description'),''),list_price,
    CASE WHEN list_price>0 THEN round(discount/list_price*100,2) ELSE 0 END,discount,list_price-discount,coalesce((p->>'is_recommended')::boolean,false),idx)
   ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,list_price_net=EXCLUDED.list_price_net,
    discount_percent=EXCLUDED.discount_percent,discount_amount=EXCLUDED.discount_amount,price_net=EXCLUDED.price_net,
    is_recommended=EXCLUDED.is_recommended,display_order=EXCLUDED.display_order
   WHERE offer_packages.offer_id=p_offer_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Pakiet nie należy do tej oferty.'; END IF;
   DELETE FROM public.offer_package_items WHERE package_id=pid;
   item_idx:=0;
   FOR i IN SELECT value FROM jsonb_array_elements(p->'items') LOOP
     SELECT * INTO source FROM public.offer_items WHERE id=(i->>'offer_item_id')::uuid AND offer_id=p_offer_id;
     INSERT INTO public.offer_package_items(package_id,offer_item_id,product_id,product_variant_id,quantity,display_order)
     VALUES(pid,source.id,source.product_id,source.product_variant_id,(i->>'quantity')::numeric,item_idx);
     item_idx:=item_idx+1;
   END LOOP;
   idx:=idx+1;
 END LOOP;
 UPDATE public.offers SET package_mode=coalesce(p_enabled,false) WHERE id=p_offer_id;
END;
$body$;

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
    COALESCE(SUM(COALESCE(unit_cost, 0) * COALESCE(quantity, 0) * days), 0)
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

NOTIFY pgrst, 'reload schema';
COMMIT;
