/*
  # Funkcja Rezerwacji Wybranego Sprzętu

  1. Nowa funkcjonalność
    - Rezerwacja tylko wybranych pozycji sprzętu
    - Obsługa zaakceptowanych braków
    - Oznaczanie braków na evencie
    - Zmiana statusu oferty na zaakceptowaną

  2. Parametry
    - p_offer_id: ID oferty
    - p_items: Tablica wybranych pozycji do rezerwacji
    - p_accepted_shortages: Tablica zaakceptowanych braków
*/

-- Typ dla wybranej pozycji
DO $$ BEGIN
  CREATE TYPE selected_equipment_item AS (
    item_type text,
    item_id uuid,
    qty integer
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Typ dla zaakceptowanego braku
DO $$ BEGIN
  CREATE TYPE accepted_shortage_item AS (
    item_type text,
    item_id uuid,
    shortage_qty integer
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Funkcja rezerwacji
CREATE OR REPLACE FUNCTION reserve_selected_equipment(
  p_offer_id uuid,
  p_items selected_equipment_item[],
  p_accepted_shortages accepted_shortage_item[]
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_item selected_equipment_item;
  v_shortage accepted_shortage_item;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
BEGIN
  -- Pobierz event_id z oferty
  SELECT event_id INTO v_event_id
  FROM offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nie znaleziono oferty');
  END IF;

  -- Usuń istniejące rezerwacje z tej oferty (jeśli jakieś były)
  DELETE FROM event_equipment
  WHERE event_id = v_event_id
    AND offer_id = p_offer_id;

  -- Dodaj wybrane pozycje
  FOREACH v_item IN ARRAY p_items
  LOOP
    IF v_item.item_type = 'item' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        equipment_item_id,
        qty,
        reservation_status,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        v_item.item_id,
        v_item.qty,
        'reserved_pending',
        true
      );
      v_inserted_count := v_inserted_count + 1;

    ELSIF v_item.item_type = 'kit' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        equipment_kit_id,
        qty,
        reservation_status,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        v_item.item_id,
        v_item.qty,
        'reserved_pending',
        true
      );
      v_inserted_count := v_inserted_count + 1;
    END IF;
  END LOOP;

  -- Dodaj zaakceptowane braki jako pozycje z flagą is_optional
  FOREACH v_shortage IN ARRAY p_accepted_shortages
  LOOP
    IF v_shortage.item_type = 'item' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        equipment_item_id,
        qty,
        reservation_status,
        is_optional,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        v_shortage.item_id,
        v_shortage.shortage_qty,
        'pending',
        true,
        true
      );
      v_shortage_count := v_shortage_count + 1;

    ELSIF v_shortage.item_type = 'kit' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        equipment_kit_id,
        qty,
        reservation_status,
        is_optional,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        v_shortage.item_id,
        v_shortage.shortage_qty,
        'pending',
        true,
        true
      );
      v_shortage_count := v_shortage_count + 1;
    END IF;
  END LOOP;

  -- Zaktualizuj status oferty na zaakceptowaną
  UPDATE offers
  SET status = 'accepted'
  WHERE id = p_offer_id;

  -- Jeśli są braki, ustaw flagę na evencie
  IF v_shortage_count > 0 THEN
    UPDATE events
    SET has_equipment_shortage = true
    WHERE id = v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count
  );
END;
$$;

COMMENT ON FUNCTION reserve_selected_equipment IS
'Rezerwuje wybrane pozycje sprzętu i oznacza zaakceptowane braki';
