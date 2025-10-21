/*
  # Rozszerzenie tabeli insurance_policies

  1. Dodane kolumny:
    - is_mandatory (boolean) - czy ubezpieczenie jest obowiązkowe
    - blocks_usage (boolean) - czy brak ubezpieczenia blokuje użytkowanie
    - detailed_coverage (jsonb) - szczegółowy zakres ochrony dla AC

  2. Przykład detailed_coverage dla AC:
    {
      "theft": true,
      "fire": true,
      "vandalism": true,
      "glass": true,
      "natural_disasters": true,
      "collision": {
        "own_fault": true,
        "others_fault": true
      },
      "assistance": {
        "towing": true,
        "replacement_vehicle": true
      }
    }
*/

-- Dodaj kolumny jeśli nie istnieją
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'insurance_policies' AND column_name = 'is_mandatory'
  ) THEN
    ALTER TABLE insurance_policies ADD COLUMN is_mandatory boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'insurance_policies' AND column_name = 'blocks_usage'
  ) THEN
    ALTER TABLE insurance_policies ADD COLUMN blocks_usage boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'insurance_policies' AND column_name = 'detailed_coverage'
  ) THEN
    ALTER TABLE insurance_policies ADD COLUMN detailed_coverage jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Ustaw OC jako obowiązkowe i blokujące
UPDATE insurance_policies
SET is_mandatory = true, blocks_usage = true
WHERE type = 'oc';
