/*
  # Fix: Umożliwienie nullable dla compatible_equipment_id

  1. Problem
    - Kolumna compatible_equipment_id jest NOT NULL
    - Nie można dodać kitu bo próbuje wstawić NULL w compatible_equipment_id

  2. Rozwiązanie
    - Usuń NOT NULL constraint z compatible_equipment_id
    - Istniejący check_compatible_item_type zapewnia że jedno z pól jest wypełnione

  3. Bezpieczeństwo
    - RLS policies pozostają bez zmian
    - Constraint sprawdza że dokładnie jedno pole jest wypełnione
*/

-- Usuń NOT NULL z compatible_equipment_id
ALTER TABLE equipment_compatible_items
ALTER COLUMN compatible_equipment_id DROP NOT NULL;

-- Sprawdź czy constraint check_compatible_item_type istnieje
-- (jeśli nie, dodaj go)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_compatible_item_type'
  ) THEN
    ALTER TABLE equipment_compatible_items
    ADD CONSTRAINT check_compatible_item_type CHECK (
      (compatible_equipment_id IS NOT NULL AND compatible_kit_id IS NULL) OR
      (compatible_equipment_id IS NULL AND compatible_kit_id IS NOT NULL)
    );
  END IF;
END $$;

COMMENT ON COLUMN equipment_compatible_items.compatible_equipment_id IS 'Sprzęt z magazynu który pasuje jako akcesorium (nullable gdy compatible_kit_id jest wypełniony)';
