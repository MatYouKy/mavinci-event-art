/*
  # Naprawa Funkcji RPC dla Rezerwacji Sprzętu

  1. Problem
    - Błąd SQL: column e.start_date does not exist
    - Konflikt aliasów w zapytaniu

  2. Rozwiązanie
    - Poprawione aliasy w query
    - Uproszczona logika sprawdzania dostępności
*/

-- Naprawiona funkcja do pobierania sprzętu z oferty
CREATE OR REPLACE FUNCTION get_offer_equipment_for_reservation(p_offer_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_equipment_data jsonb;
  v_result jsonb[] := ARRAY[]::jsonb[];
  v_item jsonb;
  v_item_id uuid;
  v_item_type text;
  v_qty integer;
  v_total_qty integer;
  v_reserved_qty integer;
  v_available_qty integer;
  v_item_name text;
BEGIN
  -- Pobierz dane eventu
  SELECT evt.id, evt.start_date, evt.end_date
  INTO v_event_id, v_start_date, v_end_date
  FROM offers o
  JOIN events evt ON evt.id = o.event_id
  WHERE o.id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Pobierz zagregowany sprzęt z oferty
  SELECT get_offer_equipment_final(p_offer_id) INTO v_equipment_data;

  -- Dla każdego elementu sprawdź dostępność
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_equipment_data)
  LOOP
    v_item_type := v_item->>'item_type';
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty := (v_item->>'qty')::integer;

    IF v_item_type = 'item' THEN
      -- Dla pojedynczego sprzętu
      SELECT
        ei.name,
        COUNT(eu.id),
        COALESCE(SUM(
          CASE WHEN ee.event_id != v_event_id
               AND conflict_evt.start_date < v_end_date
               AND conflict_evt.end_date > v_start_date
               AND ee.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')
          THEN ee.qty
          ELSE 0
          END
        ), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM equipment_items ei
      LEFT JOIN equipment_units eu ON eu.item_id = ei.id AND eu.status = 'available'
      LEFT JOIN event_equipment ee ON (ee.equipment_item_id = ei.id OR ee.equipment_kit_id IN (
        SELECT kit_id FROM equipment_kit_items WHERE item_id = ei.id
      ))
      LEFT JOIN events conflict_evt ON conflict_evt.id = ee.event_id
      WHERE ei.id = v_item_id
      GROUP BY ei.name;

    ELSE
      -- Dla kitu - sprawdź dostępność wszystkich komponentów
      SELECT
        ek.name,
        COALESCE(MIN(eu_count.total), 0),
        COALESCE(MAX(eu_count.reserved), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM equipment_kits ek
      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT eu.id) as total,
          COALESCE(SUM(
            CASE WHEN ee.event_id != v_event_id
                 AND conflict_evt.start_date < v_end_date
                 AND conflict_evt.end_date > v_start_date
                 AND ee.reservation_status IN ('reserved_pending', 'reserved_confirmed', 'in_use')
            THEN ee.qty
            ELSE 0
            END
          ), 0) as reserved
        FROM equipment_kit_items eki
        JOIN equipment_items ei ON ei.id = eki.item_id
        LEFT JOIN equipment_units eu ON eu.item_id = ei.id AND eu.status = 'available'
        LEFT JOIN event_equipment ee ON ee.equipment_item_id = ei.id
        LEFT JOIN events conflict_evt ON conflict_evt.id = ee.event_id
        WHERE eki.kit_id = ek.id
      ) eu_count ON true
      WHERE ek.id = v_item_id;
    END IF;

    v_available_qty := GREATEST(0, v_total_qty - v_reserved_qty);

    v_result := array_append(v_result, jsonb_build_object(
      'item_type', v_item_type,
      'item_id', v_item_id,
      'item_name', v_item_name,
      'required_qty', v_qty,
      'total_qty', v_total_qty,
      'reserved_qty', v_reserved_qty,
      'available_qty', v_available_qty,
      'has_conflict', v_available_qty < v_qty,
      'shortage_qty', GREATEST(0, v_qty - v_available_qty)
    ));
  END LOOP;

  RETURN to_jsonb(v_result);
END;
$$;

COMMENT ON FUNCTION get_offer_equipment_for_reservation(uuid) IS
'Zwraca listę sprzętu z oferty wraz z aktualną dostępnością - poprawiona wersja bez konfliktów aliasów';
