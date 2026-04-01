/*
  # Rozdzielenie adresu w my_companies

  1. Zmiany
    - Usuń kolumnę `address` (jedna linia)
    - Dodaj kolumny:
      - `street` (text) - nazwa ulicy
      - `building_number` (text) - numer budynku
      - `apartment_number` (text, nullable) - numer lokalu/mieszkania

  2. Bezpieczeństwo
    - RLS już skonfigurowane, żadnych zmian
*/

-- Dodaj nowe kolumny dla szczegółowego adresu
DO $$
BEGIN
  -- Dodaj kolumnę street
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_companies' AND column_name = 'street'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN street text;
  END IF;

  -- Dodaj kolumnę building_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_companies' AND column_name = 'building_number'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN building_number text;
  END IF;

  -- Dodaj kolumnę apartment_number (nullable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_companies' AND column_name = 'apartment_number'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN apartment_number text;
  END IF;
END $$;

-- Migracja danych z address do nowych kolumn (parsowanie prostego formatu)
UPDATE my_companies
SET
  street = CASE
    WHEN address LIKE 'ul. %' THEN
      split_part(regexp_replace(address, '^ul\. ', ''), ' ', 1)
    ELSE
      split_part(address, ' ', 1)
  END,
  building_number = CASE
    WHEN address LIKE 'ul. %' THEN
      split_part(regexp_replace(address, '^ul\. ', ''), ' ', 2)
    ELSE
      split_part(address, ' ', 2)
  END
WHERE street IS NULL AND address IS NOT NULL;

-- Usuń starą kolumnę address
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_companies' AND column_name = 'address'
  ) THEN
    ALTER TABLE my_companies DROP COLUMN address;
  END IF;
END $$;

-- Ustaw NOT NULL dla wymaganych pól
ALTER TABLE my_companies
  ALTER COLUMN street SET NOT NULL,
  ALTER COLUMN building_number SET NOT NULL;
