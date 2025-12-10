/*
  # Fix Offer History Cascade Delete Issue
  
  1. Problem
    - Gdy event jest usuwany, kaskadowo usuwane są offers
    - Gdy offers są usuwane, kaskadowo usuwane są offer_items
    - Trigger na offer_items próbuje zapisać do offer_history
    - Ale offer już nie istnieje, więc foreign key constraint fails
  
  2. Rozwiązanie
    - Sprawdzić czy oferta jeszcze istnieje przed zapisem do historii
    - Jeśli nie istnieje, pominąć logowanie (bo i tak historia zostanie usunięta przez CASCADE)
*/

-- Zaktualizuj trigger dla offer_items aby sprawdzał istnienie oferty
CREATE OR REPLACE FUNCTION log_offer_item_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
  product_name text;
  offer_exists boolean;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    SELECT name INTO product_name FROM offer_products WHERE id = NEW.product_id;
    change_desc := 'Dodano pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_added', change_desc, to_jsonb(NEW));
  
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT name INTO product_name FROM offer_products WHERE id = NEW.product_id;
    change_desc := 'Zaktualizowano pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_updated', change_desc, to_jsonb(OLD), to_jsonb(NEW));
  
  ELSIF TG_OP = 'DELETE' THEN
    -- Sprawdź czy oferta jeszcze istnieje
    SELECT EXISTS(SELECT 1 FROM offers WHERE id = OLD.offer_id) INTO offer_exists;
    
    -- Tylko loguj jeśli oferta istnieje (nie jest w trakcie kaskadowego usuwania)
    IF offer_exists THEN
      SELECT name INTO product_name FROM offer_products WHERE id = OLD.product_id;
      change_desc := 'Usunięto pozycję: ' || COALESCE(product_name, 'Produkt');
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values)
      VALUES (OLD.offer_id, current_user_id, 'item_removed', change_desc, to_jsonb(OLD));
    END IF;
    
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
