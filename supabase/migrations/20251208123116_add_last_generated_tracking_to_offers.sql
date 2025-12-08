/*
  # Add Last Generated Tracking to Offers

  1. New Columns
    - `last_generated_by` (uuid, foreign key to employees)
    - `last_generated_at` (timestamptz)

  2. Changes
    - Add columns to track who and when last generated the offer PDF
    - Update trigger to log PDF generation in history
    - Update trigger to set last_generated_by and last_generated_at

  3. Security
    - Columns visible to users with offers_view permission
*/

-- Add tracking columns
ALTER TABLE offers
ADD COLUMN IF NOT EXISTS last_generated_by uuid REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_generated_at timestamptz;

-- Update the offer change logging function to track PDF generation
CREATE OR REPLACE FUNCTION log_offer_change()
RETURNS TRIGGER AS $$
DECLARE
  change_desc text;
  current_user_id uuid;
  employee_name text;
BEGIN
  SELECT id INTO current_user_id FROM employees WHERE id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    change_desc := 'Oferta utworzona';
    INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
    VALUES (NEW.id, current_user_id, 'created', change_desc, to_jsonb(NEW));
  
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status change
    IF OLD.status != NEW.status THEN
      change_desc := 'Status zmieniony z "' || OLD.status || '" na "' || NEW.status || '"';
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
      VALUES (NEW.id, current_user_id, 'status_changed', change_desc, 
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status));
    END IF;

    -- PDF generation
    IF OLD.generated_pdf_url IS NULL AND NEW.generated_pdf_url IS NOT NULL THEN
      SELECT first_name || ' ' || last_name INTO employee_name 
      FROM employees 
      WHERE id = current_user_id;
      
      change_desc := 'PDF wygenerowany przez ' || COALESCE(employee_name, 'System');
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
      VALUES (NEW.id, current_user_id, 'generated_pdf', change_desc,
        jsonb_build_object('pdf_url', NEW.generated_pdf_url, 'generated_at', now()));
      
      -- Update last generated tracking
      NEW.last_generated_by = current_user_id;
      NEW.last_generated_at = now();
    END IF;

    -- Other updates
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
