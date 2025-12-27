/*
  # Fix conflict checker - use correct event_status enum value

  1. Changes
    - Remove 'rejected' status check (doesn't exist in enum)
    - Only exclude 'cancelled' events

  2. Notes
    - Valid event_status values: inquiry, offer_to_send, offer_sent, offer_accepted, in_preparation, in_progress, completed, cancelled, invoiced
*/

DROP FUNCTION IF EXISTS check_offer_cart_equipment_conflicts_v2(uuid, jsonb, jsonb);

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
  v_alternatives jsonb;
  v_alt record;
  v_item_id text;
  v_required_qty integer;
  v_total_qty integer;
  v_reserved_qty integer;
  v_available_qty integer;
  v_item_name text;
  v_warehouse_category_id uuid;
  v_demand integer;
  v_existing_demand integer;
  v_product_id uuid;
  v_product_quantity integer;
  i integer;
BEGIN
  -- Get event dates
  SELECT event_date, event_end_date INTO v_start_date, v_end_date
  FROM events
  WHERE id = p_event_id;

  IF v_start_date IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Build substitutions map for quick lookup
  IF p_substitutions IS NOT NULL AND jsonb_array_length(p_substitutions) > 0 THEN
    FOR i IN 0..jsonb_array_length(p_substitutions) - 1 LOOP
      v_substitutions_map := jsonb_set(
        v_substitutions_map,
        ARRAY[(p_substitutions->i->>'from_item_id')],
        jsonb_build_object(
          'to_item_id', p_substitutions->i->>'to_item_id',
          'qty', COALESCE((p_substitutions->i->>'qty')::integer, 1)
        )
      );
    END LOOP;
  END IF;

  -- Step 1: Expand products into equipment items and aggregate demand
  FOR i IN 0..jsonb_array_length(p_items) - 1 LOOP
    -- Access JSONB directly
    v_product_id := (p_items->i->>'product_id')::uuid;
    v_product_quantity := COALESCE((p_items->i->>'quantity')::integer, 1);

    -- Get equipment for this product (both items and kits)
    FOR v_equipment IN
      SELECT
        ope.equipment_item_id,
        ope.equipment_kit_id,
        ope.quantity as product_qty,
        ope.is_optional
      FROM offer_product_equipment ope
      WHERE ope.product_id = v_product_id
        AND ope.is_optional = false
    LOOP

      -- If it's a kit, expand into individual items
      IF v_equipment.equipment_kit_id IS NOT NULL THEN
        FOR v_kit_item IN
          SELECT
            eki.equipment_id as item_id,
            eki.quantity as kit_item_qty
          FROM equipment_kit_items eki
          WHERE eki.kit_id = v_equipment.equipment_kit_id
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
          v_demand := (v_substitutions_map->(v_equipment.equipment_item_id::text)->>'qty')::integer;
        END IF;

        -- Add to demand map
        v_existing_demand := COALESCE((v_item_demand->v_item_id)::integer, 0);
        v_item_demand := jsonb_set(
          v_item_demand,
          ARRAY[v_item_id],
          to_jsonb(v_existing_demand + v_demand)
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Step 2: Check availability for each item and find conflicts
  FOR v_item_id IN SELECT * FROM jsonb_object_keys(v_item_demand)
  LOOP
    v_required_qty := (v_item_demand->v_item_id)::integer;

    -- Get item availability
    SELECT
      ei.name,
      ei.warehouse_category_id,
      COALESCE((SELECT COUNT(*) FROM equipment_units
                WHERE equipment_item_id = ei.id
                AND status IN ('available', 'in_use')), 0),
      COALESCE((SELECT SUM(ee.quantity)::integer
                FROM event_equipment ee
                JOIN events e ON e.id = ee.event_id
                WHERE ee.equipment_item_id = ei.id
                AND e.id != p_event_id
                AND e.status != 'cancelled'
                AND (e.event_date, e.event_end_date) OVERLAPS (v_start_date, v_end_date)), 0)
    INTO v_item_name, v_warehouse_category_id, v_total_qty, v_reserved_qty
    FROM equipment_items ei
    WHERE ei.id = v_item_id::uuid;

    -- Skip if item not found
    IF v_item_name IS NULL THEN
      CONTINUE;
    END IF;

    v_available_qty := GREATEST(v_total_qty - v_reserved_qty, 0);

    -- If shortage exists, create conflict record
    IF v_available_qty < v_required_qty THEN
      -- Find alternatives from same warehouse category
      v_alternatives := '[]'::jsonb;

      IF v_warehouse_category_id IS NOT NULL THEN
        FOR v_alt IN
          SELECT
            ei2.id as alt_item_id,
            ei2.name as alt_name,
            COALESCE((SELECT COUNT(*) FROM equipment_units
                      WHERE equipment_item_id = ei2.id
                      AND status IN ('available', 'in_use')), 0) as alt_total_qty,
            COALESCE((SELECT SUM(ee.quantity)::integer
                      FROM event_equipment ee
                      JOIN events e ON e.id = ee.event_id
                      WHERE ee.equipment_item_id = ei2.id
                      AND e.id != p_event_id
                      AND e.status != 'cancelled'
                      AND (e.event_date, e.event_end_date) OVERLAPS (v_start_date, v_end_date)), 0) as alt_reserved_qty
          FROM equipment_items ei2
          WHERE ei2.warehouse_category_id = v_warehouse_category_id
            AND ei2.id != v_item_id::uuid
            AND ei2.is_active = true
            AND ei2.deleted_at IS NULL
          ORDER BY ei2.name
          LIMIT 10
        LOOP
          v_alternatives := v_alternatives || jsonb_build_object(
            'item_type', 'item',
            'item_id', v_alt.alt_item_id,
            'item_name', v_alt.alt_name,
            'total_qty', v_alt.alt_total_qty,
            'reserved_qty', v_alt.alt_reserved_qty,
            'available_qty', GREATEST(v_alt.alt_total_qty - v_alt.alt_reserved_qty, 0),
            'warehouse_category_id', v_warehouse_category_id
          );
        END LOOP;
      END IF;

      -- Build conflict record
      v_conflict := jsonb_build_object(
        'item_type', 'item',
        'item_id', v_item_id,
        'item_name', v_item_name,
        'required_qty', v_required_qty,
        'total_qty', v_total_qty,
        'reserved_qty', v_reserved_qty,
        'available_qty', v_available_qty,
        'shortage_qty', v_required_qty - v_available_qty,
        'conflict_until', NULL,
        'conflicts', '[]'::jsonb,
        'alternatives', v_alternatives
      );

      v_result := v_result || v_conflict;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION check_offer_cart_equipment_conflicts_v2 TO authenticated;

COMMENT ON FUNCTION check_offer_cart_equipment_conflicts_v2 IS 'Sprawdza dostępność sprzętu dla produktów w koszyku oferty, rozwijając zestawy (kity) na pojedyncze elementy i zwracając konflikty z alternatywami';
