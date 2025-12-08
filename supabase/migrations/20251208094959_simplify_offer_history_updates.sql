/*
  # Simplify Offer History Updates

  1. Changes
    - Modify offer_item_change trigger to show simpler messages for position updates
    - Instead of detailed changes, show only "Zaktualizowano pozycję oferty" with timestamp

  2. Notes
    - This makes the history cleaner and easier to read
    - Only affects UPDATE operations on offer_items
*/

CREATE OR REPLACE FUNCTION log_offer_item_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
  product_name text;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    SELECT name INTO product_name FROM offer_products WHERE id = NEW.product_id;
    change_desc := 'Dodano pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_added', change_desc, to_jsonb(NEW));
  
  ELSIF TG_OP = 'UPDATE' THEN
    change_desc := 'Zaktualizowano pozycję oferty';
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_updated', change_desc, NULL, NULL);
  
  ELSIF TG_OP = 'DELETE' THEN
    SELECT name INTO product_name FROM offer_products WHERE id = OLD.product_id;
    change_desc := 'Usunięto pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values)
    VALUES (OLD.offer_id, current_user_id, 'item_removed', change_desc, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;