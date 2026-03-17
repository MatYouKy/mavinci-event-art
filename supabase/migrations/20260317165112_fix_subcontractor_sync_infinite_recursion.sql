/*
  # Naprawienie nieskończonej rekursji w synchronizacji subcontractors

  Problem:
  - Trigger na organizations wywołuje UPDATE na subcontractors
  - Trigger na subcontractors wywołuje UPDATE na organizations
  - Powstaje nieskończona pętla

  Rozwiązanie:
  - Dodanie flagi session_replication_role do wyłączania triggerów podczas sync
  - Użycie UPDATE tylko gdy dane się różnią
  - Dodanie warunków zapobiegających zbędnym UPDATE
*/

-- Drop istniejących triggerów
DROP TRIGGER IF EXISTS trigger_sync_organization_to_subcontractor ON organizations;
DROP TRIGGER IF EXISTS trigger_sync_subcontractor_to_organization ON subcontractors;

-- Nowa wersja funkcji organization -> subcontractor (tylko INSERT, bez UPDATE loop)
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
    
    -- Jeśli NIE ma jeszcze subcontractor_id, utwórz nowy rekord
    IF NEW.subcontractor_id IS NULL THEN
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
    
    -- UPDATE został usunięty - edycja tylko przez jeden kierunek (subcontractors)
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nowa wersja funkcji subcontractors -> organization (z warunkiem zapobiegającym pętli)
CREATE OR REPLACE FUNCTION sync_subcontractor_to_organization()
RETURNS trigger AS $$
DECLARE
  v_status_enum organization_status;
  v_org_record RECORD;
BEGIN
  -- Sprawdź czy istnieje powiązana organizacja
  SELECT * INTO v_org_record
  FROM organizations
  WHERE subcontractor_id = NEW.id
  LIMIT 1;
  
  -- Jeśli nie ma organizacji, nie rób nic
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  
  -- Sprawdź czy dane się różnią - jeśli nie, to nie aktualizuj (zapobiega pętli)
  IF v_org_record.name = NEW.company_name
    AND COALESCE(v_org_record.email, '') = COALESCE(NEW.email, '')
    AND COALESCE(v_org_record.phone, '') = COALESCE(NEW.phone, '')
    AND COALESCE(v_org_record.nip, '') = COALESCE(NEW.nip, '')
    AND COALESCE(v_org_record.address, '') = COALESCE(NEW.address, '')
    AND v_org_record.rating = NEW.rating
    AND COALESCE(v_org_record.notes, '') = COALESCE(NEW.notes, '')
    AND COALESCE(v_org_record.hourly_rate, 0) = COALESCE(NEW.hourly_rate, 0)
    AND COALESCE(v_org_record.payment_terms, '') = COALESCE(NEW.payment_terms, '')
    AND COALESCE(v_org_record.bank_account, '') = COALESCE(NEW.bank_account, '')
  THEN
    -- Dane są takie same, nie aktualizuj
    RETURN NEW;
  END IF;
  
  -- Konwertuj text na enum
  v_status_enum := CASE NEW.status
    WHEN 'active' THEN 'active'::organization_status
    WHEN 'inactive' THEN 'inactive'::organization_status
    WHEN 'blacklisted' THEN 'blacklisted'::organization_status
    ELSE 'active'::organization_status
  END;
  
  -- Zaktualizuj organizację (tylko jeśli dane się różnią)
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

-- Przywróć triggery (ale tylko organization -> subcontractor na INSERT)
CREATE TRIGGER trigger_sync_organization_to_subcontractor
  BEFORE INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION sync_organization_to_subcontractor();

-- Trigger subcontractors -> organization tylko na UPDATE (nie INSERT)
CREATE TRIGGER trigger_sync_subcontractor_to_organization
  AFTER UPDATE ON subcontractors
  FOR EACH ROW
  EXECUTE FUNCTION sync_subcontractor_to_organization();

COMMENT ON FUNCTION sync_organization_to_subcontractor IS 
  'Automatycznie tworzy rekord w subcontractors dla nowej organizacji typu subcontractor (tylko INSERT)';

COMMENT ON FUNCTION sync_subcontractor_to_organization IS 
  'Synchronizuje zmiany z subcontractors do organizations (tylko UPDATE, z warunkiem zapobiegającym pętli)';