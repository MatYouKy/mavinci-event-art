/*
  # Fix conflict checker - Skip cables in kit expansion

  1. Problem
    - When expanding kits, function included cable items (where cable_id IS NOT NULL)
    - Cables have equipment_id = NULL which causes errors

  2. Solution
    - Filter out cable items when expanding kits
    - Only process kit items where equipment_id IS NOT NULL

  3. Notes
    - Cables are managed separately and don't create equipment conflicts
*/

CREATE OR REPLACE FUNCTION check_offer_cart_equipment_conflicts_v2(
  p_event_id uuid,
  p_items jsonb,
  p_substitutions jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_result jsonb := '[]'::jsonb;
  v_equipment record;
  v_kit_item record;
  v_item_demand jsonb := '{}'::jsonb;
  v_substitutions_map jsonb := '{}'::jsonb;
  v_conflict jsonb;
  v_product record;
  v_item_id text;
  v_demand integer;
  v_existing_demand integer;
  v_available integer;
  v_product_quantity integer;
  v_product_id uuid;
BEGIN
  -- Get event dates
  SELECT event_date, event_end_date INTO v_start_date, v_end_date
  FROM events
  WHERE id = p_event_id;

  IF v_start_date IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Build substitutions map for quick lookup
  FOR v_product IN SELECT * FROM jsonb_array_elements(p_substitutions)
  LOOP
    v_substitutions_map := jsonb_set(
      v_substitutions_map,
      ARRAY[(v_product.value->>'from_item_id')],
      v_product.value
    );
  END LOOP;

  -- Process each product in cart
  FOR v_product IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_product.value->>'product_id')::uuid;
    v_product_quantity := (v_product.value->>'quantity')::integer;

    -- Get equipment for this product
    FOR v_equipment IN
      SELECT
        ope.equipment_item_id,
        ope.equipment_kit_id,
        ope.cable_id,
        ope.quantity as product_qty,
        ope.is_optional
      FROM offer_product_equipment ope
      WHERE ope.product_id = v_product_id
        AND ope.is_optional = false
    LOOP

      -- If it's a kit, expand into individual items (SKIP CABLES)
      IF v_equipment.equipment_kit_id IS NOT NULL THEN
        FOR v_kit_item IN
          SELECT
            eki.equipment_id as item_id,
            eki.quantity as kit_item_qty
          FROM equipment_kit_items eki
          WHERE eki.kit_id = v_equipment.equipment_kit_id
            AND eki.equipment_id IS NOT NULL  -- Skip cables
        LOOP
          -- Calculate total demand for this item
          v_item_id := v_kit_item.item_id::text;
          v_demand := v_product_quantity * v_equipment.product_qty * v_kit_item.kit_item_qty;

          -- Check if already substituted
          IF v_substitutions_map ? v_item_id THEN
            v_item_id := v_substitutions_map->v_item_id->>'to_item_id';
            v_demand := (v_substitutions_map->(v_kit_item.item_id::text)->>'qty')::integer;
          END IF;

          -- Add to demand map
          v_existing_demand := COALESCE((v_item_demand->v_item_id)::integer, 0);
          v_item_demand := jsonb_set(
            v_item_demand,
            ARRAY[v_item_id],
            to_jsonb(v_existing_demand + v_demand)
          );
        END LOOP;

      -- If it's an individual item
      ELSIF v_equipment.equipment_item_id IS NOT NULL THEN
        v_item_id := v_equipment.equipment_item_id::text;
        v_demand := v_product_quantity * v_equipment.product_qty;

        -- Check if already substituted
        IF v_substitutions_map ? v_item_id THEN
          v_item_id := v_substitutions_map->v_item_id->>'to_item_id';
          v_demand := (v_substitutions_map->v_equipment.equipment_item_id::text->>'qty')::integer;
        END IF;

        -- Add to demand map
        v_existing_demand := COALESCE((v_item_demand->v_item_id)::integer, 0);
        v_item_demand := jsonb_set(
          v_item_demand,
          ARRAY[v_item_id],
          to_jsonb(v_existing_demand + v_demand)
        );
      END IF;
      -- Cables are skipped entirely
    END LOOP;
  END LOOP;

  -- Check each item's availability
  FOR v_item_id IN SELECT * FROM jsonb_object_keys(v_item_demand)
  LOOP
    v_demand := (v_item_demand->v_item_id)::integer;

    -- Calculate available quantity (total units - reserved)
    SELECT 
      COALESCE(COUNT(*), 0) - COALESCE(SUM(
        CASE 
          WHEN eb.event_id = p_event_id THEN 0  -- Don't count current event's bookings
          ELSE eb.quantity 
        END
      ), 0)
    INTO v_available
    FROM equipment_units eu
    LEFT JOIN equipment_bookings eb ON eb.equipment_id = eu.equipment_id
      AND eb.start_date < v_end_date
      AND eb.end_date > v_start_date
    WHERE eu.equipment_id = v_item_id::uuid
      AND eu.status IN ('available', 'in_use');

    -- If demand exceeds availability, add conflict
    IF v_demand > v_available THEN
      v_conflict := jsonb_build_object(
        'equipment_id', v_item_id,
        'required', v_demand,
        'available', v_available,
        'shortage', v_demand - v_available
      );
      v_result := v_result || jsonb_build_array(v_conflict);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION check_offer_cart_equipment_conflicts_v2 IS 'Sprawdza konflikty dostępności sprzętu dla produktów w koszyku oferty. Rozwija kity na pojedyncze elementy (pomijając przewody). Uwzględnia substytucje.';