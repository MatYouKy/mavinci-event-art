/*
  # Fix Offer History Delete Issue

  1. Changes
    - Modify offer_item_change trigger to skip logging when parent offer is being deleted
    - Check if offer exists before inserting history
    - This prevents FK violation errors when deleting offers

  2. Notes
    - Fixes: "Key (offer_id)=(...) is not present in table offers" error
    - History is only logged when offer still exists
*/

CREATE OR REPLACE FUNCTION log_offer_item_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
  product_name text;
  offer_exists boolean;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  -- For DELETE operations, check if parent offer still exists
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS(SELECT 1 FROM offers WHERE id = OLD.offer_id) INTO offer_exists;
    
    -- If offer doesn't exist, it's being deleted - don't log item changes
    IF NOT offer_exists THEN
      RETURN OLD;
    END IF;
    
    SELECT name INTO product_name FROM offer_products WHERE id = OLD.product_id;
    change_desc := 'Usunięto pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values)
    VALUES (OLD.offer_id, current_user_id, 'item_removed', change_desc, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  -- For INSERT and UPDATE, offer must exist (it's being modified, not deleted)
  IF TG_OP = 'INSERT' THEN
    SELECT name INTO product_name FROM offer_products WHERE id = NEW.product_id;
    change_desc := 'Dodano pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_added', change_desc, to_jsonb(NEW));
  
  ELSIF TG_OP = 'UPDATE' THEN
    change_desc := 'Zaktualizowano pozycję oferty';
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_updated', change_desc, NULL, NULL);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
