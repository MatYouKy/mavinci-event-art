/*
  # Fix sync_equipment_bookings_for_event - add ON CONFLICT for equipment_items

  1. Problem
    - Gdy ten sam equipment_id jest dodany dwa razy do event_equipment
    - Funkcja próbuje wstawić go dwa razy do equipment_bookings
    - Narusza constraint equipment_bookings_unique_event_equipment

  2. Solution
    - Dodaj ON CONFLICT DO UPDATE do pierwszego INSERT (dla equipment_items)
    - Tak jak jest w drugim INSERT (dla kitów)

  3. Behavior
    - Jeśli sprzęt już istnieje w equipment_bookings, zwiększ quantity
    - Dodaj notatki z nowych wpisów
*/

CREATE OR REPLACE FUNCTION public.sync_equipment_bookings_for_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  SELECT event_date, event_end_date INTO v_start, v_end
  FROM public.events
  WHERE id = p_event_id;

  IF v_start IS NULL THEN
    RETURN;
  END IF;

  -- Delete existing bookings for this event
  DELETE FROM public.equipment_bookings
  WHERE event_id = p_event_id;

  -- Insert bookings for equipment_items (not kits) with ON CONFLICT
  INSERT INTO public.equipment_bookings (event_id, equipment_id, quantity, start_date, end_date, notes)
  SELECT
    ee.event_id,
    ee.equipment_id,
    ee.quantity,
    v_start,
    v_end,
    ee.notes
  FROM public.event_equipment ee
  WHERE ee.event_id = p_event_id
    AND ee.equipment_id IS NOT NULL  -- Only items, not kits
    AND ee.quantity > 0
    AND ee.status NOT IN ('released', 'cancelled')
  ON CONFLICT (event_id, equipment_id) DO UPDATE
  SET quantity = equipment_bookings.quantity + EXCLUDED.quantity,
      notes = CASE 
        WHEN equipment_bookings.notes IS NULL THEN EXCLUDED.notes
        WHEN EXCLUDED.notes IS NULL THEN equipment_bookings.notes
        ELSE equipment_bookings.notes || E'\n' || EXCLUDED.notes
      END;

  -- Expand kits into individual items and create bookings
  INSERT INTO public.equipment_bookings (event_id, equipment_id, quantity, start_date, end_date, notes)
  SELECT
    ee.event_id,
    eki.equipment_id,
    ee.quantity * eki.quantity,
    v_start,
    v_end,
    'Z kitu: ' || COALESCE(ek.name, ee.notes)
  FROM public.event_equipment ee
  JOIN public.equipment_kits ek ON ek.id = ee.kit_id
  JOIN public.equipment_kit_items eki ON eki.kit_id = ee.kit_id
  WHERE ee.event_id = p_event_id
    AND ee.kit_id IS NOT NULL  -- Only kits
    AND ee.quantity > 0
    AND ee.status NOT IN ('released', 'cancelled')
  ON CONFLICT (event_id, equipment_id) DO UPDATE
  SET quantity = equipment_bookings.quantity + EXCLUDED.quantity,
      notes = CASE 
        WHEN equipment_bookings.notes IS NULL THEN EXCLUDED.notes
        WHEN EXCLUDED.notes IS NULL THEN equipment_bookings.notes
        ELSE equipment_bookings.notes || E'\n' || EXCLUDED.notes
      END;
END;
$function$;

COMMENT ON FUNCTION sync_equipment_bookings_for_event IS 'Synchronizuje rezerwacje sprzętu dla eventu, rozwijając kity na pojedyncze elementy. Obsługuje duplikaty przez ON CONFLICT.';
