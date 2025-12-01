/*
  # System klientów businessowych z walidacją faktur

  1. Nowe pola
    - events.client_type - typ klienta (individual/business)
    - contacts.is_business_client - czy prowadzi działalność gospodarczą
    - contacts.company_name - nazwa firmy dla działalności
    - contacts.bank_account - konto bankowe
    
  2. Walidacja
    - Faktury tylko dla klientów businessowych
    - NIP wymagany dla faktur VAT
    - Automatyczne wykrywanie typu klienta
    
  3. Funkcje pomocnicze
    - get_event_client_info() - informacje o kliencie eventu
    - get_business_clients() - lista klientów businessowych
*/

-- Enum dla typu klienta
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_type_enum') THEN
    CREATE TYPE client_type_enum AS ENUM ('individual', 'business');
  END IF;
END $$;

-- Dodaj client_type do events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'client_type'
  ) THEN
    ALTER TABLE events ADD COLUMN client_type client_type_enum DEFAULT 'business';
    COMMENT ON COLUMN events.client_type IS 'Typ klienta: individual (klient indywidualny) lub business (klient businessowy - firma)';
  END IF;
END $$;

-- Dodaj pola do contacts dla działalności gospodarczej
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contacts' AND column_name = 'is_business_client'
  ) THEN
    ALTER TABLE contacts ADD COLUMN is_business_client boolean DEFAULT false;
    COMMENT ON COLUMN contacts.is_business_client IS 'Czy osoba prowadzi działalność gospodarczą';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contacts' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE contacts ADD COLUMN company_name text;
    COMMENT ON COLUMN contacts.company_name IS 'Nazwa firmy dla działalności gospodarczej';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contacts' AND column_name = 'bank_account'
  ) THEN
    ALTER TABLE contacts ADD COLUMN bank_account text;
    COMMENT ON COLUMN contacts.bank_account IS 'Numer konta bankowego';
  END IF;
END $$;

-- Walidacja: kontakty businessowe muszą mieć NIP
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS check_business_client_has_nip;
ALTER TABLE contacts ADD CONSTRAINT check_business_client_has_nip 
  CHECK (
    (is_business_client = false) OR 
    (is_business_client = true AND nip IS NOT NULL AND length(trim(nip)) >= 10)
  );

-- Funkcja do walidacji faktur
CREATE OR REPLACE FUNCTION validate_invoice_for_business_client()
RETURNS TRIGGER AS $$
DECLARE
  org_exists boolean;
  contact_is_business boolean;
BEGIN
  -- Faktury mogą być wystawiane tylko dla klientów businessowych
  IF NEW.organization_id IS NOT NULL THEN
    -- Sprawdź czy organizacja istnieje
    SELECT EXISTS(SELECT 1 FROM organizations WHERE id = NEW.organization_id) INTO org_exists;
    IF NOT org_exists THEN
      RAISE EXCEPTION 'Podana organizacja nie istnieje';
    END IF;
    -- Organizacja = klient businessowy, OK
  ELSIF NEW.contact_person_id IS NOT NULL THEN
    -- Sprawdź czy kontakt prowadzi działalność
    SELECT COALESCE(is_business_client, false) INTO contact_is_business
    FROM contacts
    WHERE id = NEW.contact_person_id;
    
    IF contact_is_business = false THEN
      RAISE EXCEPTION 'Faktury mogą być wystawiane tylko dla klientów businessowych. Dla klientów indywidualnych użyj rachunku lub paragonu. Oznacz kontakt jako prowadzący działalność gospodarczą jeśli to jednoosobowa firma.';
    END IF;
  ELSE
    -- Brak klienta businessowego
    RAISE EXCEPTION 'Faktura musi być powiązana z klientem businessowym (organizacją lub kontaktem prowadzącym działalność gospodarczą)';
  END IF;
  
  -- Sprawdź NIP dla faktury VAT
  IF NEW.invoice_type = 'vat' AND (NEW.buyer_nip IS NULL OR length(trim(NEW.buyer_nip)) < 10) THEN
    RAISE EXCEPTION 'Faktury VAT wymagają podania NIP nabywcy';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger walidacji faktur
DROP TRIGGER IF EXISTS trigger_validate_invoice_business_client ON invoices;
CREATE TRIGGER trigger_validate_invoice_business_client
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION validate_invoice_for_business_client();

-- Funkcja do automatycznego ustawiania client_type
CREATE OR REPLACE FUNCTION auto_set_event_client_type()
RETURNS TRIGGER AS $$
DECLARE
  contact_is_business boolean;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    NEW.client_type = 'business';
  ELSIF NEW.contact_person_id IS NOT NULL THEN
    SELECT COALESCE(is_business_client, false) INTO contact_is_business
    FROM contacts
    WHERE id = NEW.contact_person_id;
    
    NEW.client_type = CASE WHEN contact_is_business THEN 'business' ELSE 'individual' END;
  ELSE
    NEW.client_type = 'business';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger do auto-ustawiania typu klienta
DROP TRIGGER IF EXISTS trigger_auto_set_event_client_type ON events;
CREATE TRIGGER trigger_auto_set_event_client_type
  BEFORE INSERT OR UPDATE OF organization_id, contact_person_id ON events
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_event_client_type();

-- Funkcja do pobierania info o kliencie eventu
CREATE OR REPLACE FUNCTION get_event_client_info(p_event_id uuid)
RETURNS TABLE (
  client_type text,
  client_name text,
  client_nip text,
  is_business boolean,
  can_invoice boolean,
  organization_id uuid,
  contact_id uuid
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.client_type::text,
    COALESCE(
      o.name,
      CASE 
        WHEN c.is_business_client THEN COALESCE(c.company_name, c.first_name || ' ' || c.last_name)
        ELSE c.first_name || ' ' || c.last_name
      END,
      'Brak klienta'
    ) as client_name,
    COALESCE(o.nip, c.nip) as client_nip,
    CASE 
      WHEN o.id IS NOT NULL THEN true
      WHEN c.is_business_client THEN true
      ELSE false
    END as is_business,
    CASE 
      WHEN o.id IS NOT NULL AND o.nip IS NOT NULL THEN true
      WHEN c.is_business_client AND c.nip IS NOT NULL THEN true
      ELSE false
    END as can_invoice,
    e.organization_id,
    e.contact_person_id
  FROM events e
  LEFT JOIN organizations o ON e.organization_id = o.id
  LEFT JOIN contacts c ON e.contact_person_id = c.id
  WHERE e.id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do pobierania klientów businessowych
CREATE OR REPLACE FUNCTION get_business_clients()
RETURNS TABLE (
  id uuid,
  client_type text,
  name text,
  nip text,
  email text,
  phone text,
  address text,
  city text,
  postal_code text,
  can_invoice boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    'organization'::text,
    o.name,
    o.nip,
    o.email,
    o.phone,
    o.address,
    o.city,
    o.postal_code,
    (o.nip IS NOT NULL AND length(trim(o.nip)) >= 10) as can_invoice
  FROM organizations o
  WHERE o.status = 'active'
  
  UNION ALL
  
  SELECT 
    c.id,
    'contact'::text,
    COALESCE(c.company_name, c.first_name || ' ' || c.last_name),
    c.nip,
    c.email,
    c.phone,
    c.address,
    c.city,
    c.postal_code,
    (c.nip IS NOT NULL AND length(trim(c.nip)) >= 10) as can_invoice
  FROM contacts c
  WHERE c.is_business_client = true AND c.status = 'active'
  
  ORDER BY name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Uprawnienia
GRANT EXECUTE ON FUNCTION get_event_client_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_business_clients() TO authenticated;

-- Aktualizuj istniejące eventy
UPDATE events e
SET client_type = CASE 
  WHEN e.organization_id IS NOT NULL THEN 'business'::client_type_enum
  WHEN e.contact_person_id IS NOT NULL THEN 'individual'::client_type_enum
  ELSE 'business'::client_type_enum
END
WHERE client_type IS NULL OR client_type::text = '';

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_events_client_type ON events(client_type);
CREATE INDEX IF NOT EXISTS idx_contacts_is_business_client ON contacts(is_business_client) WHERE is_business_client = true;
CREATE INDEX IF NOT EXISTS idx_organizations_nip ON organizations(nip) WHERE nip IS NOT NULL;

COMMENT ON FUNCTION get_event_client_info IS 'Informacje o kliencie eventu z flagą czy można wystawiać faktury';
COMMENT ON FUNCTION get_business_clients IS 'Lista klientów businessowych (organizacje i kontakty z działalnością)';
