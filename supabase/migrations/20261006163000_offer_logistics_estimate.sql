BEGIN;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS logistics_estimate jsonb;
COMMENT ON COLUMN public.offers.logistics_estimate IS 'Wewnętrzne założenia szacunku logistyki oferty. Stawki kosztowe dla firmy; nie jest ewidencją wynagrodzeń ani rozliczeniem delegacji.';
CREATE OR REPLACE FUNCTION public.offer_logistics_estimate_total(p_estimate jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $body$
DECLARE r jsonb; k text; q numeric; u numeric; rate numeric; included numeric; consumption numeric;
 subtotal numeric:=0; line_total numeric; reserve numeric; result numeric;
BEGIN
 IF jsonb_typeof(p_estimate) IS DISTINCT FROM 'object' OR p_estimate->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(p_estimate->'rows') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Nieprawidłowa kalkulacja logistyki.';
 END IF;
 IF jsonb_array_length(p_estimate->'rows') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Kalkulacja wymaga od 1 do 30 pozycji.'; END IF;
 IF length(coalesce(p_estimate->>'notes',''))>2000 THEN RAISE EXCEPTION 'Założenia mogą mieć do 2000 znaków.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_estimate->'rows') x GROUP BY x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Powtórzona pozycja kalkulacji.'; END IF;
 reserve:=(p_estimate->>'reserve_percent')::numeric;
 IF reserve IS NULL OR reserve<0 OR reserve>100 OR reserve<>round(reserve,2) THEN RAISE EXCEPTION 'Rezerwa musi wynosić od 0 do 100%%.'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_estimate->'rows') LOOP
  k:=r->>'kind';
  IF k IS NULL OR k NOT IN ('fuel','travel','meals','accommodation','other') OR length(trim(coalesce(r->>'name','')))=0 OR length(r->>'name')>120 OR length(coalesce(r->>'id',''))=0 THEN RAISE EXCEPTION 'Podaj rodzaj i nazwę kosztu (do 120 znaków).'; END IF;
  q:=(r->>'quantity')::numeric; u:=(r->>'units')::numeric; rate:=(r->>'rate')::numeric;
  IF q IS NULL OR q<=0 OR q>10000 OR q<>trunc(q) OR u IS NULL OR u<0 OR u>100000 OR u<>round(u,2) OR rate IS NULL OR rate<0 OR rate>99999999.99 OR rate<>round(rate,2) THEN RAISE EXCEPTION 'Uzupełnij ilość, czas lub dystans i stawkę kosztu.'; END IF;
  IF k='fuel' THEN
   consumption:=(r->>'consumption')::numeric;
   IF consumption IS NULL OR consumption<=0 OR consumption>1000 OR consumption<>round(consumption,2) OR rate<=0 THEN RAISE EXCEPTION 'Podaj dodatnie spalanie i cenę paliwa.'; END IF;
   line_total:=round(round(u/100*consumption*rate,2)*q,2);
  ELSIF k='travel' THEN
   included:=(r->>'included_hours')::numeric;
   IF included IS NULL OR included<0 OR included>u OR included<>round(included,2) THEN RAISE EXCEPTION 'Godziny już w pakiecie nie mogą przekraczać czasu podróży.'; END IF;
   line_total:=round(q*(u-included)*rate,2);
  ELSE line_total:=round(q*u*rate,2);
  END IF;
  subtotal:=subtotal+line_total;
 END LOOP;
 result:=subtotal+round(subtotal*reserve/100,2);
 IF result>99999999.99 THEN RAISE EXCEPTION 'Szacowany koszt przekracza maksymalną kwotę.'; END IF;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION public.offer_logistics_estimate_total(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.offer_logistics_estimate_total(jsonb) TO authenticated,service_role;

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
     list_price:=list_price+round(source.unit_price*qty,2);
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
NOTIFY pgrst, 'reload schema';
COMMIT;
