/*
  # Add accepted calculation and financial source system

  1. Changes to `event_calculations`
    - Add `is_accepted` (boolean, default false) - marks a calculation as the accepted one
    - Only one calculation per event can be accepted at a time
  
  2. Changes to `events`
    - Add `financial_source` (text) - indicates where financial data comes from
      - 'offer' = from accepted offer (default, current behavior)
      - 'calculation' = from accepted calculation
    - Add `accepted_calculation_id` (uuid, FK) - reference to the accepted calculation
  
  3. New triggers
    - `ensure_single_accepted_calculation` - only one accepted calc per event
    - `sync_calculation_with_event_budget` - syncs expected_revenue from calculation

  4. Important notes
    - Existing behavior (offer-based) remains the default
    - When financial_source = 'calculation', the budget sync uses calculation data
    - Only one calculation per event can be accepted (enforced by trigger)
*/

-- 1. Add is_accepted to event_calculations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_calculations' AND column_name = 'is_accepted'
  ) THEN
    ALTER TABLE event_calculations ADD COLUMN is_accepted boolean DEFAULT false;
  END IF;
END $$;

-- 2. Add financial_source and accepted_calculation_id to events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'financial_source'
  ) THEN
    ALTER TABLE events ADD COLUMN financial_source text DEFAULT 'offer';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'accepted_calculation_id'
  ) THEN
    ALTER TABLE events ADD COLUMN accepted_calculation_id uuid REFERENCES event_calculations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Function to ensure only one accepted calculation per event
CREATE OR REPLACE FUNCTION ensure_single_accepted_calculation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_accepted = true THEN
    UPDATE event_calculations
    SET is_accepted = false
    WHERE event_id = NEW.event_id
      AND id != NEW.id
      AND is_accepted = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ensure_single_accepted_calculation_trigger ON event_calculations;
CREATE TRIGGER ensure_single_accepted_calculation_trigger
  BEFORE UPDATE OF is_accepted
  ON event_calculations
  FOR EACH ROW
  WHEN (NEW.is_accepted = true)
  EXECUTE FUNCTION ensure_single_accepted_calculation();

-- 4. Function to sync calculation totals with event budget
CREATE OR REPLACE FUNCTION sync_calculation_with_event_budget()
RETURNS TRIGGER AS $$
DECLARE
  v_total numeric;
BEGIN
  IF NEW.is_accepted = true THEN
    SELECT COALESCE(SUM(quantity * unit_price * days), 0)
    INTO v_total
    FROM event_calculation_items
    WHERE calculation_id = NEW.id;

    UPDATE events
    SET expected_revenue = v_total,
        accepted_calculation_id = NEW.id,
        financial_source = 'calculation'
    WHERE id = NEW.event_id;
  ELSIF OLD.is_accepted = true AND NEW.is_accepted = false THEN
    UPDATE events
    SET accepted_calculation_id = NULL,
        financial_source = 'offer',
        expected_revenue = COALESCE((
          SELECT total_amount
          FROM offers
          WHERE event_id = NEW.event_id
            AND status = 'accepted'
          ORDER BY created_at DESC
          LIMIT 1
        ), 0)
    WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_calculation_budget_trigger ON event_calculations;
CREATE TRIGGER sync_calculation_budget_trigger
  AFTER UPDATE OF is_accepted
  ON event_calculations
  FOR EACH ROW
  EXECUTE FUNCTION sync_calculation_with_event_budget();
