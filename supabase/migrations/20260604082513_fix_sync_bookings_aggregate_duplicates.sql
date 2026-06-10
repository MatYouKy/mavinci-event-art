/*
  # Fix sync_equipment_bookings_for_event duplicate key error

  1. Problem
    - When adding equipment to a product, the trigger chain calls
      sync_equipment_bookings_for_event which inserts from event_equipment.
    - If multiple event_equipment rows have the same equipment_id for the same event
      (e.g., from different offers), the INSERT...ON CONFLICT DO UPDATE fails with
      "cannot affect row a second time" because PostgreSQL cannot handle duplicates
      within a single INSERT statement.

  2. Fix
    - Aggregate event_equipment rows by equipment_id before inserting into
      equipment_bookings, summing quantities and concatenating notes.
    - Same fix applied to the kit expansion INSERT.

  3. No data changes - this only modifies function logic.
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

  -- Insert bookings for equipment_items (not kits), aggregated to avoid duplicates
  INSERT INTO public.equipment_bookings (event_id, equipment_id, quantity, start_date, end_date, notes)
  SELECT
    p_event_id,
    ee.equipment_id,
    SUM(ee.quantity),
    v_start,
    v_end,
    string_agg(ee.notes, E'\n') FILTER (WHERE ee.notes IS NOT NULL)
  FROM public.event_equipment ee
  WHERE ee.event_id = p_event_id
    AND ee.equipment_id IS NOT NULL
    AND ee.quantity > 0
    AND ee.status NOT IN ('released', 'cancelled')
  GROUP BY ee.equipment_id
  ON CONFLICT (event_id, equipment_id) DO UPDATE
  SET quantity = EXCLUDED.quantity,
      notes = EXCLUDED.notes;

  -- Expand kits into individual items and create bookings, aggregated
  INSERT INTO public.equipment_bookings (event_id, equipment_id, quantity, start_date, end_date, notes)
  SELECT
    p_event_id,
    eki.equipment_id,
    SUM(ee.quantity * eki.quantity),
    v_start,
    v_end,
    string_agg('Z kitu: ' || COALESCE(ek.name, ''), E'\n')
  FROM public.event_equipment ee
  JOIN public.equipment_kits ek ON ek.id = ee.kit_id
  JOIN public.equipment_kit_items eki ON eki.kit_id = ee.kit_id
  WHERE ee.event_id = p_event_id
    AND ee.kit_id IS NOT NULL
    AND eki.equipment_id IS NOT NULL
    AND ee.quantity > 0
    AND ee.status NOT IN ('released', 'cancelled')
  GROUP BY eki.equipment_id
  ON CONFLICT (event_id, equipment_id) DO UPDATE
  SET quantity = equipment_bookings.quantity + EXCLUDED.quantity,
      notes = CASE
        WHEN equipment_bookings.notes IS NULL THEN EXCLUDED.notes
        WHEN EXCLUDED.notes IS NULL THEN equipment_bookings.notes
        ELSE equipment_bookings.notes || E'\n' || EXCLUDED.notes
      END;
END;
$function$;