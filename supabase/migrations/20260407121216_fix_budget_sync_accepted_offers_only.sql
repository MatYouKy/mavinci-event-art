/*
  # Synchronizacja budżetu tylko z zaakceptowanych ofert

  ## Problem
  - Funkcja `get_event_financial_summary` pokazuje 0,00 zł dla przychodów
  - Trigger synchronizuje `expected_revenue` ze WSZYSTKICH ofert, a nie tylko zaakceptowanych
  - Dane finansowe powinny pokazywać wartości tylko z ofert ze statusem 'accepted'

  ## Rozwiązanie
  1. Zaktualizuj trigger aby brał tylko oferty 'accepted'
  2. Zaktualizuj existing events z zaakceptowanych ofert
  
  ## Kolumny events
  - expected_revenue - oczekiwany przychód (z zaakceptowanej oferty)
  - actual_revenue - faktyczny przychód (z opłaconych faktur)
*/

-- 1. Drop old trigger
DROP TRIGGER IF EXISTS sync_offer_total_with_budget_trigger ON offers;

-- 2. Recreate function with "accepted offers only" logic
CREATE OR REPLACE FUNCTION sync_offer_total_with_event_budget()
RETURNS TRIGGER AS $$
BEGIN
  -- When offer is created or updated, update event's expected_revenue
  -- Use ONLY accepted offers, take the most recent one
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.event_id IS NOT NULL THEN
    UPDATE events
    SET expected_revenue = COALESCE((
      SELECT total_amount 
      FROM offers 
      WHERE event_id = NEW.event_id 
        AND status = 'accepted'
      ORDER BY created_at DESC 
      LIMIT 1
    ), 0)
    WHERE id = NEW.event_id;
  END IF;

  -- When offer is deleted, recalculate
  IF TG_OP = 'DELETE' AND OLD.event_id IS NOT NULL THEN
    UPDATE events
    SET expected_revenue = COALESCE((
      SELECT total_amount 
      FROM offers 
      WHERE event_id = OLD.event_id 
        AND status = 'accepted'
      ORDER BY created_at DESC 
      LIMIT 1
    ), 0)
    WHERE id = OLD.event_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Recreate trigger for INSERT, UPDATE, and DELETE
CREATE TRIGGER sync_offer_total_with_budget_trigger
  AFTER INSERT OR UPDATE OF total_amount, status
  ON offers
  FOR EACH ROW
  EXECUTE FUNCTION sync_offer_total_with_event_budget();

CREATE TRIGGER sync_offer_total_with_budget_trigger_delete
  AFTER DELETE
  ON offers
  FOR EACH ROW
  EXECUTE FUNCTION sync_offer_total_with_event_budget();

-- 4. Update all existing events with their latest ACCEPTED offer amounts
UPDATE events e
SET expected_revenue = COALESCE(latest_offer.total_amount, 0)
FROM (
  SELECT DISTINCT ON (event_id)
    event_id,
    total_amount
  FROM offers
  WHERE event_id IS NOT NULL
    AND status = 'accepted'
  ORDER BY event_id, created_at DESC
) AS latest_offer
WHERE e.id = latest_offer.event_id;

-- 5. Reset expected_revenue for events without accepted offers
UPDATE events
SET expected_revenue = 0
WHERE id NOT IN (
  SELECT DISTINCT event_id 
  FROM offers 
  WHERE event_id IS NOT NULL 
    AND status = 'accepted'
)
AND expected_revenue != 0;
