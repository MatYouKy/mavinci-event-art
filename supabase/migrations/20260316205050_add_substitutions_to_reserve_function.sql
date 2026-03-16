/*
  # Rozszerzenie funkcji reserve_selected_equipment o substytuty
  
  1. Zmiany
    - Dodaje przenoszenie substytutów do event_equipment
    - Substytuty zastępują oryginalny sprzęt
*/

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
  v_substitution_count integer := 0;
  v_substitution record;
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

  -- Dodaj substytuty jako zamienniki
  FOR v_substitution IN 
    SELECT 
      oes.from_item_id,
      oes.to_item_id,
      oes.qty,
      ope.qty as original_qty
    FROM offer_equipment_substitutions oes
    LEFT JOIN offer_product_equipment ope ON ope.equipment_item_id = oes.from_item_id 
      AND ope.offer_product_id IN (
        SELECT id FROM offer_products WHERE offer_id = p_offer_id
      )
    WHERE oes.offer_id = p_offer_id
  LOOP
    INSERT INTO event_equipment (
      event_id,
      offer_id,
      equipment_item_id,
      qty,
      reservation_status,
      auto_added,
      notes
    )
    VALUES (
      v_event_id,
      p_offer_id,
      v_substitution.to_item_id,
      COALESCE(v_substitution.qty, v_substitution.original_qty, 1),
      'reserved_pending',
      true,
      'Substytut'
    );
    v_substitution_count := v_substitution_count + 1;
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
        AND status = 'rejected'
    );

  -- Ustaw flagę equipment_shortage jeśli są zaakceptowane braki
  UPDATE events
  SET equipment_shortage = (v_shortage_count > 0)
  WHERE id = v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'substitution_count', v_substitution_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count
  );
END;
$$;
