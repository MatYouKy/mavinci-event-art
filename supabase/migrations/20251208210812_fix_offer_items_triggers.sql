/*
  # Fix Offer Items Triggers and Auto-calculation

  1. Problem
    - log_offer_item_change tries to get "name" from offer_products but should use offer_items.name
    - Deleting/updating offer_items doesn't recalculate offer totals

  2. Solution
    - Fix log_offer_item_change to use offer_items.name instead of querying offer_products
    - Add trigger to recalculate offer total_amount and total_cost when offer_items change
    - Ensure budget sync works properly
*/

-- Fix the log_offer_item_change function to use offer_items.name
CREATE OR REPLACE FUNCTION log_offer_item_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
  item_name text;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    item_name := NEW.name;
    change_desc := 'Dodano pozycję: ' || COALESCE(item_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_added', change_desc, to_jsonb(NEW));

  ELSIF TG_OP = 'UPDATE' THEN
    change_desc := 'Zaktualizowano pozycję oferty';
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_updated', change_desc, NULL, NULL);

  ELSIF TG_OP = 'DELETE' THEN
    item_name := OLD.name;
    change_desc := 'Usunięto pozycję: ' || COALESCE(item_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values)
    VALUES (OLD.offer_id, current_user_id, 'item_removed', change_desc, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to recalculate offer totals
CREATE OR REPLACE FUNCTION recalculate_offer_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_total_amount numeric;
  v_total_cost numeric;
  v_offer_id uuid;
BEGIN
  -- Determine which offer_id to update
  IF TG_OP = 'DELETE' THEN
    v_offer_id := OLD.offer_id;
  ELSE
    v_offer_id := NEW.offer_id;
  END IF;

  -- Calculate totals from all items in this offer
  SELECT
    COALESCE(SUM(unit_price * quantity), 0),
    COALESCE(SUM(cost_price * quantity), 0)
  INTO v_total_amount, v_total_cost
  FROM offer_items
  WHERE offer_id = v_offer_id;

  -- Update the offer with new totals
  UPDATE offers
  SET
    total_amount = v_total_amount,
    total_cost = v_total_cost,
    updated_at = now()
  WHERE id = v_offer_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_recalculate_offer_totals ON offer_items;

-- Create trigger to recalculate offer totals when items change
CREATE TRIGGER trigger_recalculate_offer_totals
  AFTER INSERT OR UPDATE OR DELETE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_offer_totals();
