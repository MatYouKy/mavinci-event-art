/*
  # Block KSeF operations for private person invoices

  1. New Function
    - `prevent_ksef_for_private_persons` trigger function
    - Prevents setting ksef_status or ksef_reference_number on invoices
      where buyer_is_private_person = true

  2. Security
    - Polish law does not require (and KSeF does not support) sending
      invoices for private persons (osoby fizyczne) to KSeF
    - This is a safety net; the application layer should also prevent this

  3. Important Notes
    - This trigger fires BEFORE UPDATE on invoices
    - Only blocks attempts to set KSeF fields on private person invoices
    - Does not affect any other invoice operations
*/

CREATE OR REPLACE FUNCTION prevent_ksef_for_private_persons()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.buyer_is_private_person = true
     AND (NEW.ksef_status IS NOT NULL AND NEW.ksef_status != '' AND NEW.ksef_status != OLD.ksef_status)
  THEN
    RAISE EXCEPTION 'Faktury dla osób prywatnych nie mogą być wysyłane do KSeF';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_ksef_for_private_persons ON invoices;
CREATE TRIGGER trigger_prevent_ksef_for_private_persons
BEFORE UPDATE ON invoices
FOR EACH ROW
WHEN (NEW.buyer_is_private_person = true)
EXECUTE FUNCTION prevent_ksef_for_private_persons();
