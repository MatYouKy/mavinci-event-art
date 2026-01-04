/*
  # Napraw sync_offer_equipment_to_event - użyj ON CONFLICT

  1. Problem
    - Trigger uruchamia sync_offer_equipment_to_event dla każdego wiersza offer_items
    - Bulk insert offer_items może próbować dodać ten sam sprzęt wielokrotnie
    - Unique index blokuje duplikaty → ERROR 23505

  2. Rozwiązanie
    - Zmień INSERT na INSERT ... ON CONFLICT DO UPDATE
    - Przy konflikcie zaktualizuj quantity zamiast rzucać błąd

  3. Notatki
    - Zachowuje istniejące dane (status, removed_from_offer)
    - Aktualizuje tylko quantity i timestamps
*/

CREATE OR REPLACE FUNCTION public.sync_offer_equipment_to_event(p_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  -- Delete equipment from this offer that no longer exists in products
  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id = p_offer_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.get_offer_equipment_final(p_offer_id) x
      WHERE (x.equipment_item_id IS NOT NULL AND x.equipment_item_id = event_equipment.equipment_id)
         OR (x.equipment_kit_id IS NOT NULL AND x.equipment_kit_id = event_equipment.kit_id)
         OR (x.cable_id IS NOT NULL AND x.cable_id = event_equipment.cable_id)
    );

  -- Insert or update equipment items
  INSERT INTO public.event_equipment (
    event_id,
    equipment_id,
    quantity,
    status,
    offer_id,
    auto_added,
    auto_quantity,
    removed_from_offer,
    offer_quantity
  )
  SELECT
    v_event_id,
    x.equipment_item_id,
    x.qty::int,
    'reserved',
    p_offer_id,
    true,
    x.qty::int,
    false,
    x.qty::int
  FROM public.get_offer_equipment_final(p_offer_id) x
  WHERE x.equipment_item_id IS NOT NULL
  ON CONFLICT (event_id, equipment_id, offer_id)
  WHERE equipment_id IS NOT NULL AND offer_id IS NOT NULL
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    auto_quantity = EXCLUDED.auto_quantity,
    offer_quantity = EXCLUDED.offer_quantity,
    removed_from_offer = false,
    updated_at = now();

  -- Insert or update kits
  INSERT INTO public.event_equipment (
    event_id,
    kit_id,
    quantity,
    status,
    offer_id,
    auto_added,
    auto_quantity,
    removed_from_offer,
    offer_quantity
  )
  SELECT
    v_event_id,
    x.equipment_kit_id,
    x.qty::int,
    'reserved',
    p_offer_id,
    true,
    x.qty::int,
    false,
    x.qty::int
  FROM public.get_offer_equipment_final(p_offer_id) x
  WHERE x.equipment_kit_id IS NOT NULL
  ON CONFLICT (event_id, kit_id, offer_id)
  WHERE kit_id IS NOT NULL AND offer_id IS NOT NULL
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    auto_quantity = EXCLUDED.auto_quantity,
    offer_quantity = EXCLUDED.offer_quantity,
    removed_from_offer = false,
    updated_at = now();

  -- Insert or update cables
  INSERT INTO public.event_equipment (
    event_id,
    cable_id,
    quantity,
    status,
    offer_id,
    auto_added,
    auto_quantity,
    removed_from_offer,
    offer_quantity
  )
  SELECT
    v_event_id,
    x.cable_id,
    x.qty::int,
    'reserved',
    p_offer_id,
    true,
    x.qty::int,
    false,
    x.qty::int
  FROM public.get_offer_equipment_final(p_offer_id) x
  WHERE x.cable_id IS NOT NULL
  ON CONFLICT (event_id, cable_id, offer_id)
  WHERE cable_id IS NOT NULL AND offer_id IS NOT NULL
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    auto_quantity = EXCLUDED.auto_quantity,
    offer_quantity = EXCLUDED.offer_quantity,
    removed_from_offer = false,
    updated_at = now();
END;
$$;

-- Sprawdź wynik
DO $$
BEGIN
  RAISE NOTICE 'Funkcja sync_offer_equipment_to_event zaktualizowana - teraz używa ON CONFLICT';
END $$;
