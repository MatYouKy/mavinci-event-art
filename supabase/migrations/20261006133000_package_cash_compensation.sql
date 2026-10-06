BEGIN;
CREATE OR REPLACE FUNCTION public.package_cost_line_net(p_cost jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $body$
DECLARE
  amount numeric := (p_cost->>'quantity')::numeric * (p_cost->>'unit_cost_net')::numeric;
  cit numeric;
  dividend numeric;
BEGIN
  IF p_cost->>'settlement_method' = 'cash_non_deductible' THEN
    cit := (p_cost#>>'{compensation_snapshot,cit_rate}')::numeric;
    dividend := (p_cost#>>'{compensation_snapshot,dividend_rate}')::numeric;
    IF cit IS NULL OR dividend IS NULL OR NOT (cit >= 0 AND cit < 100 AND dividend >= 0 AND dividend < 100) THEN
      RAISE EXCEPTION 'Brakuje poprawnych parametrów rozliczenia gotówki w koszcie pakietu.';
    END IF;
    amount := amount / ((1 - cit / 100) * (1 - dividend / 100));
  END IF;
  RETURN round(amount,2);
END;
$body$;
REVOKE ALL ON FUNCTION public.package_cost_line_net(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_cost_line_net(jsonb) TO authenticated, service_role;
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
  FOR package_cost IN SELECT value FROM jsonb_array_elements(COALESCE(NULLIF(package_record->'cost_items','null'::jsonb),'[]'::jsonb)) LOOP
    IF (package_cost->>'quantity')::numeric * (package_cost->>'unit_cost_net')::numeric > 0 THEN
      INSERT INTO event_costs(event_id,category_id,name,description,amount,cost_date,status,payment_method,notes)
      VALUES(p_event_id,v_product_category_id,item_record.name || ' — ' || (package_cost->>'name'),
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

RETURN v_costs_added;
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
