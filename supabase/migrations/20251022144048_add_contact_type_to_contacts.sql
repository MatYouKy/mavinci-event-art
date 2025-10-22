/*
  # Dodanie typu kontaktu
  
  1. Zmiany
    - Dodanie pola contact_type do tabeli contacts
    - Typy: organization, contact, subcontractor, individual
    
  2. Logika
    - organization: Organizacja (ma kontakty w contact_organizations)
    - contact: Kontakt (może mieć przypisaną organizację)
    - subcontractor: Podwykonawca (działa podobnie jak organization)
    - individual: Osoba prywatna (niezależna)
*/

-- Dodaj typ kontaktu
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'contact_type'
  ) THEN
    ALTER TABLE contacts ADD COLUMN contact_type text DEFAULT 'contact';
  END IF;
END $$;

-- Dodaj constraint na dozwolone wartości
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'contacts_contact_type_check'
  ) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check 
      CHECK (contact_type IN ('organization', 'contact', 'subcontractor', 'individual'));
  END IF;
END $$;

-- Dodaj indeks
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts(contact_type);

-- Komentarze
COMMENT ON COLUMN contacts.contact_type IS 'Typ kontaktu: organization (org. z kontaktami), contact (może mieć org), subcontractor (podwykonawca), individual (osoba prywatna)';

-- Jeśli contacts ma organization_id, to typu 'contact', w przeciwnym razie 'individual'
UPDATE contacts 
SET contact_type = CASE
  WHEN EXISTS (
    SELECT 1 FROM contact_organizations 
    WHERE contact_organizations.contact_id = contacts.id
  ) THEN 'contact'
  ELSE 'individual'
END
WHERE contact_type IS NULL OR contact_type = 'contact';