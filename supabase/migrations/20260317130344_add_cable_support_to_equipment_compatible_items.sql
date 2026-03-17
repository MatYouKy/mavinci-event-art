/*
  # Dodaj wsparcie dla przewodów w kompatybilności sprzętu

  1. Zmiany
    - Dodaj kolumnę `compatible_cable_id` do tabeli `equipment_compatible_items`
    - Dodaj foreign key do tabeli `cables`
    - Zaktualizuj constraint aby wymaga dokładnie jednego z: equipment, kit lub cable
    - Dodaj indeks dla wydajności

  2. Bezpieczeństwo
    - RLS policies pozostają bez zmian
    - Użytkownicy z uprawnieniem `equipment_manage` mogą dodawać/usuwać kompatybilne przewody
*/

-- Dodaj kolumnę dla przewodów
ALTER TABLE equipment_compatible_items
ADD COLUMN IF NOT EXISTS compatible_cable_id uuid REFERENCES cables(id) ON DELETE CASCADE;

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_equipment_compatible_items_compatible_cable_id
ON equipment_compatible_items(compatible_cable_id);

-- Usuń stary constraint
ALTER TABLE equipment_compatible_items
DROP CONSTRAINT IF EXISTS check_compatible_item_type;

-- Dodaj nowy constraint aby wymaga dokładnie jednego z: equipment, kit lub cable
ALTER TABLE equipment_compatible_items
ADD CONSTRAINT check_compatible_item_type CHECK (
  (compatible_equipment_id IS NOT NULL AND compatible_kit_id IS NULL AND compatible_cable_id IS NULL) OR
  (compatible_equipment_id IS NULL AND compatible_kit_id IS NOT NULL AND compatible_cable_id IS NULL) OR
  (compatible_equipment_id IS NULL AND compatible_kit_id IS NULL AND compatible_cable_id IS NOT NULL)
);

-- Dodaj unique constraints aby zapobiec duplikatom
CREATE UNIQUE INDEX IF NOT EXISTS unique_equipment_compatible_cable
ON equipment_compatible_items(equipment_id, compatible_cable_id)
WHERE compatible_cable_id IS NOT NULL;

COMMENT ON COLUMN equipment_compatible_items.compatible_cable_id IS 'ID przewodu kompatybilnego z tym sprzętem';
