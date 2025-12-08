/*
  # Fix offer history trigger to use correct employee column names

  1. Changes
    - Update log_offer_change function to use 'name' and 'surname' instead of 'first_name' and 'last_name'
    - Employees table uses 'name' and 'surname' columns
*/

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
    IF OLD.status != NEW.status THEN
      change_desc := 'Status zmieniony z "' || OLD.status || '" na "' || NEW.status || '"';
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, old_values, new_values)
      VALUES (NEW.id, current_user_id, 'status_changed', change_desc, 
        jsonb_build_object('status', OLD.status),
        jsonb_build_object('status', NEW.status));
    END IF;

    IF OLD.generated_pdf_url IS NULL AND NEW.generated_pdf_url IS NOT NULL THEN
      SELECT name || ' ' || surname INTO employee_name 
      FROM employees 
      WHERE id = current_user_id;
      
      change_desc := 'PDF wygenerowany przez ' || COALESCE(employee_name, 'System');
      INSERT INTO offer_history (offer_id, changed_by, change_type, change_description, new_values)
      VALUES (NEW.id, current_user_id, 'generated_pdf', change_desc,
        jsonb_build_object('pdf_url', NEW.generated_pdf_url, 'generated_at', now()));
      
      NEW.last_generated_by = current_user_id;
      NEW.last_generated_at = now();
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
