/*
  # Auto-reset event status when all offers deleted

  1. Changes
    - When last offer is deleted, reset event status to 'offer_to_send'
    - Also clears has_equipment_shortage flag
    - Prevents showing shortage alert and sets proper status

  2. Logic
    - Trigger on offer DELETE
    - Count remaining offers for the event
    - If count = 0:
      - Set status = 'offer_to_send'
      - Set has_equipment_shortage = false
*/

-- Update existing function to also reset status
CREATE OR REPLACE FUNCTION clear_equipment_shortage_on_last_offer_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_remaining_offers_count int;
BEGIN
  -- Count remaining offers for this event
  SELECT COUNT(*)
  INTO v_remaining_offers_count
  FROM offers
  WHERE event_id = OLD.event_id
    AND id != OLD.id; -- Exclude the offer being deleted

  -- If no offers remain, clear the shortage flag AND reset status
  IF v_remaining_offers_count = 0 THEN
    UPDATE events
    SET 
      has_equipment_shortage = false,
      status = 'offer_to_send'
    WHERE id = OLD.event_id;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION clear_equipment_shortage_on_last_offer_delete IS 'Automatycznie usuwa flagę has_equipment_shortage i resetuje status do offer_to_send gdy wszystkie oferty eventu zostaną usunięte';