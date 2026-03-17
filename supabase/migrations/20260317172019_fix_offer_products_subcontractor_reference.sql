/*
  # Naprawa referencji subcontractor_id w offer_products

  1. Problem
    - offer_products.subcontractor_id wskazuje na starą tabelę subcontractors
    - Powinno wskazywać na organizations (nowa struktura)

  2. Rozwiązanie
    - Zmiana foreign key z subcontractors na organizations
    - Zachowanie istniejących danych

  3. Bezpieczeństwo
    - Dane nie są tracone, tylko zmienia się referencja
*/

-- Usuń stary constraint jeśli istnieje
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'offer_products' 
    AND constraint_name LIKE '%subcontractor%'
    AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE offer_products 
    DROP CONSTRAINT IF EXISTS offer_products_subcontractor_id_fkey;
  END IF;
END $$;

-- Dodaj nowy constraint wskazujący na organizations
ALTER TABLE offer_products 
  ADD CONSTRAINT offer_products_subcontractor_id_fkey 
  FOREIGN KEY (subcontractor_id) 
  REFERENCES organizations(id) 
  ON DELETE SET NULL;

-- Dodaj index dla wydajności
CREATE INDEX IF NOT EXISTS idx_offer_products_subcontractor 
  ON offer_products(subcontractor_id) 
  WHERE subcontractor_id IS NOT NULL;

COMMENT ON COLUMN offer_products.subcontractor_id IS 
  'ID organizacji typu subcontractor (z tabeli organizations)';

COMMENT ON CONSTRAINT offer_products_subcontractor_id_fkey ON offer_products IS 
  'Powiązanie z tabelą organizations dla usług podwykonawców';