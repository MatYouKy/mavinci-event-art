/*
  # Auto-clear equipment shortage flag when all offers deleted

  1. Changes
    - When offer is deleted, check if event has any remaining offers
    - If no offers remain, clear has_equipment_shortage flag
    - Prevents showing shortage alert when there are no offers

  2. Logic
    - Trigger on offer DELETE
    - Count remaining offers for the event
    - If count = 0, set has_equipment_shortage = false
*/

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

  -- If no offers remain, clear the shortage flag
  IF v_remaining_offers_count = 0 THEN
    UPDATE events
    SET has_equipment_shortage = false
    WHERE id = OLD.event_id;
  END IF;

  RETURN OLD;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_clear_equipment_shortage_on_offer_delete ON offers;

-- Create trigger
CREATE TRIGGER trigger_clear_equipment_shortage_on_offer_delete
  AFTER DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION clear_equipment_shortage_on_last_offer_delete();

COMMENT ON FUNCTION clear_equipment_shortage_on_last_offer_delete IS 'Automatycznie usuwa flagę has_equipment_shortage gdy wszystkie oferty eventu zostaną usunięte';