/*
  # Fix mark_offer_modified Function - Remove name Field Check

  1. Problem
    - Function `mark_offer_modified()` checks NEW.name and OLD.name
    - Table `offers` does NOT have a `name` column
    - This causes error: record "new" has no field "name"
    - Error occurs when changing offer status

  2. Solution
    - Remove the name field check from the function
    - Keep other checks: notes, total_amount, status
    - Offers are identified by offer_number, not name
*/

CREATE OR REPLACE FUNCTION mark_offer_modified()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.generated_pdf_url IS NOT NULL THEN
    -- Sprawdź czy zmieniono treść oferty (bez sprawdzania name, które nie istnieje)
    IF (NEW.notes IS DISTINCT FROM OLD.notes) OR
       (NEW.total_amount IS DISTINCT FROM OLD.total_amount) OR
       (NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'accepted') THEN
      NEW.modified_after_generation = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_offer_modified() IS
'Marks offer as modified after PDF generation. Does not check name field as it does not exist in offers table.';
