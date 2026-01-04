/*
  # Usuń obsługę cable_id z sync_offer_equipment_to_event

  1. Problem
    - Funkcja get_offer_equipment_final zwraca tylko: equipment_item_id, equipment_kit_id, qty
    - Nie ma kolumny cable_id
    - sync_offer_equipment_to_event próbuje użyć x.cable_id → ERROR

  2. Rozwiązanie
    - Usuń sekcję obsługującą cable_id z funkcji sync
    - Kable nie są dodawane przez produkty oferty (tylko przez sprzęt w produkcie)

  3. Notatki
    - Kable są dodawane bezpośrednio w offer_product_equipment jako equipment_items
    - Nie ma osobnej tabeli cables w offer_products
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

  -- Insert or update kits (as whole units, NOT expanded)
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

  -- NOTE: Cables are NOT handled here because:
  -- - Cables in products are stored as regular equipment_items in offer_product_equipment
  -- - They are already included in the equipment_items section above
  -- - There is no separate cable_id column in get_offer_equipment_final output

END;
$$;

-- Test
DO $$
BEGIN
  RAISE NOTICE 'Funkcja sync_offer_equipment_to_event zaktualizowana - usunięto obsługę cable_id';
END $$;
