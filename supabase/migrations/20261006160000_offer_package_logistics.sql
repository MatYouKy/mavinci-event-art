BEGIN;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS logistics_cost_net numeric(10,2)
 CHECK (logistics_cost_net >= 0 AND logistics_cost_net <= 99999999.99);
COMMENT ON COLUMN public.offers.logistics_cost_net IS 'Wewnętrzny wspólny koszt realizacji, niezależny od dopłaty klienta. NULL = brak oszacowania; 0 = potwierdzony brak dodatkowego kosztu. Nie obejmuje kosztów już ujętych w pozycjach.';

CREATE OR REPLACE FUNCTION public.save_offer_packages_and_logistics(
 p_offer_id uuid, p_revision bigint, p_packages jsonb, p_enabled boolean, p_logistics jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
DECLARE o public.offers%ROWTYPE; p jsonb; i jsonb; source public.offer_items%ROWTYPE;
 ids uuid[]; pid uuid; idx integer:=0; item_idx integer; list_price numeric; discount numeric;
 cost numeric; price numeric; qty numeric;
BEGIN
 SELECT * INTO o FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.sales_can_manage_offer(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do edycji oferty.'; END IF;
 IF o.status='accepted' OR o.sales_channel='seller_portal' THEN RAISE EXCEPTION 'Tej oferty nie można edytować w tym miejscu.'; END IF;
 IF o.content_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Oferta zmieniła się od otwarcia edytora. Zamknij okno i odśwież stronę przed ponownym zapisem.'; END IF;
 IF p_logistics IS NOT NULL THEN
   cost := (p_logistics->>'cost_net')::numeric;
   price := (p_logistics->>'price_net')::numeric;
   IF cost IS NULL OR cost<0 OR cost>99999999.99 OR cost<>round(cost,2) OR price IS NULL OR price<0 OR price>99999999.99 OR price<>round(price,2) THEN RAISE EXCEPTION 'Podaj nieujemny koszt i cenę logistyki z maksymalnie dwoma miejscami po przecinku.'; END IF;
   IF length(coalesce(p_logistics->>'description',''))>1000 THEN RAISE EXCEPTION 'Opis logistyki może mieć maksymalnie 1000 znaków.'; END IF;
   UPDATE public.offers SET logistics_cost_net=cost, logistics_price_net=price,
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
REVOKE ALL ON FUNCTION public.save_offer_packages_and_logistics(uuid,bigint,jsonb,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_offer_packages_and_logistics(uuid,bigint,jsonb,boolean,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.recalculate_offer_after_logistics() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $body$
BEGIN
 IF NEW.sales_channel IS DISTINCT FROM 'seller_portal' AND (NEW.logistics_enabled IS DISTINCT FROM OLD.logistics_enabled OR NEW.logistics_price_net IS DISTINCT FROM OLD.logistics_price_net OR NEW.logistics_cost_net IS DISTINCT FROM OLD.logistics_cost_net) THEN
  PERFORM public.calculate_offer_totals(NEW.id);
 END IF;
 RETURN NEW;
END;
$body$;
DROP TRIGGER IF EXISTS recalculate_offer_after_logistics ON public.offers;
CREATE TRIGGER recalculate_offer_after_logistics AFTER UPDATE OF logistics_enabled,logistics_price_net,logistics_cost_net ON public.offers FOR EACH ROW EXECUTE FUNCTION public.recalculate_offer_after_logistics();

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

  v_total_cost := v_total_cost + coalesce((SELECT logistics_cost_net FROM public.offers WHERE id=offer_uuid),0);
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
    margin_amount = v_subtotal - v_discount_amount - v_total_cost,
    margin_percent = CASE
      WHEN v_subtotal - v_discount_amount > 0
        THEN (v_subtotal - v_discount_amount - v_total_cost) / (v_subtotal - v_discount_amount) * 100
      ELSE 0
    END
  WHERE id = offer_uuid;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.import_costs_from_accepted_offer(p_offer_id uuid, p_event_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_costs_added integer := 0;
v_product_category_id uuid;
v_transport_category_id uuid;
v_logistics_category_id uuid;
v_staff_category_id uuid;
item_record record;
staff_record record;
package_record jsonb;
package_cost jsonb;
shared_logistics numeric;
BEGIN
-- Sprawdź czy już nie zaimportowano kosztów z tej oferty
IF EXISTS (
SELECT 1 FROM event_costs ec
WHERE ec.event_id = p_event_id 
AND ec.notes LIKE '%Automatycznie z oferty%' || p_offer_id::text || '%'
) THEN
RETURN 0;
END IF;

-- Pobierz ID kategorii
SELECT id INTO v_product_category_id FROM event_cost_categories WHERE name ILIKE '%produkt%' OR name ILIKE '%sprzęt%' LIMIT 1;
SELECT id INTO v_transport_category_id FROM event_cost_categories WHERE name ILIKE '%transport%' LIMIT 1;
SELECT id INTO v_logistics_category_id FROM event_cost_categories WHERE name ILIKE '%logistyk%' LIMIT 1;
SELECT id INTO v_staff_category_id FROM event_cost_categories WHERE name ILIKE '%personel%' OR name ILIKE '%pracown%' LIMIT 1;

IF v_staff_category_id IS NULL THEN
INSERT INTO event_cost_categories (name, description, icon, color)
VALUES ('Personel', 'Koszty wynagrodzeń pracowników', 'users', '#10b981')
RETURNING id INTO v_staff_category_id;
END IF;

IF v_product_category_id IS NULL THEN
SELECT id INTO v_product_category_id FROM event_cost_categories LIMIT 1;
END IF;

-- FIXED: Use offer_items instead of offer_products
FOR item_record IN 
SELECT 
oi.*
FROM offer_items oi
WHERE oi.offer_id = p_offer_id
LOOP
-- Selected package: use its own internal cost snapshot, never base staff/transport.
IF NULLIF(item_record.pricing_configuration->'product_package','null'::jsonb) IS NOT NULL THEN
  SELECT option INTO package_record
  FROM jsonb_array_elements(item_record.pricing_configuration#>'{product_package,options}') option
  WHERE option->>'id' = item_record.pricing_configuration#>>'{product_package,selected_id}' LIMIT 1;
  FOR package_cost IN SELECT value FROM jsonb_array_elements(COALESCE(NULLIF(package_record->'cost_items','null'::jsonb),'[]'::jsonb) || public.package_staff_cost_items(package_record->'resources')) LOOP
    IF (package_cost->>'quantity')::numeric * (package_cost->>'unit_cost_net')::numeric > 0 THEN
      INSERT INTO event_costs(event_id,category_id,name,description,amount,cost_date,status,payment_method,notes)
      VALUES(p_event_id,CASE WHEN package_cost ? 'staff_requirement_id' THEN v_staff_category_id ELSE v_product_category_id END,item_record.name || ' — ' || (package_cost->>'name'),
        'Koszt z konfiguracji pakietu: ' || (package_cost->>'quantity') || ' × ' || (package_cost->>'unit_cost_net') || ' zł / pakiet; rozliczenie: ' || CASE COALESCE(package_cost->>'settlement_method','invoice') WHEN 'cash_non_deductible' THEN 'gotówka, finansowanie z zysku' WHEN 'cash_documented' THEN 'gotówka z dokumentem' ELSE 'faktura / rachunek' END,
        public.package_cost_line_net(package_cost) * item_record.quantity,
        CURRENT_DATE,'pending',CASE WHEN package_cost->>'settlement_method' IN ('cash_documented','cash_non_deductible') THEN 'cash' ELSE 'transfer' END,'Automatycznie z oferty ' || p_offer_id::text);
      v_costs_added := v_costs_added + 1;
    END IF;
  END LOOP;
  CONTINUE;
END IF;
-- Import item cost (unit_cost × quantity)
IF COALESCE(item_record.unit_cost, 0) > 0 THEN
INSERT INTO event_costs (
event_id,
category_id,
name,
description,
amount,
cost_date,
status,
payment_method,
notes
) VALUES (
p_event_id,
v_product_category_id,
item_record.name || ' (koszt produktu)',
'Koszt jednostkowy: ' || COALESCE(item_record.unit_cost, 0)::text || ' PLN, Ilość: ' || item_record.quantity::text,
COALESCE(item_record.unit_cost, 0) * item_record.quantity,
CURRENT_DATE,
'pending',
'transfer',
'Automatycznie z oferty ' || p_offer_id::text
);
v_costs_added := v_costs_added + 1;
END IF;

-- Import transport cost
IF COALESCE(item_record.transport_cost, 0) > 0 THEN
INSERT INTO event_costs (
event_id,
category_id,
name,
description,
amount,
cost_date,
status,
payment_method,
notes
) VALUES (
p_event_id,
COALESCE(v_transport_category_id, v_product_category_id),
item_record.name || ' (transport)',
'Koszt transportu dla ' || item_record.quantity::text || ' szt.',
COALESCE(item_record.transport_cost, 0),
CURRENT_DATE,
'pending',
'transfer',
'Automatycznie z oferty ' || p_offer_id::text
);
v_costs_added := v_costs_added + 1;
END IF;

-- Import logistics cost
IF COALESCE(item_record.logistics_cost, 0) > 0 THEN
INSERT INTO event_costs (
event_id,
category_id,
name,
description,
amount,
cost_date,
status,
payment_method,
notes
) VALUES (
p_event_id,
COALESCE(v_logistics_category_id, v_product_category_id),
item_record.name || ' (logistyka)',
'Koszt logistyki dla ' || item_record.quantity::text || ' szt.',
COALESCE(item_record.logistics_cost, 0),
CURRENT_DATE,
'pending',
'transfer',
'Automatycznie z oferty ' || p_offer_id::text
);
v_costs_added := v_costs_added + 1;
END IF;
END LOOP;

-- Import staff costs from offer_product_staff (if product_id links exist)
FOR staff_record IN
SELECT 
ops.*,
oi.name as item_name
FROM offer_product_staff ops
JOIN offer_items oi ON ops.product_id = oi.product_id
WHERE oi.offer_id = p_offer_id
AND NULLIF(oi.pricing_configuration->'product_package','null'::jsonb) IS NULL
LOOP
DECLARE
staff_cost numeric;
BEGIN
staff_cost := staff_record.quantity * 
COALESCE(staff_record.hourly_rate, 0) * 
COALESCE(staff_record.estimated_hours, 0);

IF staff_cost > 0 THEN
INSERT INTO event_costs (
event_id,
category_id,
name,
description,
amount,
cost_date,
status,
payment_method,
notes
) VALUES (
p_event_id,
v_staff_category_id,
staff_record.role || ' - ' || staff_record.item_name,
'Stawka: ' || COALESCE(staff_record.hourly_rate, 0)::text || ' PLN/h × ' || 
COALESCE(staff_record.estimated_hours, 0)::text || 'h × ' || 
staff_record.quantity::text || ' os. (' || staff_record.payment_type || ')',
staff_cost,
CURRENT_DATE,
'pending',
CASE 
WHEN staff_record.payment_type = 'cash' THEN 'cash'
ELSE 'transfer'
END,
'Automatycznie z oferty ' || p_offer_id::text || ' - ' || staff_record.role
);
v_costs_added := v_costs_added + 1;
END IF;
END;
END LOOP;

-- Shared offer logistics is an internal cost even when no customer surcharge is shown.
SELECT logistics_cost_net INTO shared_logistics FROM public.offers WHERE id=p_offer_id;
IF coalesce(shared_logistics,0)>0 THEN
 INSERT INTO public.event_costs(event_id,category_id,name,description,amount,cost_date,status,payment_method,notes)
 VALUES(p_event_id,coalesce(v_logistics_category_id,v_product_category_id),'Logistyka realizacji',
 'Wspólny koszt wewnętrzny oferty, niezależny od osobnej dopłaty klienta.',shared_logistics,CURRENT_DATE,'pending','transfer','Automatycznie z oferty ' || p_offer_id::text || ' — logistyka wspólna');
 v_costs_added:=v_costs_added+1;
END IF;
RETURN v_costs_added;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_offer_selected_equipment(p_offer_id uuid, p_package_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(item_type text, item_id uuid, qty bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH source_lines AS (
  SELECT
    item.product_id,
    item.product_variant_id,
    item.quantity::numeric AS quantity,
    item.pricing_configuration
  FROM public.offer_items item
  WHERE item.offer_id = p_offer_id
    AND p_package_id IS NULL

  UNION ALL

  SELECT
    item.product_id,
    item.product_variant_id,
    item.quantity,
    CASE WHEN source.product_variant_id IS NOT DISTINCT FROM item.product_variant_id THEN source.pricing_configuration ELSE NULL::jsonb END AS pricing_configuration
  FROM public.offer_package_items item
  JOIN public.offer_packages package ON package.id = item.package_id
  LEFT JOIN public.offer_items source ON source.id=item.offer_item_id AND source.offer_id=package.offer_id
  WHERE package.offer_id = p_offer_id
    AND package.id = p_package_id
), selected_equipment AS (
  SELECT
    source.quantity AS source_quantity,
    equipment.quantity AS equipment_quantity,
    equipment.equipment_item_id,
    equipment.equipment_kit_id
  FROM source_lines source
  CROSS JOIN LATERAL public.resolve_offer_line_equipment(source.product_id, source.product_variant_id, source.pricing_configuration) equipment
  WHERE equipment.is_optional = false
), base_equipment AS (
  SELECT 'item'::text AS item_type, equipment_item_id AS item_id,
    SUM(source_quantity * COALESCE(equipment_quantity, 1))::bigint AS qty
  FROM selected_equipment
  WHERE equipment_item_id IS NOT NULL
  GROUP BY equipment_item_id

  UNION ALL

  SELECT 'kit'::text AS item_type, equipment_kit_id AS item_id,
    SUM(source_quantity * COALESCE(equipment_quantity, 1))::bigint AS qty
  FROM selected_equipment
  WHERE equipment_kit_id IS NOT NULL
  GROUP BY equipment_kit_id
), adjusted_equipment AS (
  SELECT item_type, item_id, qty FROM base_equipment
  UNION ALL
  SELECT 'item'::text, substitution.from_item_id, -substitution.qty::bigint
  FROM public.offer_equipment_substitutions substitution
  WHERE substitution.offer_id = p_offer_id
  UNION ALL
  SELECT 'item'::text, substitution.to_item_id, substitution.qty::bigint
  FROM public.offer_equipment_substitutions substitution
  WHERE substitution.offer_id = p_offer_id
)
SELECT adjusted_equipment.item_type, adjusted_equipment.item_id, SUM(adjusted_equipment.qty)::bigint
FROM adjusted_equipment
GROUP BY adjusted_equipment.item_type, adjusted_equipment.item_id
HAVING SUM(adjusted_equipment.qty) > 0;
$function$
;
NOTIFY pgrst, 'reload schema';
COMMIT;
