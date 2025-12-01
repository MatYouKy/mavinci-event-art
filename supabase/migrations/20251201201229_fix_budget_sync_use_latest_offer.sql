/*
  # Fix budget sync to use latest offer only

  ## Changes
  1. Update trigger to use only the latest (most recent) offer amount
  2. When multiple offers exist, only the newest one updates the budget
  
  ## Reasoning
  - Events can have multiple offers (revisions, different versions)
  - Budget should reflect the most recent/active offer
  - Prevents confusion with outdated offer amounts
*/

-- 1. Drop old trigger
DROP TRIGGER IF EXISTS sync_offer_total_with_budget_trigger ON offers;

-- 2. Recreate function with "latest offer" logic
CREATE OR REPLACE FUNCTION sync_offer_total_with_event_budget()
RETURNS TRIGGER AS $$
BEGIN
  -- When offer is created or updated, update event's expected_revenue
  -- Use the most recent offer's total_amount
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.event_id IS NOT NULL THEN
    UPDATE events
    SET expected_revenue = (
      SELECT total_amount 
      FROM offers 
      WHERE event_id = NEW.event_id 
      ORDER BY created_at DESC 
      LIMIT 1
    )
    WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Recreate trigger
CREATE TRIGGER sync_offer_total_with_budget_trigger
  AFTER INSERT OR UPDATE OF total_amount
  ON offers
  FOR EACH ROW
  EXECUTE FUNCTION sync_offer_total_with_event_budget();

-- 4. Update all existing events with their latest offer amounts
UPDATE events e
SET expected_revenue = latest_offer.total_amount
FROM (
  SELECT DISTINCT ON (event_id)
    event_id,
    total_amount
  FROM offers
  WHERE event_id IS NOT NULL
  ORDER BY event_id, created_at DESC
) AS latest_offer
WHERE e.id = latest_offer.event_id;
