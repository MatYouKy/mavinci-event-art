/*
  # Fix offers client_id and add budget sync

  ## Changes
  1. Drop old foreign key constraint on offers.client_id → clients.id
  2. Rename client_id to organization_id for clarity
  3. Add new foreign key constraint to organizations table
  4. Create trigger to sync offer total with event expected_revenue
  
  ## Purpose
  - Fix foreign key error when creating offers from events
  - Auto-update event budget when offer is created/updated
*/

-- 1. Drop old foreign key constraint
ALTER TABLE offers 
  DROP CONSTRAINT IF EXISTS offers_client_id_fkey;

-- 2. Rename column for clarity (client_id → organization_id)
ALTER TABLE offers 
  RENAME COLUMN client_id TO organization_id;

-- 3. Add new foreign key to organizations
ALTER TABLE offers
  ADD CONSTRAINT offers_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE SET NULL;

-- 4. Create trigger function to sync offer total with event budget
CREATE OR REPLACE FUNCTION sync_offer_total_with_event_budget()
RETURNS TRIGGER AS $$
BEGIN
  -- When offer is created or updated, update event's expected_revenue
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.event_id IS NOT NULL THEN
    UPDATE events
    SET expected_revenue = NEW.total_amount
    WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger
DROP TRIGGER IF EXISTS sync_offer_total_with_budget_trigger ON offers;
CREATE TRIGGER sync_offer_total_with_budget_trigger
  AFTER INSERT OR UPDATE OF total_amount
  ON offers
  FOR EACH ROW
  EXECUTE FUNCTION sync_offer_total_with_event_budget();
