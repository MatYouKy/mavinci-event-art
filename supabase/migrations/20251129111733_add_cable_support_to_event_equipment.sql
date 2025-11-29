/*
  # Dodaj wsparcie dla kabli w event_equipment

  1. Zmiany
    - Dodaj kolumnę `cable_id` do tabeli `event_equipment`
    - Zaktualizuj constraint aby wspierać cables, equipment_items i kits
    - Dokładnie jeden z: cable_id, equipment_id, kit_id musi być ustawiony

  2. Bezpieczeństwo
    - Istniejące rekordy pozostają niezmienione
    - Nowa kolumna pozwala na lepsze zarządzanie kablami w eventach
*/

-- Dodaj kolumnę cable_id jeśli jeszcze nie istnieje
ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS cable_id uuid REFERENCES cables(id) ON DELETE CASCADE;

-- Usuń stary constraint jeśli istnieje
ALTER TABLE event_equipment
DROP CONSTRAINT IF EXISTS event_equipment_item_or_kit_check;

ALTER TABLE event_equipment
DROP CONSTRAINT IF EXISTS event_equipment_one_type_check;

-- Dodaj nowy constraint: dokładnie jedno z cable_id, equipment_id, kit_id musi być ustawione
ALTER TABLE event_equipment
ADD CONSTRAINT event_equipment_one_type_check CHECK (
  (cable_id IS NOT NULL AND equipment_id IS NULL AND kit_id IS NULL) OR
  (cable_id IS NULL AND equipment_id IS NOT NULL AND kit_id IS NULL) OR
  (cable_id IS NULL AND equipment_id IS NULL AND kit_id IS NOT NULL)
);

-- Dodaj indeks dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_event_equipment_cable ON event_equipment(cable_id);

-- Komentarz
COMMENT ON COLUMN event_equipment.cable_id IS 'ID kabla przypisanego do eventu (jeśli dotyczy)';
