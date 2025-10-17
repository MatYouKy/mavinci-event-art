/*
  # Integracja umów podwykonawców z systemem plików wydarzeń

  ## Opis
  Umowy podwykonawców będą automatycznie zapisywane w systemie plików wydarzeń,
  w dedykowanym folderze "Umowy z podwykonawcami".

  ## Zmiany
  
  1. Dodanie kolumny `event_file_id` do `subcontractor_contracts`
     - Powiązanie umowy z plikiem w event_files
  
  2. Funkcja automatycznego tworzenia folderu dla umów
  
  3. Trigger zapisujący umowę do plików po jej dodaniu/aktualizacji
*/

-- Dodaj kolumnę łączącą umowę z plikiem
ALTER TABLE subcontractor_contracts
ADD COLUMN IF NOT EXISTS event_file_id uuid REFERENCES event_files(id) ON DELETE SET NULL;

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_event_file 
ON subcontractor_contracts(event_file_id);

-- Funkcja zapewniająca istnienie folderu "Umowy z podwykonawcami"
CREATE OR REPLACE FUNCTION ensure_contracts_folder(p_event_id uuid)
RETURNS uuid AS $$
DECLARE
  v_folder_id uuid;
BEGIN
  -- Sprawdź czy folder już istnieje
  SELECT id INTO v_folder_id
  FROM event_file_folders
  WHERE event_id = p_event_id
  AND name = 'Umowy z podwykonawcami'
  LIMIT 1;

  -- Jeśli nie istnieje, utwórz go
  IF v_folder_id IS NULL THEN
    INSERT INTO event_file_folders (event_id, name, color)
    VALUES (p_event_id, 'Umowy z podwykonawcami', '#8b5cf6')
    RETURNING id INTO v_folder_id;
  END IF;

  RETURN v_folder_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja kopiująca plik umowy do event_files po przesłaniu
CREATE OR REPLACE FUNCTION sync_contract_file_to_event()
RETURNS TRIGGER AS $$
DECLARE
  v_folder_id uuid;
  v_file_id uuid;
  v_file_exists boolean;
BEGIN
  -- Tylko dla umów przypisanych do wydarzeń z plikiem
  IF NEW.event_id IS NOT NULL AND NEW.file_path IS NOT NULL THEN
    
    -- Sprawdź czy plik już istnieje w event_files
    SELECT id INTO v_file_id
    FROM event_files
    WHERE event_id = NEW.event_id
    AND file_path = NEW.file_path
    LIMIT 1;

    -- Jeśli plik nie istnieje, dodaj go
    IF v_file_id IS NULL THEN
      -- Zapewnij folder
      v_folder_id := ensure_contracts_folder(NEW.event_id);

      -- Dodaj plik do event_files
      INSERT INTO event_files (
        event_id,
        folder_id,
        name,
        original_name,
        file_path,
        file_size,
        mime_type,
        uploaded_by
      )
      VALUES (
        NEW.event_id,
        v_folder_id,
        NEW.title || ' - ' || NEW.contract_number,
        NEW.contract_number || '.pdf',
        NEW.file_path,
        0, -- rozmiar będzie zaktualizowany przez aplikację
        'application/pdf',
        NEW.created_by
      )
      RETURNING id INTO v_file_id;
    END IF;

    -- Zaktualizuj powiązanie
    NEW.event_file_id := v_file_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla nowych i aktualizowanych umów
DROP TRIGGER IF EXISTS sync_contract_file_trigger ON subcontractor_contracts;
CREATE TRIGGER sync_contract_file_trigger
  BEFORE INSERT OR UPDATE OF file_path, event_id
  ON subcontractor_contracts
  FOR EACH ROW
  EXECUTE FUNCTION sync_contract_file_to_event();

-- Komentarz do kolumny
COMMENT ON COLUMN subcontractor_contracts.event_file_id IS 
  'Powiązanie z plikiem w event_files - umowy są automatycznie kopiowane do plików wydarzenia';