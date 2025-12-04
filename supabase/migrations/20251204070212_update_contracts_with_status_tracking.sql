/*
  # Aktualizacja systemu umów z śledzeniem statusów - część 2

  1. Zmiany
    - Aktualizacja istniejących rekordów
    - Dodanie pól do śledzenia dat zmian statusu
    - Dodanie triggera do automatycznej aktualizacji dat
    
  2. Nowe pola
    - issued_at (data wystawienia)
    - sent_at (data wysłania) 
    - signed_by_client_at (data podpisania przez klienta)
    - signed_returned_at (data odesłania podpisanej)
    - cancelled_at (data anulowania)
*/

-- Aktualizuj istniejące rekordy: signed -> signed_by_client
UPDATE contracts 
SET status = 'signed_by_client'::contract_status 
WHERE status = 'signed'::contract_status;

-- Dodaj nowe pola do śledzenia dat
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' AND column_name = 'issued_at'
  ) THEN
    ALTER TABLE contracts ADD COLUMN issued_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' AND column_name = 'sent_at'
  ) THEN
    ALTER TABLE contracts ADD COLUMN sent_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' AND column_name = 'signed_by_client_at'
  ) THEN
    ALTER TABLE contracts ADD COLUMN signed_by_client_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' AND column_name = 'signed_returned_at'
  ) THEN
    ALTER TABLE contracts ADD COLUMN signed_returned_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE contracts ADD COLUMN cancelled_at timestamptz;
  END IF;
END $$;

-- Trigger do automatycznej aktualizacji dat statusów
CREATE OR REPLACE FUNCTION update_contract_status_dates()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'issued' THEN
        NEW.issued_at = COALESCE(NEW.issued_at, now());
      WHEN 'sent' THEN
        NEW.sent_at = COALESCE(NEW.sent_at, now());
      WHEN 'signed_by_client' THEN
        NEW.signed_by_client_at = COALESCE(NEW.signed_by_client_at, now());
      WHEN 'signed_returned' THEN
        NEW.signed_returned_at = COALESCE(NEW.signed_returned_at, now());
      WHEN 'cancelled' THEN
        NEW.cancelled_at = COALESCE(NEW.cancelled_at, now());
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contracts_update_status_dates ON contracts;
CREATE TRIGGER contracts_update_status_dates
  BEFORE UPDATE OF status ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_status_dates();

COMMENT ON COLUMN contracts.issued_at IS 'Data wystawienia umowy';
COMMENT ON COLUMN contracts.sent_at IS 'Data wysłania umowy do klienta';
COMMENT ON COLUMN contracts.signed_by_client_at IS 'Data podpisania przez klienta';
COMMENT ON COLUMN contracts.signed_returned_at IS 'Data odesłania podpisanej umowy';
COMMENT ON COLUMN contracts.cancelled_at IS 'Data anulowania umowy';
