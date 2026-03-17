/*
  # Dodanie obsługi kitów do kompatybilnych produktów

  1. Zmiany
    - Dodaj `compatible_kit_id` do `equipment_compatible_items`
    - Zmień constraint aby wymaga albo equipment albo kit (nie oba jednocześnie)
    - Dodaj unique constraint dla equipment_id + compatible_kit_id

  2. Opis
    - Teraz można dodawać zarówno pojedyncze urządzenia jak i kity jako kompatybilne
    - Przykład: Subwoofer pasywny wymaga wzmacniacza, ale wzmacniacz jest w kicie "AMP RACK"
    - Można dodać kilka kitów jako alternatywy (np. "AMP RACK 1x LAB" lub "AMP RACK 2x LAB")

  3. Bezpieczeństwo
    - RLS policies pozostają bez zmian
    - Użytkownicy z equipment_manage mogą dodawać/usuwać kompatybilne produkty
*/

-- Dodaj kolumnę dla kitów
ALTER TABLE equipment_compatible_items
ADD COLUMN IF NOT EXISTS compatible_kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE;

-- Dodaj indeks dla kitów
CREATE INDEX IF NOT EXISTS idx_equipment_compatible_items_compatible_kit_id
ON equipment_compatible_items(compatible_kit_id);

-- Usuń stary unique constraint
ALTER TABLE equipment_compatible_items
DROP CONSTRAINT IF EXISTS equipment_compatible_items_equipment_id_compatible_equipmen_key;

-- Dodaj nowy constraint aby wymaga albo equipment albo kit (nie oba jednocześnie)
ALTER TABLE equipment_compatible_items
DROP CONSTRAINT IF EXISTS check_compatible_item_type;

ALTER TABLE equipment_compatible_items
ADD CONSTRAINT check_compatible_item_type CHECK (
  (compatible_equipment_id IS NOT NULL AND compatible_kit_id IS NULL) OR
  (compatible_equipment_id IS NULL AND compatible_kit_id IS NOT NULL)
);

-- Dodaj unique constraint dla kombinacji equipment + equipment
CREATE UNIQUE INDEX IF NOT EXISTS unique_equipment_compatible_equipment
ON equipment_compatible_items(equipment_id, compatible_equipment_id)
WHERE compatible_equipment_id IS NOT NULL;

-- Dodaj unique constraint dla kombinacji equipment + kit
CREATE UNIQUE INDEX IF NOT EXISTS unique_equipment_compatible_kit
ON equipment_compatible_items(equipment_id, compatible_kit_id)
WHERE compatible_kit_id IS NOT NULL;

COMMENT ON COLUMN equipment_compatible_items.compatible_kit_id IS 'Kit który jest kompatybilny z tym sprzętem (alternatywa do compatible_equipment_id)';
