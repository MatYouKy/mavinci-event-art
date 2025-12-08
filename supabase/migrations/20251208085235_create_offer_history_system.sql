/*
  # Create Offer History System

  1. New Tables
    - `offer_history`
      - `id` (uuid, primary key)
      - `offer_id` (uuid, foreign key to offers)
      - `changed_by` (uuid, foreign key to employees)
      - `change_type` (text: created, updated, item_added, item_removed, item_updated, status_changed, sent, generated_pdf)
      - `change_description` (text)
      - `old_values` (jsonb, nullable)
      - `new_values` (jsonb, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `offer_history` table
    - Add policies for authenticated users with offers permissions
*/

CREATE TABLE IF NOT EXISTS offer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  change_type text NOT NULL,
  change_description text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE offer_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with offers_view can view offer history"
  ON offer_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'offers_view' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Service role can insert offer history"
  ON offer_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_offer_history_offer_id ON offer_history(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_history_created_at ON offer_history(created_at DESC);

CREATE OR REPLACE FUNCTION log_offer_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    change_desc := 'Oferta utworzona';
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.id, current_user_id, 'created', change_desc, to_jsonb(NEW));
  
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      change_desc := 'Status zmieniony z "' || OLD.status || '" na "' || NEW.status || '"';
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
      VALUES (NEW.id, current_user_id, 'status_changed', change_desc, 
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status));
    END IF;

    IF OLD.generated_pdf_url IS NULL AND NEW.generated_pdf_url IS NOT NULL THEN
      change_desc := 'PDF wygenerowany';
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
      VALUES (NEW.id, current_user_id, 'generated_pdf', change_desc,
        jsonb_build_object('pdf_url', NEW.generated_pdf_url));
    END IF;

    IF OLD.notes != NEW.notes OR OLD.valid_until != NEW.valid_until THEN
      change_desc := 'Oferta zaktualizowana';
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
      VALUES (NEW.id, current_user_id, 'updated', change_desc,
        jsonb_build_object('notes', OLD.notes, 'valid_until', OLD.valid_until),
        jsonb_build_object('notes', NEW.notes, 'valid_until', NEW.valid_until));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_offer_change ON offers;
CREATE TRIGGER trigger_log_offer_change
  AFTER INSERT OR UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION log_offer_change();

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
    SELECT name INTO product_name FROM offer_products WHERE id = NEW.product_id;
    change_desc := 'Zaktualizowano pozycję: ' || COALESCE(product_name, 'Produkt');
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
    VALUES (NEW.offer_id, current_user_id, 'item_updated', change_desc, to_jsonb(OLD), to_jsonb(NEW));
  
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

DROP TRIGGER IF EXISTS trigger_log_offer_item_change ON offer_items;
CREATE TRIGGER trigger_log_offer_item_change
  AFTER INSERT OR UPDATE OR DELETE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION log_offer_item_change();