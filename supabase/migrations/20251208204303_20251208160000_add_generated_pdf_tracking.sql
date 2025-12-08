/*
  # Dodanie śledzenia wygenerowanych PDF

  1. Zmiany w tabelach
    - `event_agendas` - dodanie kolumn dla śledzenia wygenerowanego PDF
      - `generated_pdf_path` (text) - ścieżka do ostatnio wygenerowanego PDF
      - `generated_pdf_at` (timestamptz) - kiedy został wygenerowany
      - `modified_after_generation` (boolean) - czy edytowano po wygenerowaniu

    - `contracts` - dodanie podobnych kolumn
      - `generated_pdf_path` (text)
      - `generated_pdf_at` (timestamptz)
      - `modified_after_generation` (boolean)

  2. Triggery
    - Automatyczne ustawianie `modified_after_generation` na true przy aktualizacji
*/

-- Dodaj kolumny do event_agendas
ALTER TABLE event_agendas
ADD COLUMN IF NOT EXISTS generated_pdf_path text,
ADD COLUMN IF NOT EXISTS generated_pdf_at timestamptz,
ADD COLUMN IF NOT EXISTS modified_after_generation boolean DEFAULT false;

-- Dodaj kolumny do contracts
ALTER TABLE contracts
ADD COLUMN IF NOT EXISTS generated_pdf_path text,
ADD COLUMN IF NOT EXISTS generated_pdf_at timestamptz,
ADD COLUMN IF NOT EXISTS modified_after_generation boolean DEFAULT false;

-- Trigger dla event_agendas - oznacz jako zmodyfikowane po edycji
CREATE OR REPLACE FUNCTION mark_agenda_modified()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli agenda jest aktualizowana i ma już wygenerowany PDF
  IF OLD.generated_pdf_path IS NOT NULL THEN
    -- Sprawdź czy zmieniono treść (nie status)
    IF (NEW.start_time IS DISTINCT FROM OLD.start_time) OR
       (NEW.end_time IS DISTINCT FROM OLD.end_time) OR
       (NEW.client_contact IS DISTINCT FROM OLD.client_contact) OR
       (NEW.event_name IS DISTINCT FROM OLD.event_name) OR
       (NEW.event_date IS DISTINCT FROM OLD.event_date) THEN
      NEW.modified_after_generation = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_agendas_mark_modified
  BEFORE UPDATE ON event_agendas
  FOR EACH ROW
  EXECUTE FUNCTION mark_agenda_modified();

-- Trigger dla contracts - oznacz jako zmodyfikowane po edycji
CREATE OR REPLACE FUNCTION mark_contract_modified()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli umowa jest aktualizowana i ma już wygenerowany PDF
  IF OLD.generated_pdf_path IS NOT NULL THEN
    -- Sprawdź czy zmieniono treść
    IF (NEW.content IS DISTINCT FROM OLD.content) OR
       (NEW.title IS DISTINCT FROM OLD.title) THEN
      NEW.modified_after_generation = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contracts_mark_modified
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION mark_contract_modified();

-- Dodaj kolumnę do offers (jeśli jeszcze nie ma)
ALTER TABLE offers
ADD COLUMN IF NOT EXISTS modified_after_generation boolean DEFAULT false;

-- Trigger dla offers
CREATE OR REPLACE FUNCTION mark_offer_modified()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.generated_pdf_url IS NOT NULL THEN
    -- Sprawdź czy zmieniono treść oferty
    IF (NEW.name IS DISTINCT FROM OLD.name) OR
       (NEW.notes IS DISTINCT FROM OLD.notes) OR
       (NEW.total_amount IS DISTINCT FROM OLD.total_amount) OR
       (NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'accepted') THEN
      NEW.modified_after_generation = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER offers_mark_modified
  BEFORE UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION mark_offer_modified();
