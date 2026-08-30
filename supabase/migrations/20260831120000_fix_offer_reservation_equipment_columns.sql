-- Align the variant-aware reservation RPCs with the real event_equipment schema:
-- equipment_id, kit_id and quantity.

CREATE OR REPLACE FUNCTION public.get_offer_equipment_for_reservation(
  p_offer_id uuid,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_result jsonb := '[]'::jsonb;
  v_scope record;
  v_total_qty integer;
  v_reserved_qty integer;
  v_available_qty integer;
  v_item_name text;
BEGIN
  SELECT evt.id, evt.event_date, COALESCE(evt.event_end_date, evt.event_date + interval '1 day')
  INTO v_event_id, v_start_date, v_end_date
  FROM public.offers offer_row
  JOIN public.events evt ON evt.id = offer_row.event_id
  WHERE offer_row.id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_scope IN
    SELECT * FROM public.get_offer_selected_equipment(p_offer_id, p_package_id)
  LOOP
    IF v_scope.item_type = 'item' THEN
      SELECT item.name,
        (SELECT count(*)
         FROM public.equipment_units unit
         WHERE unit.equipment_id = item.id
           AND unit.status IN ('available', 'reserved', 'in_use')),
        COALESCE((
          SELECT sum(reservation.quantity)
          FROM public.event_equipment reservation
          JOIN public.events reserved_event ON reserved_event.id = reservation.event_id
          WHERE reservation.equipment_id = item.id
            AND reservation.event_id <> v_event_id
            AND reserved_event.event_date < v_end_date
            AND COALESCE(reserved_event.event_end_date, reserved_event.event_date + interval '1 day') > v_start_date
            AND reservation.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')
        ), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM public.equipment_items item
      WHERE item.id = v_scope.item_id;
    ELSE
      SELECT kit.name,
        COALESCE((
          SELECT min(floor(component.stock_qty::numeric / component.required_qty))::integer
          FROM (
            SELECT kit_item.quantity AS required_qty,
              (SELECT count(*)
               FROM public.equipment_units unit
               WHERE unit.equipment_id = kit_item.equipment_id
                 AND unit.status IN ('available', 'reserved', 'in_use')) AS stock_qty
            FROM public.equipment_kit_items kit_item
            WHERE kit_item.kit_id = kit.id
              AND kit_item.equipment_id IS NOT NULL
              AND kit_item.quantity > 0
          ) component
        ), 0),
        COALESCE((
          SELECT sum(reservation.quantity)
          FROM public.event_equipment reservation
          JOIN public.events reserved_event ON reserved_event.id = reservation.event_id
          WHERE reservation.kit_id = kit.id
            AND reservation.event_id <> v_event_id
            AND reserved_event.event_date < v_end_date
            AND COALESCE(reserved_event.event_end_date, reserved_event.event_date + interval '1 day') > v_start_date
            AND reservation.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')
        ), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM public.equipment_kits kit
      WHERE kit.id = v_scope.item_id;
    END IF;

    v_available_qty := greatest(0, COALESCE(v_total_qty, 0) - COALESCE(v_reserved_qty, 0));
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'item_type', v_scope.item_type,
      'item_id', v_scope.item_id,
      'item_name', COALESCE(v_item_name, 'Sprzęt'),
      'required_qty', v_scope.qty,
      'total_qty', COALESCE(v_total_qty, 0),
      'reserved_qty', COALESCE(v_reserved_qty, 0),
      'available_qty', v_available_qty,
      'has_conflict', v_available_qty < v_scope.qty,
      'shortage_qty', greatest(0, v_scope.qty - v_available_qty)
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_selected_equipment(
  p_offer_id uuid,
  p_items jsonb,
  p_accepted_shortages jsonb,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_item jsonb;
  v_shortage jsonb;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
  v_rejected_count integer := 0;
  v_snapshot jsonb;
BEGIN
  SELECT event_id
  INTO v_event_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nie znaleziono oferty');
  END IF;

  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_packages
    WHERE id = p_package_id AND offer_id = p_offer_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wybrany pakiet nie należy do oferty');
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package.id,
      'package_name', package.name,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_packages package
    JOIN public.offer_package_items item ON item.package_id = package.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE package.id = p_package_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_item_id', item.id,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_items item
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE item.offer_id = p_offer_id;
  END IF;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id AND offer_id = p_offer_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF v_item->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    END IF;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  FOR v_shortage IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_accepted_shortages, '[]'::jsonb))
  LOOP
    IF v_shortage->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    END IF;
    v_shortage_count := v_shortage_count + 1;
  END LOOP;

  UPDATE public.offers
  SET status = 'accepted',
      accepted_at = now(),
      accepted_package_id = p_package_id,
      accepted_variant_selections = v_snapshot
  WHERE id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE event_id = v_event_id
    AND id <> p_offer_id
    AND status <> 'rejected';
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (
      SELECT id
      FROM public.offers
      WHERE event_id = v_event_id AND status = 'rejected'
    );

  UPDATE public.events
  SET has_equipment_shortage = (v_shortage_count > 0)
  WHERE id = v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count,
    'accepted_package_id', p_package_id,
    'variant_selections', v_snapshot
  );
END;
$$;

