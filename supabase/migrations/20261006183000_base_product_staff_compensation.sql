BEGIN;
ALTER TABLE public.offer_product_staff ADD COLUMN IF NOT EXISTS compensation jsonb;
ALTER TABLE public.offer_items ADD COLUMN IF NOT EXISTS staff_cost_snapshot jsonb;
DO $do$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.offer_product_staff'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%payment_type%' LOOP
 EXECUTE format('ALTER TABLE public.offer_product_staff DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $do$;
ALTER TABLE public.offer_product_staff ADD CONSTRAINT offer_product_staff_payment_type_check CHECK(payment_type IN ('invoice_with_vat','invoice_no_vat','cash_no_receipt','cash_documented'));

CREATE OR REPLACE FUNCTION public.product_staff_cost_lines(p_product uuid,p_variant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $body$
DECLARE s record; selected_variant uuid; result jsonb:='[]';
BEGIN
 IF p_variant IS NOT NULL AND EXISTS(SELECT 1 FROM public.offer_product_variants WHERE id=p_variant AND product_id=p_product AND overrides_staff) THEN selected_variant:=p_variant; END IF;
 FOR s IN SELECT * FROM public.offer_product_staff WHERE product_id=p_product AND product_variant_id IS NOT DISTINCT FROM selected_variant AND NOT coalesce(is_optional,false) ORDER BY created_at,id LOOP
  IF s.compensation IS NOT NULL THEN
   result:=result || public.package_staff_cost_items(jsonb_build_object('staff',jsonb_build_array(to_jsonb(s))));
  ELSIF s.hourly_rate IS NOT NULL AND coalesce(s.estimated_hours,0)>0 THEN
   result:=result || jsonb_build_array(jsonb_build_object('id','staff:'||s.id,'name',s.role,'quantity',round(s.quantity*s.estimated_hours,2),'unit_cost_net',s.hourly_rate,'settlement_method',CASE WHEN s.payment_type IN ('cash_no_receipt','cash_documented') THEN 'cash_documented' ELSE 'invoice' END,'legacy',true));
  END IF;
 END LOOP;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION public.product_staff_cost_lines(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_staff_cost_lines(uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.staff_cost_snapshot_total(p_snapshot jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $body$
 SELECT coalesce(sum(public.package_cost_line_net(value)),0) FROM jsonb_array_elements(coalesce(p_snapshot,'[]'::jsonb));
$body$;
REVOKE ALL ON FUNCTION public.staff_cost_snapshot_total(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_cost_snapshot_total(jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_product_staff_compensation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $body$
DECLARE p jsonb; cost jsonb; BEGIN
 p:=NEW.compensation;
 IF p IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'rate_basis','') NOT IN ('per_service','hourly') OR coalesce(p->>'settlement_method','') NOT IN ('invoice','cash_documented','cash_non_deductible') THEN RAISE EXCEPTION 'Wybierz sposób naliczania i rozliczenia kosztu obsady.'; END IF;
 IF NEW.quantity IS NULL OR NEW.quantity NOT BETWEEN 1 AND 10000 OR (p->>'rate') IS NULL OR (p->>'rate')::numeric<0 OR (p->>'rate')::numeric>99999999 OR (p->>'rate')::numeric<>round((p->>'rate')::numeric,2) THEN RAISE EXCEPTION 'Podaj prawidłową liczbę osób i stawkę.'; END IF;
 IF p->>'rate_basis'='hourly' AND (NEW.estimated_hours IS NULL OR NEW.estimated_hours<=0 OR NEW.estimated_hours>10000) THEN RAISE EXCEPTION 'Podaj czas pracy dla stawki godzinowej.'; END IF;
 cost:=jsonb_build_object('quantity',NEW.quantity*CASE WHEN p->>'rate_basis'='hourly' THEN NEW.estimated_hours ELSE 1 END,'unit_cost_net',(p->>'rate')::numeric,'settlement_method',p->>'settlement_method','compensation_snapshot',p->'compensation_snapshot');
 IF public.package_cost_line_net(cost)>99999999.99 THEN RAISE EXCEPTION 'Koszt obsady przekracza maksymalną kwotę.'; END IF;
 NEW.hourly_rate:=CASE WHEN p->>'rate_basis'='hourly' THEN (p->>'rate')::numeric ELSE NULL END;
 NEW.payment_type:=CASE p->>'settlement_method' WHEN 'cash_documented' THEN 'cash_documented' WHEN 'cash_non_deductible' THEN 'cash_no_receipt' ELSE CASE WHEN NEW.payment_type='invoice_no_vat' THEN 'invoice_no_vat' ELSE 'invoice_with_vat' END END;
 RETURN NEW;
END;
$body$;
CREATE TRIGGER validate_product_staff_compensation BEFORE INSERT OR UPDATE ON public.offer_product_staff FOR EACH ROW EXECUTE FUNCTION public.validate_product_staff_compensation();

CREATE OR REPLACE FUNCTION public.snapshot_offer_item_staff_cost() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
BEGIN
 IF TG_OP='INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id OR (NEW.pricing_configuration->'product_package') IS DISTINCT FROM (OLD.pricing_configuration->'product_package') OR OLD.staff_cost_snapshot IS NULL THEN
  NEW.staff_cost_snapshot:=CASE WHEN nullif(NEW.pricing_configuration->'product_package','null'::jsonb) IS NOT NULL THEN '[]'::jsonb ELSE public.product_staff_cost_lines(NEW.product_id,NEW.product_variant_id) END;
 ELSE
  NEW.staff_cost_snapshot:=OLD.staff_cost_snapshot;
 END IF;
 RETURN NEW;
END;
$body$;
CREATE TRIGGER zzz_snapshot_offer_item_staff_cost BEFORE INSERT OR UPDATE ON public.offer_items FOR EACH ROW EXECUTE FUNCTION public.snapshot_offer_item_staff_cost();

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

  v_total_cost := v_total_cost + coalesce((SELECT sum(public.staff_cost_snapshot_total(staff_cost_snapshot)*quantity) FROM public.offer_items WHERE offer_id=offer_uuid),0);
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

-- Use the immutable offer snapshot; older offers retain their existing catalog fallback.
FOR item_record IN SELECT * FROM public.offer_items WHERE offer_id=p_offer_id AND nullif(pricing_configuration->'product_package','null'::jsonb) IS NULL LOOP
 FOR package_cost IN SELECT value FROM jsonb_array_elements(coalesce(item_record.staff_cost_snapshot,public.product_staff_cost_lines(item_record.product_id,item_record.product_variant_id))) LOOP
  IF public.package_cost_line_net(package_cost)>0 THEN
   INSERT INTO public.event_costs(event_id,category_id,name,description,amount,cost_date,status,payment_method,notes)
   VALUES(p_event_id,v_staff_category_id,coalesce(package_cost->>'name','Obsada') || ' — ' || item_record.name,
    'Koszt obsady zapisany w ofercie; ' || (package_cost->>'quantity') || ' × ' || (package_cost->>'unit_cost_net') || ' zł / jednostkę produktu.',
    public.package_cost_line_net(package_cost)*item_record.quantity,CURRENT_DATE,'pending',
    CASE WHEN package_cost->>'settlement_method' IN ('cash_documented','cash_non_deductible') THEN 'cash' ELSE 'transfer' END,
    'Automatycznie z oferty ' || p_offer_id::text || ' — obsada produktu');
   v_costs_added:=v_costs_added+1;
  END IF;
 END LOOP;
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
NOTIFY pgrst, 'reload schema';
COMMIT;
