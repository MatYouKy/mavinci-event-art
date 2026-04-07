/*
  # Rozwiązanie dla faktur proforma i ostatecznych

  1. Zmiany w tabeli invoices
    - Dodanie kolumny is_proforma (boolean) - czy to jest proforma
    - Dodanie kolumny proforma_converted_to_invoice_id - link do faktury VAT powstałej z proformy
    
  2. Status faktury
    - draft - szkic (nie wysłana do KSeF)
    - proforma - proforma (NIGDY nie idzie do KSeF, tylko PDF dla klienta)
    - issued - wystawiona do KSeF
    - paid - zapłacona
    - cancelled - anulowana
    
  3. Workflow
    - Proforma: Wystawiasz proformę → klient widzi PDF → nie idzie do KSeF
    - Po zapłacie: Klikasz "Wystaw fakturę VAT na podstawie proformy"
    - Faktura VAT: Tworzy się faktura VAT z danymi z proformy → idzie do KSeF
    - Link: Proforma ma link do faktury VAT (related_invoice_id lub nowa kolumna)
*/

-- Dodaj kolumnę is_proforma aby odróżnić proformę od faktur VAT
ALTER TABLE invoices 
  ADD COLUMN IF NOT EXISTS is_proforma boolean DEFAULT false;

-- Dodaj kolumnę która wskazuje czy proforma została przekonwertowana na fakturę VAT
ALTER TABLE invoices 
  ADD COLUMN IF NOT EXISTS proforma_converted_to_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

-- Zaktualizuj check constraint dla statusu
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check 
  CHECK (status IN ('draft', 'proforma', 'issued', 'paid', 'cancelled', 'overdue'));

-- Dodaj index dla szybszego wyszukiwania proform i ich faktur
CREATE INDEX IF NOT EXISTS idx_invoices_is_proforma ON invoices(is_proforma) WHERE is_proforma = true;
CREATE INDEX IF NOT EXISTS idx_invoices_proforma_converted ON invoices(proforma_converted_to_invoice_id);

-- Dodaj check że tylko proformy mogą mieć status 'proforma'
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_proforma_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_proforma_status_check 
  CHECK (
    (is_proforma = true AND status IN ('draft', 'proforma', 'cancelled')) OR
    (is_proforma = false AND status IN ('draft', 'issued', 'paid', 'cancelled', 'overdue'))
  );

COMMENT ON COLUMN invoices.is_proforma IS 'Czy to jest faktura proforma (nie idzie do KSeF, tylko PDF dla klienta)';
COMMENT ON COLUMN invoices.proforma_converted_to_invoice_id IS 'Jeśli to proforma - ID faktury VAT powstałej z tej proformy';
COMMENT ON COLUMN invoices.status IS 'Status: draft=szkic, proforma=proforma(tylko PDF), issued=wysłana do KSeF, paid=zapłacona, cancelled=anulowana, overdue=przeterminowana';
