/*
  # Dodaj my_company_id do ksef_invoices

  1. Zmiany
    - Dodaj kolumnę `my_company_id` do `ksef_invoices`
    - Automatycznie przypisz firmę na podstawie NIP-u
    - Dodaj indeks dla wydajności

  2. Uwagi
    - Faktury wystawione (issued) - porównujemy seller_nip z my_companies.nip
    - Faktury otrzymane (received) - porównujemy buyer_nip z my_companies.nip
*/

-- Add my_company_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'my_company_id'
  ) THEN
    ALTER TABLE ksef_invoices
    ADD COLUMN my_company_id uuid REFERENCES my_companies(id) ON DELETE SET NULL;

    CREATE INDEX idx_ksef_invoices_my_company ON ksef_invoices(my_company_id);
  END IF;
END $$;

-- Auto-assign my_company_id based on NIP for issued invoices (seller_nip)
UPDATE ksef_invoices ki
SET my_company_id = mc.id
FROM my_companies mc
WHERE ki.invoice_type = 'issued'
  AND ki.seller_nip = mc.nip
  AND ki.my_company_id IS NULL;

-- Auto-assign my_company_id based on NIP for received invoices (buyer_nip)
UPDATE ksef_invoices ki
SET my_company_id = mc.id
FROM my_companies mc
WHERE ki.invoice_type = 'received'
  AND ki.buyer_nip = mc.nip
  AND ki.my_company_id IS NULL;

-- Create function to auto-assign company on insert
CREATE OR REPLACE FUNCTION assign_ksef_invoice_company()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id uuid;
BEGIN
  -- For issued invoices, match seller_nip
  IF NEW.invoice_type = 'issued' THEN
    SELECT id INTO v_company_id
    FROM my_companies
    WHERE nip = NEW.seller_nip
    LIMIT 1;
  -- For received invoices, match buyer_nip
  ELSIF NEW.invoice_type = 'received' THEN
    SELECT id INTO v_company_id
    FROM my_companies
    WHERE nip = NEW.buyer_nip
    LIMIT 1;
  END IF;

  NEW.my_company_id = v_company_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS assign_ksef_invoice_company_trigger ON ksef_invoices;
CREATE TRIGGER assign_ksef_invoice_company_trigger
  BEFORE INSERT OR UPDATE ON ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION assign_ksef_invoice_company();