/*
  # Dodanie typu dokumentu 'equipment_checklist'

  1. Zmiany
    - Rozszerzenie check constraint dla `event_files.document_type`
    - Dodanie wartości 'equipment_checklist' do dozwolonych typów dokumentów

  2. Szczegóły
    - equipment_checklist - Checklista sprzętu do załadowania/rozładowania
*/

-- Usuń stary constraint
ALTER TABLE event_files
DROP CONSTRAINT IF EXISTS event_files_document_type_check;

-- Dodaj nowy constraint z equipment_checklist
ALTER TABLE event_files
ADD CONSTRAINT event_files_document_type_check
CHECK (document_type IN ('offer', 'contract', 'invoice', 'agenda', 'equipment_checklist', 'other') OR document_type IS NULL);
