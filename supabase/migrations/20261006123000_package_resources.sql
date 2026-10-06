BEGIN;

-- Package resources are stored in the existing JSON snapshot. Catalog edits do
-- not mutate previously saved offers or event reservations.
CREATE OR REPLACE FUNCTION public.resolve_offer_line_equipment(
  p_product_id uuid, p_variant_id uuid, p_configuration jsonb
) RETURNS TABLE(equipment_item_id uuid, equipment_kit_id uuid, quantity integer, is_optional boolean, notes text)
LANGUAGE plpgsql STABLE SET search_path = public AS $body$
DECLARE
  chosen jsonb;
  resources jsonb;
  row_data jsonb;
  item_id uuid;
  kit_id uuid;
  row_quantity numeric;
BEGIN
  IF NULLIF(p_configuration->'product_package', 'null'::jsonb) IS NOT NULL THEN
    SELECT option INTO chosen
    FROM jsonb_array_elements(p_configuration#>'{product_package,options}') option
    WHERE option->>'id' = p_configuration#>>'{product_package,selected_id}' LIMIT 1;
    resources := chosen->'resources';
    IF chosen IS NULL OR resources IS NULL OR resources = 'null'::jsonb
      OR jsonb_typeof(resources->'equipment') IS DISTINCT FROM 'array'
      OR jsonb_typeof(resources->'staff') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Uzupełnij sprzęt i obsadę wybranego pakietu w pozycji oferty przed sprawdzeniem dostępności lub rezerwacją.';
    END IF;
    FOR row_data IN SELECT value FROM jsonb_array_elements(resources->'equipment') LOOP
      item_id := NULLIF(row_data->>'equipment_item_id','')::uuid;
      kit_id := NULLIF(row_data->>'equipment_kit_id','')::uuid;
      row_quantity := (row_data->>'quantity')::numeric;
      IF (item_id IS NULL) = (kit_id IS NULL) OR row_quantity IS NULL OR row_quantity < 1 OR row_quantity > 10000 OR trunc(row_quantity) <> row_quantity THEN
        RAISE EXCEPTION 'Nieprawidłowy sprzęt lub ilość w konfiguracji pakietu.';
      END IF;
      IF (item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.equipment_items e WHERE e.id = item_id))
         OR (kit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.equipment_kits k WHERE k.id = kit_id)) THEN
        RAISE EXCEPTION 'Sprzęt pakietu nie istnieje już w katalogu. Zaktualizuj zasoby pozycji oferty.';
      END IF;
      RETURN QUERY SELECT item_id, kit_id, row_quantity::integer, COALESCE((row_data->>'is_optional')::boolean,false), row_data->>'notes';
    END LOOP;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT e.equipment_item_id, e.equipment_kit_id, COALESCE(e.quantity,1), COALESCE(e.is_optional,false), e.notes
    FROM public.offer_product_equipment e
    LEFT JOIN public.offer_product_variants v ON v.id = p_variant_id AND v.product_id = p_product_id
    WHERE e.product_id = p_product_id AND e.replaced_by_rental_id IS NULL
      AND ((COALESCE(v.overrides_equipment,false) AND e.product_variant_id = p_variant_id)
        OR (NOT COALESCE(v.overrides_equipment,false) AND e.product_variant_id IS NULL));
END;
$body$;
REVOKE ALL ON FUNCTION public.resolve_offer_line_equipment(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_offer_line_equipment(uuid,uuid,jsonb) TO authenticated, service_role;

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
    NULL::jsonb AS pricing_configuration
  FROM public.offer_package_items item
  JOIN public.offer_packages package ON package.id = item.package_id
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

CREATE OR REPLACE FUNCTION public.check_offer_cart_equipment_conflicts_v2(p_event_id uuid, p_items jsonb, p_substitutions jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_start_date timestamptz;
  v_end_date timestamptz;

  v_result jsonb := '[]'::jsonb;
  v_item_demand jsonb := '{}'::jsonb;
  v_substitutions_map jsonb := '{}'::jsonb;

  v_product record;
  v_equipment record;
  v_kit_item record;

  v_product_id uuid;
  v_product_quantity integer;

  v_item_id text;
  v_demand integer;
  v_existing_demand integer;

  v_available integer;
  v_reserved integer;
  v_total integer;
  v_item_name text;

  v_conflict jsonb;
BEGIN
  SELECT event_date, event_end_date
  INTO v_start_date, v_end_date
  FROM public.events
  WHERE id = p_event_id;

  IF v_start_date IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_end_date IS NULL THEN
    v_end_date := v_start_date + interval '1 day';
  END IF;

  FOR v_product IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_substitutions, '[]'::jsonb))
  LOOP
    IF NULLIF(v_product.value->>'from_item_id', '') IS NOT NULL THEN
      v_substitutions_map := jsonb_set(
        v_substitutions_map,
        ARRAY[v_product.value->>'from_item_id'],
        v_product.value
      );
    END IF;
  END LOOP;

  FOR v_product IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF NULLIF(v_product.value->>'product_id', '') IS NULL THEN
      CONTINUE;
    END IF;

    v_product_id := (v_product.value->>'product_id')::uuid;
    v_product_quantity := COALESCE(NULLIF(v_product.value->>'quantity', '')::integer, 1);

    FOR v_equipment IN
      SELECT
        ope.equipment_item_id,
        ope.equipment_kit_id,
        COALESCE(ope.quantity, 1) AS product_qty,
        COALESCE(ope.is_optional, false) AS is_optional
      FROM public.resolve_offer_line_equipment(
        v_product_id, NULLIF(v_product.value->>'product_variant_id','')::uuid,
        v_product.value->'pricing_configuration'
      ) ope
      WHERE ope.is_optional = false
    LOOP
      IF v_equipment.equipment_kit_id IS NOT NULL THEN
        FOR v_kit_item IN
          SELECT
            eki.equipment_id AS item_id,
            COALESCE(eki.quantity, 1) AS kit_item_qty
          FROM public.equipment_kit_items eki
          WHERE eki.kit_id = v_equipment.equipment_kit_id
            AND eki.equipment_id IS NOT NULL
        LOOP
          v_item_id := v_kit_item.item_id::text;
          v_demand := v_product_quantity * v_equipment.product_qty * v_kit_item.kit_item_qty;

          IF v_substitutions_map ? v_item_id THEN
            v_item_id := v_substitutions_map->v_item_id->>'to_item_id';
            v_demand := COALESCE(
              NULLIF(v_substitutions_map->(v_kit_item.item_id::text)->>'qty', '')::integer,
              v_demand
            );
          END IF;

          IF NULLIF(v_item_id, '') IS NULL THEN
            CONTINUE;
          END IF;

          v_existing_demand := COALESCE((v_item_demand->>v_item_id)::integer, 0);

          v_item_demand := jsonb_set(
            v_item_demand,
            ARRAY[v_item_id],
            to_jsonb(v_existing_demand + v_demand),
            true
          );
        END LOOP;

      ELSIF v_equipment.equipment_item_id IS NOT NULL THEN
        v_item_id := v_equipment.equipment_item_id::text;
        v_demand := v_product_quantity * v_equipment.product_qty;

        IF v_substitutions_map ? v_item_id THEN
          v_item_id := v_substitutions_map->v_item_id->>'to_item_id';
          v_demand := COALESCE(
            NULLIF(v_substitutions_map->(v_equipment.equipment_item_id::text)->>'qty', '')::integer,
            v_demand
          );
        END IF;

        IF NULLIF(v_item_id, '') IS NULL THEN
          CONTINUE;
        END IF;

        v_existing_demand := COALESCE((v_item_demand->>v_item_id)::integer, 0);

        v_item_demand := jsonb_set(
          v_item_demand,
          ARRAY[v_item_id],
          to_jsonb(v_existing_demand + v_demand),
          true
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR v_item_id IN
    SELECT * FROM jsonb_object_keys(v_item_demand)
  LOOP
    v_demand := COALESCE((v_item_demand->>v_item_id)::integer, 0);

    SELECT COUNT(*)
    INTO v_total
    FROM public.equipment_units eu
    WHERE eu.equipment_id = v_item_id::uuid
      AND eu.status IN ('available', 'in_use');

    SELECT COALESCE(SUM(
      CASE
        WHEN eb.event_id = p_event_id THEN 0
        ELSE COALESCE(eb.quantity, 0)
      END
    ), 0)
    INTO v_reserved
    FROM public.equipment_bookings eb
    WHERE eb.equipment_id = v_item_id::uuid
      AND eb.start_date < v_end_date
      AND eb.end_date > v_start_date;

    v_available := GREATEST(COALESCE(v_total, 0) - COALESCE(v_reserved, 0), 0);

    IF v_demand > v_available THEN
      SELECT ei.name
      INTO v_item_name
      FROM public.equipment_items ei
      WHERE ei.id = v_item_id::uuid;

      v_conflict := jsonb_build_object(
        'item_type', 'item',
        'item_id', v_item_id,
        'equipment_id', v_item_id,
        'item_name', COALESCE(v_item_name, 'Nieznany sprzęt'),
        'required_qty', v_demand,
        'total_qty', COALESCE(v_total, 0),
        'reserved_qty', COALESCE(v_reserved, 0),
        'available_qty', COALESCE(v_available, 0),
        'shortage_qty', v_demand - COALESCE(v_available, 0),
        'conflict_until', null,
        'conflicts', '[]'::jsonb,
        'alternatives', '[]'::jsonb
      );

      v_result := v_result || jsonb_build_array(v_conflict);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_offer_equipment_final(p_offer_id uuid)
 RETURNS TABLE(equipment_item_id uuid, equipment_kit_id uuid, qty bigint)
 LANGUAGE sql
 STABLE
AS $function$
WITH 
-- Individual items from products
individual_items AS (
SELECT
ope.equipment_item_id,
NULL::uuid as equipment_kit_id,
SUM(oi.quantity * ope.quantity) as qty
FROM offer_items oi
CROSS JOIN LATERAL public.resolve_offer_line_equipment(oi.product_id, oi.product_variant_id, oi.pricing_configuration) ope
WHERE oi.offer_id = p_offer_id
AND ope.equipment_item_id IS NOT NULL
AND ope.is_optional = false
GROUP BY ope.equipment_item_id
),

-- Kits from products (as whole units)
kits AS (
SELECT
NULL::uuid as equipment_item_id,
ope.equipment_kit_id,
SUM(oi.quantity * ope.quantity) as qty
FROM offer_items oi
CROSS JOIN LATERAL public.resolve_offer_line_equipment(oi.product_id, oi.product_variant_id, oi.pricing_configuration) ope
WHERE oi.offer_id = p_offer_id
AND ope.equipment_kit_id IS NOT NULL
AND ope.is_optional = false
GROUP BY ope.equipment_kit_id
),

-- Expanded items from kits (SKIP CABLES)
kit_items_expanded AS (
SELECT
eki.equipment_id as equipment_item_id,
NULL::uuid as equipment_kit_id,
SUM(oi.quantity * ope.quantity * eki.quantity) as qty
FROM offer_items oi
CROSS JOIN LATERAL public.resolve_offer_line_equipment(oi.product_id, oi.product_variant_id, oi.pricing_configuration) ope
JOIN equipment_kit_items eki ON eki.kit_id = ope.equipment_kit_id
WHERE oi.offer_id = p_offer_id
AND ope.equipment_kit_id IS NOT NULL
AND ope.is_optional = false
AND eki.equipment_id IS NOT NULL  -- Skip cables
GROUP BY eki.equipment_id
),

-- Combine individual items and kit items
base AS (
SELECT equipment_item_id, equipment_kit_id, qty FROM individual_items
UNION ALL
SELECT equipment_item_id, equipment_kit_id, qty FROM kits
UNION ALL
SELECT equipment_item_id, equipment_kit_id, qty FROM kit_items_expanded
),

-- Aggregate by item/kit
aggregated AS (
SELECT
equipment_item_id,
equipment_kit_id,
SUM(qty) as qty
FROM base
GROUP BY equipment_item_id, equipment_kit_id
),

-- Substitutions: items to remove
sub_minus AS (
SELECT
oes.from_item_id as equipment_item_id,
SUM(oes.qty) as qty
FROM offer_equipment_substitutions oes
WHERE oes.offer_id = p_offer_id
GROUP BY oes.from_item_id
),

-- Substitutions: items to add
sub_plus AS (
SELECT
oes.to_item_id as equipment_item_id,
SUM(oes.qty) as qty
FROM offer_equipment_substitutions oes
WHERE oes.offer_id = p_offer_id
GROUP BY oes.to_item_id
),

-- Apply substitutions only to equipment_items (not kits)
final AS (
SELECT
COALESCE(a.equipment_item_id, sm.equipment_item_id, sp.equipment_item_id) as equipment_item_id,
a.equipment_kit_id,
CASE 
WHEN a.equipment_kit_id IS NOT NULL THEN a.qty  -- Kits: no substitution
ELSE COALESCE(a.qty, 0) - COALESCE(sm.qty, 0) + COALESCE(sp.qty, 0)  -- Items: apply substitutions
END as qty
FROM aggregated a
FULL JOIN sub_minus sm ON sm.equipment_item_id = a.equipment_item_id AND a.equipment_kit_id IS NULL
FULL JOIN sub_plus sp ON sp.equipment_item_id = COALESCE(a.equipment_item_id, sm.equipment_item_id) AND a.equipment_kit_id IS NULL
)

SELECT
equipment_item_id,
equipment_kit_id,
qty
FROM final
WHERE qty > 0
ORDER BY equipment_kit_id NULLS LAST, qty DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_event_equipment_from_offer(p_event_id uuid, p_item_type text, p_item_id uuid)
 RETURNS TABLE(event_equipment_id uuid, event_id uuid, equipment_id uuid, kit_id uuid, quantity integer, offer_quantity integer, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_offer_id uuid;
begin
  -- bierzemy najnowszą ofertę przypiętą do eventu
  select o.id
  into v_offer_id
  from public.offers o
  where o.event_id = p_event_id
  order by o.created_at desc nulls last
  limit 1;

  if v_offer_id is null then
    return;
  end if;

  return query
  with src as (
    select
      p_event_id as src_event_id,
      case when p_item_type = 'item' then p_item_id else null::uuid end as src_equipment_id,
      case when p_item_type = 'kit'  then p_item_id else null::uuid end as src_kit_id,
      sum(coalesce(oi.quantity, 1) * coalesce(ope.quantity, 1))::int as offer_qty
    from public.offer_items oi
    cross join lateral public.resolve_offer_line_equipment(oi.product_id, oi.product_variant_id, oi.pricing_configuration) ope
    where oi.offer_id = v_offer_id
      and (
        (p_item_type = 'item' and ope.equipment_item_id = p_item_id)
        or
        (p_item_type = 'kit'  and ope.equipment_kit_id  = p_item_id)
      )
      and coalesce(oi.quantity, 1) > 0
      and coalesce(ope.quantity, 1) > 0
      and coalesce(ope.is_optional, false) = false
    group by 1,2,3
  ),
  upd as (
    update public.event_equipment ee
    set
      quantity = s.offer_qty,
      offer_quantity = s.offer_qty,
      auto_added = true,
      is_overridden = false,
      removed_from_offer = false,
      status = 'draft',
      updated_at = now()
    from src s
    where ee.event_id = s.src_event_id
      and (
        (s.src_equipment_id is not null and ee.equipment_id = s.src_equipment_id)
        or
        (s.src_kit_id is not null and ee.kit_id = s.src_kit_id)
      )
    returning
      ee.id as event_equipment_id,
      ee.event_id as event_id,
      ee.equipment_id as equipment_id,
      ee.kit_id as kit_id,
      ee.quantity::int as quantity,
      ee.offer_quantity::int as offer_quantity,
      ee.status::text as status
  ),
  ins as (
    insert into public.event_equipment as ee (
      event_id, equipment_id, kit_id,
      quantity, offer_quantity,
      auto_added, is_overridden, removed_from_offer,
      status
    )
    select
      s.src_event_id,
      s.src_equipment_id,
      s.src_kit_id,
      s.offer_qty,
      s.offer_qty,
      true,
      false,
      false,
      'draft'
    from src s
    where not exists (
      select 1
      from public.event_equipment ee2
      where ee2.event_id = s.src_event_id
        and (
          (s.src_equipment_id is not null and ee2.equipment_id = s.src_equipment_id)
          or
          (s.src_kit_id is not null and ee2.kit_id = s.src_kit_id)
        )
    )
    returning
      ee.id as event_equipment_id,
      ee.event_id as event_id,
      ee.equipment_id as equipment_id,
      ee.kit_id as kit_id,
      ee.quantity::int as quantity,
      ee.offer_quantity::int as offer_quantity,
      ee.status::text as status
  )
  select * from upd
  union all
  select * from ins;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_assign_equipment_from_offer_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_event_id uuid;
v_offer_id uuid;
v_product_equipment RECORD;
v_existing_count integer;
v_clean_equipment_id uuid;
v_clean_kit_id uuid;
v_final_equipment_id uuid;
v_substitution RECORD;
BEGIN
-- Pobierz offer_id i event_id
v_offer_id := NEW.offer_id;

SELECT event_id INTO v_event_id
FROM offers
WHERE id = v_offer_id;

-- Jeśli nie ma powiązanego eventu, zakończ
IF v_event_id IS NULL THEN
RETURN NEW;
END IF;

-- Tylko jeśli offer_item ma product_id
IF NEW.product_id IS NOT NULL AND NEW.product_id::text != '' THEN

-- Iteruj przez wszystkie pozycje sprzętu przypisane do produktu (INCLUDING OPTIONAL)
FOR v_product_equipment IN
SELECT 
equipment_item_id, 
equipment_kit_id,
quantity,
is_optional,
notes
FROM public.resolve_offer_line_equipment(NEW.product_id, NEW.product_variant_id, NEW.pricing_configuration)
LOOP

-- Wyczyść puste stringi do NULL
v_clean_equipment_id := NULLIF(v_product_equipment.equipment_item_id::text, '')::uuid;
v_clean_kit_id := NULLIF(v_product_equipment.equipment_kit_id::text, '')::uuid;

-- 1. OBSŁUGA POJEDYNCZEGO SPRZĘTU (equipment_item_id)
IF v_clean_equipment_id IS NOT NULL THEN

-- SPRAWDŹ CZY JEST SUBSTYTUCJA
v_final_equipment_id := v_clean_equipment_id;

SELECT * INTO v_substitution
FROM offer_equipment_substitutions
WHERE offer_id = v_offer_id
AND from_item_id = v_clean_equipment_id
LIMIT 1;

IF v_substitution.to_item_id IS NOT NULL THEN
v_final_equipment_id := v_substitution.to_item_id;
END IF;

-- Sprawdź czy sprzęt już nie jest przypisany do tego eventu
SELECT COUNT(*) INTO v_existing_count
FROM event_equipment
WHERE event_id = v_event_id
AND equipment_id = v_final_equipment_id;

IF v_existing_count = 0 THEN
INSERT INTO event_equipment (
event_id,
equipment_id,
quantity,
status,
notes,
auto_added,
offer_id,
is_optional
) VALUES (
v_event_id,
v_final_equipment_id,
v_product_equipment.quantity * NEW.quantity,
'reserved',
CASE 
WHEN v_substitution.to_item_id IS NOT NULL 
THEN 'Alternatywa z oferty dla: ' || NEW.name
ELSE 'Z produktu: ' || NEW.name
END,
true,
v_offer_id,
v_product_equipment.is_optional
);
ELSE
UPDATE event_equipment
SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
notes = COALESCE(notes || E'\n', '') || 'Zwiększono z produktu: ' || NEW.name,
is_optional = v_product_equipment.is_optional
WHERE event_id = v_event_id
AND equipment_id = v_final_equipment_id;
END IF;
END IF;

-- 2. OBSŁUGA ZESTAWU (equipment_kit_id)
-- Dodajemy tylko zestaw jako całość, bez rozpakowywania zawartości
-- Rezerwacje zawartości zestawu obsługuje funkcja sync_equipment_bookings_for_event
IF v_clean_kit_id IS NOT NULL THEN
-- Sprawdź czy zestaw już nie jest przypisany do tego eventu
SELECT COUNT(*) INTO v_existing_count
FROM event_equipment
WHERE event_id = v_event_id
AND kit_id = v_clean_kit_id;

IF v_existing_count = 0 THEN
-- Dodaj nowy zestaw
INSERT INTO event_equipment (
event_id,
kit_id,
quantity,
status,
notes,
auto_added,
offer_id,
is_optional
) VALUES (
v_event_id,
v_clean_kit_id,
v_product_equipment.quantity * NEW.quantity,
'reserved',
'Zestaw z produktu: ' || NEW.name,
true,
v_offer_id,
v_product_equipment.is_optional
);
ELSE
-- Zwiększ ilość istniejącego zestawu
UPDATE event_equipment
SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
notes = COALESCE(notes || E'\n', '') || 'Zwiększono zestaw z produktu: ' || NEW.name,
is_optional = v_product_equipment.is_optional
WHERE event_id = v_event_id
AND kit_id = v_clean_kit_id;
END IF;
END IF;

END LOOP;

END IF;

RETURN NEW;
EXCEPTION
WHEN OTHERS THEN
RAISE WARNING 'Error in auto_assign_equipment_from_offer_product: % %', SQLERRM, SQLSTATE;
RETURN NEW;
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
        'Koszt z konfiguracji pakietu: ' || (package_cost->>'quantity') || ' × ' || (package_cost->>'unit_cost_net') || ' zł netto / pakiet',
        round((package_cost->>'quantity')::numeric * (package_cost->>'unit_cost_net')::numeric,2) * item_record.quantity,
        CURRENT_DATE,'pending','transfer','Automatycznie z oferty ' || p_offer_id::text);
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
$function$
;

NOTIFY pgrst, 'reload schema';
COMMIT;
