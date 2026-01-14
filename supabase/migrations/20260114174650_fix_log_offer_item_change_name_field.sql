/*
  # Fix log_offer_item_change function - use offer_items.name directly

  1. Problem
    - log_offer_item_change() tries to SELECT name FROM offer_products
    - This fails when to_jsonb(NEW) is called because NEW refers to offer_items table
    - Error: record "new" has no field "name"

  2. Solution
    - Use NEW.name and OLD.name directly from offer_items table
    - offer_items already has a "name" column (copied from product during INSERT)
    - This matches the fix from 20251208210812 but ensures it's properly applied
*/

-- Drop and recreate the function to ensure clean state
DROP FUNCTION IF EXISTS log_offer_item_change() CASCADE;

CREATE OR REPLACE FUNCTION log_offer_item_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
  item_name text;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    -- Use NEW.name directly from offer_items table
    item_name := NEW.name;
    change_desc := 'Dodano pozycję: ' || COALESCE(item_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_added', change_desc, to_jsonb(NEW));

  ELSIF TG_OP = 'UPDATE' THEN
    -- Use NEW.name directly from offer_items table
    item_name := NEW.name;
    change_desc := 'Zaktualizowano pozycję: ' || COALESCE(item_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_updated', change_desc, to_jsonb(OLD), to_jsonb(NEW));

  ELSIF TG_OP = 'DELETE' THEN
    -- Use OLD.name directly from offer_items table
    item_name := OLD.name;
    change_desc := 'Usunięto pozycję: ' || COALESCE(item_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values)
    VALUES (OLD.offer_id, current_user_id, 'item_removed', change_desc, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trigger_log_offer_item_change ON offer_items;
CREATE TRIGGER trigger_log_offer_item_change
  AFTER INSERT OR UPDATE OR DELETE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION log_offer_item_change();
