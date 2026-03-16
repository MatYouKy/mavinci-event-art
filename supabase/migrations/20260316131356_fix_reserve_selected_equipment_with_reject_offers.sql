/*
  # Aktualizacja Funkcji Rezerwacji - Automatyczne Odrzucanie Pozostałych Ofert

  1. Zmiany
    - Po zaakceptowaniu oferty, automatycznie ustawia status pozostałych ofert na 'rejected'
    - Usuwa sprzęt z odrzuconych ofert z event_equipment
    - Zapewnia, że tylko jedna oferta jest zaakceptowana
*/

-- Usuń starą funkcję z jsonb
DROP FUNCTION IF EXISTS reserve_selected_equipment(uuid, jsonb, jsonb);

-- Utwórz nową funkcję z poprawną sygnaturą
CREATE OR REPLACE FUNCTION reserve_selected_equipment(
  p_offer_id uuid,
  p_items jsonb,
  p_accepted_shortages jsonb
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
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'item_type') = 'item' THEN
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
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
      v_inserted_count := v_inserted_count + 1;

    ELSIF (v_item->>'item_type') = 'kit' THEN
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
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
      v_inserted_count := v_inserted_count + 1;
    END IF;
  END LOOP;

  -- Dodaj zaakceptowane braki jako pozycje z flagą is_optional
  FOR v_shortage IN SELECT * FROM jsonb_array_elements(p_accepted_shortages)
  LOOP
    IF (v_shortage->>'item_type') = 'item' THEN
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
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'pending',
        true,
        true
      );
      v_shortage_count := v_shortage_count + 1;

    ELSIF (v_shortage->>'item_type') = 'kit' THEN
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
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
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

  -- Odrzuć wszystkie pozostałe oferty dla tego eventu
  UPDATE offers
  SET status = 'rejected'
  WHERE event_id = v_event_id
    AND id != p_offer_id
    AND status != 'rejected';
  
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  -- Usuń sprzęt z odrzuconych ofert
  DELETE FROM event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (
      SELECT id FROM offers
      WHERE event_id = v_event_id
        AND id != p_offer_id
        AND status = 'rejected'
    );

  -- Jeśli są braki, ustaw flagę na evencie
  IF v_shortage_count > 0 THEN
    UPDATE events
    SET has_equipment_shortage = true
    WHERE id = v_event_id;
  ELSE
    -- Jeśli nie ma braków, wyczyść flagę
    UPDATE events
    SET has_equipment_shortage = false
    WHERE id = v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count
  );
END;
$$;

COMMENT ON FUNCTION reserve_selected_equipment IS
'Rezerwuje wybrane pozycje sprzętu, oznacza zaakceptowane braki i automatycznie odrzuca pozostałe oferty';
