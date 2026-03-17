/*
  # Dodanie obsługi kitów w kompatybilności sprzętu

  1. Zmiany w equipment_compatible_items
    - Dodaj `compatible_kit_id` (uuid) - referencja do equipment_kits
    - Dodaj constraint zapewniający, że tylko equipment LUB kit jest ustawiony (nie oba)

  2. Indeksy
    - Dodaj indeks dla compatible_kit_id
    - Dodaj unikalny constraint dla (equipment_id, compatible_kit_id)

  3. Bezpieczeństwo
    - Istniejące RLS policies obejmują nową kolumnę automatycznie

  4. Przypadki użycia
    - Subwoofer pasywny może wymagać kitu wzmacniaczy
    - Podest sceniczny może zalecać kit nóg/wsporników
    - Mikrofon może sugerować kit akcesoriów (kabel, statyw, pop-filtr)
*/

-- Dodaj kolumnę compatible_kit_id
ALTER TABLE equipment_compatible_items
ADD COLUMN IF NOT EXISTS compatible_kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE;

-- Dodaj constraint zapewniający, że tylko jedno pole jest wypełnione
ALTER TABLE equipment_compatible_items
DROP CONSTRAINT IF EXISTS check_compatible_item_type;

ALTER TABLE equipment_compatible_items
ADD CONSTRAINT check_compatible_item_type CHECK (
  (compatible_equipment_id IS NOT NULL AND compatible_kit_id IS NULL) OR
  (compatible_equipment_id IS NULL AND compatible_kit_id IS NOT NULL)
);

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_equipment_compatible_items_compatible_kit_id
ON equipment_compatible_items(compatible_kit_id);

-- Dodaj unikalny constraint dla kitów (podobnie jak dla equipment)
CREATE UNIQUE INDEX IF NOT EXISTS unique_equipment_compatible_kit
ON equipment_compatible_items(equipment_id, compatible_kit_id)
WHERE compatible_kit_id IS NOT NULL;

COMMENT ON COLUMN equipment_compatible_items.compatible_kit_id IS 'Kit z magazynu który pasuje jako akcesorium do danego sprzętu (alternatywa dla compatible_equipment_id)';