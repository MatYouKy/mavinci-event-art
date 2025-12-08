/*
  # Auto-set requires_subcontractors from offer items

  1. Changes
    - Create trigger function to check if any offer items need subcontractors
    - Automatically update events.requires_subcontractors based on offer items
    - Trigger runs after INSERT/UPDATE/DELETE on offer_items

  2. Logic
    - If ANY offer item for the event has needs_subcontractor = true, set event.requires_subcontractors = true
    - If NO offer items need subcontractors, set event.requires_subcontractors = false
*/

CREATE OR REPLACE FUNCTION update_event_requires_subcontractors()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_needs_subcontractors boolean;
BEGIN
  -- Get event_id from the offer
  IF TG_OP = 'DELETE' THEN
    SELECT event_id INTO v_event_id FROM offers WHERE id = OLD.offer_id;
  ELSE
    SELECT event_id INTO v_event_id FROM offers WHERE id = COALESCE(NEW.offer_id, OLD.offer_id);
  END IF;

  -- Skip if no event_id
  IF v_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Check if any offer items for this event need subcontractors
  SELECT EXISTS (
    SELECT 1 
    FROM offer_items oi
    JOIN offers o ON o.id = oi.offer_id
    WHERE o.event_id = v_event_id
      AND oi.needs_subcontractor = true
  ) INTO v_needs_subcontractors;

  -- Update the event
  UPDATE events
  SET requires_subcontractors = v_needs_subcontractors
  WHERE id = v_event_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on offer_items
DROP TRIGGER IF EXISTS trigger_update_event_requires_subcontractors ON offer_items;
CREATE TRIGGER trigger_update_event_requires_subcontractors
  AFTER INSERT OR UPDATE OR DELETE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION update_event_requires_subcontractors();
