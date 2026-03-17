/*
  # Połączenie organizations z tabelą subcontractors - naprawione

  1. Dodanie pola subcontractor_id do organizations
    - Pozwala na powiązanie organizacji typu 'subcontractor' z dedykowanym rekordem w tabeli subcontractors

  2. Triggers do dwukierunkowej synchronizacji
    - organizations -> subcontractors
    - subcontractors -> organizations
    - Z poprawnym castowaniem typów enum

  3. Migracja istniejących danych
*/

-- Dodaj pole subcontractor_id do organizations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'subcontractor_id'
  ) THEN
    ALTER TABLE organizations 
    ADD COLUMN subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL;
    
    CREATE INDEX IF NOT EXISTS idx_organizations_subcontractor 
      ON organizations(subcontractor_id) 
      WHERE subcontractor_id IS NOT NULL;
    
    COMMENT ON COLUMN organizations.subcontractor_id IS 
      'Powiązanie z tabelą subcontractors dla organization_type = subcontractor';
  END IF;
END $$;

-- Funkcja do tworzenia/aktualizacji rekordu w subcontractors
CREATE OR REPLACE FUNCTION sync_organization_to_subcontractor()
RETURNS trigger AS $$
DECLARE
  v_subcontractor_id uuid;
  v_status_text text;
BEGIN
  -- Tylko dla organizacji typu 'subcontractor'
  IF NEW.organization_type = 'subcontractor' THEN
    
    -- Konwertuj enum status na text
    v_status_text := CASE NEW.status::text
      WHEN 'active' THEN 'active'
      WHEN 'inactive' THEN 'inactive'
      WHEN 'blacklisted' THEN 'blacklisted'
      ELSE 'active'
    END;
    
    -- Jeśli już ma subcontractor_id, zaktualizuj dane
    IF NEW.subcontractor_id IS NOT NULL THEN
      UPDATE subcontractors
      SET 
        company_name = NEW.name,
        email = NEW.email,
        phone = NEW.phone,
        nip = NEW.nip,
        address = NEW.address,
        status = v_status_text,
        rating = NEW.rating,
        notes = NEW.notes,
        specialization = NEW.specialization,
        hourly_rate = NEW.hourly_rate,
        payment_terms = COALESCE(NEW.payment_terms, '14 dni'),
        bank_account = NEW.bank_account,
        updated_at = now()
      WHERE id = NEW.subcontractor_id;
      
    ELSE
      -- Utwórz nowy rekord w subcontractors
      INSERT INTO subcontractors (
        company_name,
        email,
        phone,
        nip,
        address,
        status,
        rating,
        notes,
        specialization,
        hourly_rate,
        payment_terms,
        bank_account
      ) VALUES (
        NEW.name,
        NEW.email,
        NEW.phone,
        NEW.nip,
        NEW.address,
        v_status_text,
        NEW.rating,
        NEW.notes,
        NEW.specialization,
        NEW.hourly_rate,
        COALESCE(NEW.payment_terms, '14 dni'),
        NEW.bank_account
      )
      RETURNING id INTO v_subcontractor_id;
      
      -- Zapisz ID do organizacji
      NEW.subcontractor_id = v_subcontractor_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger na INSERT i UPDATE
DROP TRIGGER IF EXISTS trigger_sync_organization_to_subcontractor ON organizations;
CREATE TRIGGER trigger_sync_organization_to_subcontractor
  BEFORE INSERT OR UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION sync_organization_to_subcontractor();

-- Funkcja do synchronizacji w drugą stronę (subcontractors -> organizations)
CREATE OR REPLACE FUNCTION sync_subcontractor_to_organization()
RETURNS trigger AS $$
DECLARE
  v_status_enum organization_status;
BEGIN
  -- Konwertuj text na enum
  v_status_enum := CASE NEW.status
    WHEN 'active' THEN 'active'::organization_status
    WHEN 'inactive' THEN 'inactive'::organization_status
    WHEN 'blacklisted' THEN 'blacklisted'::organization_status
    ELSE 'active'::organization_status
  END;
  
  -- Zaktualizuj odpowiednią organizację jeśli istnieje powiązanie
  UPDATE organizations
  SET 
    name = NEW.company_name,
    email = NEW.email,
    phone = NEW.phone,
    nip = NEW.nip,
    address = NEW.address,
    status = v_status_enum,
    rating = NEW.rating,
    notes = NEW.notes,
    specialization = NEW.specialization,
    hourly_rate = NEW.hourly_rate,
    payment_terms = NEW.payment_terms,
    bank_account = NEW.bank_account,
    updated_at = now()
  WHERE subcontractor_id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla reverse sync
DROP TRIGGER IF EXISTS trigger_sync_subcontractor_to_organization ON subcontractors;
CREATE TRIGGER trigger_sync_subcontractor_to_organization
  AFTER UPDATE ON subcontractors
  FOR EACH ROW
  EXECUTE FUNCTION sync_subcontractor_to_organization();

-- Zsynchronizuj istniejące dane
DO $$
DECLARE
  org_record RECORD;
  v_subcontractor_id uuid;
  v_status_text text;
BEGIN
  FOR org_record IN 
    SELECT * FROM organizations 
    WHERE organization_type = 'subcontractor' 
    AND subcontractor_id IS NULL
  LOOP
    -- Konwertuj enum status na text
    v_status_text := CASE org_record.status::text
      WHEN 'active' THEN 'active'
      WHEN 'inactive' THEN 'inactive'
      WHEN 'blacklisted' THEN 'blacklisted'
      ELSE 'active'
    END;
    
    -- Utwórz rekord w subcontractors
    INSERT INTO subcontractors (
      company_name,
      email,
      phone,
      nip,
      address,
      status,
      rating,
      notes,
      specialization,
      hourly_rate,
      payment_terms,
      bank_account
    ) VALUES (
      org_record.name,
      org_record.email,
      org_record.phone,
      org_record.nip,
      org_record.address,
      v_status_text,
      org_record.rating,
      org_record.notes,
      org_record.specialization,
      org_record.hourly_rate,
      COALESCE(org_record.payment_terms, '14 dni'),
      org_record.bank_account
    )
    RETURNING id INTO v_subcontractor_id;
    
    -- Zaktualizuj organizację
    UPDATE organizations
    SET subcontractor_id = v_subcontractor_id
    WHERE id = org_record.id;
  END LOOP;
END $$;

COMMENT ON FUNCTION sync_organization_to_subcontractor IS 
  'Automatycznie tworzy/aktualizuje rekord w subcontractors dla organizacji typu subcontractor';

COMMENT ON FUNCTION sync_subcontractor_to_organization IS 
  'Synchronizuje zmiany z subcontractors z powrotem do organizations';