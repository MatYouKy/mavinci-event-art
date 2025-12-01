/*
  # Aktualizacja typów faktur i relacji

  1. Zmiany w tabelach
    - Dodanie typu 'vat' dla zwykłej faktury VAT (zamiast 'final')
    - Rozszerzenie relacji z innymi fakturami
    - Dodanie widoków dla lepszej prezentacji powiązań

  2. Funkcje pomocnicze
    - Funkcja do pobierania powiązanych faktur
    - Funkcja do pobierania historii faktur dla eventu/organizacji
*/

-- Dodaj nowy typ faktury 'vat' do istniejącego constraint
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_type_check 
  CHECK (invoice_type IN ('vat', 'proforma', 'advance', 'corrective'));

-- Aktualizuj istniejące faktury typu 'final' na 'vat'
UPDATE invoices SET invoice_type = 'vat' WHERE invoice_type = 'final';

-- Dodaj kolumnę dla kontaktu osobowego
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'buyer_contact_person'
  ) THEN
    ALTER TABLE invoices ADD COLUMN buyer_contact_person text;
  END IF;
END $$;

-- Funkcja do pobierania powiązanych faktur dla eventu
CREATE OR REPLACE FUNCTION get_event_invoices(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  invoice_number text,
  invoice_type text,
  status text,
  issue_date date,
  total_gross numeric,
  buyer_name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id,
    i.invoice_number,
    i.invoice_type,
    i.status,
    i.issue_date,
    i.total_gross,
    i.buyer_name
  FROM invoices i
  WHERE i.event_id = p_event_id
  ORDER BY i.issue_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do pobierania faktur dla organizacji
CREATE OR REPLACE FUNCTION get_organization_invoices(p_organization_id uuid)
RETURNS TABLE (
  id uuid,
  invoice_number text,
  invoice_type text,
  status text,
  issue_date date,
  payment_due_date date,
  total_gross numeric,
  paid_date date,
  event_name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id,
    i.invoice_number,
    i.invoice_type,
    i.status,
    i.issue_date,
    i.payment_due_date,
    i.total_gross,
    i.paid_date,
    e.name as event_name
  FROM invoices i
  LEFT JOIN events e ON i.event_id = e.id
  WHERE i.organization_id = p_organization_id
  ORDER BY i.issue_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do pobierania powiązanych faktur
CREATE OR REPLACE FUNCTION get_related_invoices(p_invoice_id uuid)
RETURNS TABLE (
  id uuid,
  invoice_number text,
  invoice_type text,
  status text,
  issue_date date,
  total_gross numeric,
  relation_type text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id,
    i.invoice_number,
    i.invoice_type,
    i.status,
    i.issue_date,
    i.total_gross,
    'corrects_this'::text as relation_type
  FROM invoices i
  WHERE i.related_invoice_id = p_invoice_id
  
  UNION ALL
  
  SELECT 
    i.id,
    i.invoice_number,
    i.invoice_type,
    i.status,
    i.issue_date,
    i.total_gross,
    'corrected_by_this'::text as relation_type
  FROM invoices i
  WHERE i.id = (SELECT related_invoice_id FROM invoices WHERE id = p_invoice_id)
  
  ORDER BY issue_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Widok z rozszerzonymi informacjami o fakturach
CREATE OR REPLACE VIEW invoices_with_relations AS
SELECT 
  i.*,
  o.name as organization_name,
  o.nip as organization_nip,
  c.full_name as contact_person_name,
  c.email as contact_person_email,
  c.phone as contact_person_phone,
  e.name as event_name,
  e.event_date as event_date,
  e.status as event_status,
  rel.invoice_number as related_invoice_number,
  rel.invoice_type as related_invoice_type,
  creator.name || ' ' || creator.surname as created_by_name,
  issuer.name || ' ' || issuer.surname as issued_by_name
FROM invoices i
LEFT JOIN organizations o ON i.organization_id = o.id
LEFT JOIN contacts c ON i.contact_person_id = c.id
LEFT JOIN events e ON i.event_id = e.id
LEFT JOIN invoices rel ON i.related_invoice_id = rel.id
LEFT JOIN employees creator ON i.created_by = creator.id
LEFT JOIN employees issuer ON i.issued_by = issuer.id;

-- Dodaj uprawnienia
GRANT EXECUTE ON FUNCTION get_event_invoices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_organization_invoices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_related_invoices(uuid) TO authenticated;

-- Dodaj index
CREATE INDEX IF NOT EXISTS idx_invoices_related_invoice_id ON invoices(related_invoice_id) WHERE related_invoice_id IS NOT NULL;

-- Komentarze
COMMENT ON COLUMN invoices.invoice_type IS 'Typ faktury: vat (zwykła VAT), proforma, advance (zaliczkowa), corrective (korygująca)';
COMMENT ON COLUMN invoices.related_invoice_id IS 'ID powiązanej faktury (np. faktura korygująca odnosi się do faktury pierwotnej)';
