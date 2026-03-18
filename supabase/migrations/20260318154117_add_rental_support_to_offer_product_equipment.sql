/*
  # Dodanie wsparcia dla rental equipment w produktach ofertowych

  1. Zmiany w `offer_product_equipment`
    - Dodanie kolumny `rental_equipment_id` jako opcjonalna referencja do `subcontractor_rental_equipment`
    - Dodanie kolumny `subcontractor_id` dla łatwego dostępu do podwykonawcy
    - Dodanie kolumny `is_rental` boolean flag
    - Zaktualizowanie constraint aby umożliwić: item, kit lub rental equipment

  2. Bezpieczeństwo
    - Zachowanie istniejących policyjna RLS
    - Foreign key do `subcontractor_rental_equipment` i `subcontractors`
*/

-- Dodaj kolumny rental do offer_product_equipment
ALTER TABLE offer_product_equipment
ADD COLUMN IF NOT EXISTS rental_equipment_id uuid REFERENCES subcontractor_rental_equipment(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_rental boolean DEFAULT false;

-- Usuń stary constraint
ALTER TABLE offer_product_equipment
DROP CONSTRAINT IF EXISTS check_equipment_xor;

-- Dodaj nowy constraint: musi być albo equipment_item_id albo equipment_kit_id albo rental_equipment_id
ALTER TABLE offer_product_equipment
ADD CONSTRAINT check_equipment_xor_with_rental
CHECK (
  (equipment_item_id IS NOT NULL AND equipment_kit_id IS NULL AND rental_equipment_id IS NULL) OR
  (equipment_item_id IS NULL AND equipment_kit_id IS NOT NULL AND rental_equipment_id IS NULL) OR
  (equipment_item_id IS NULL AND equipment_kit_id IS NULL AND rental_equipment_id IS NOT NULL)
);

-- Dodaj indeksy dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_offer_product_equipment_rental_id
ON offer_product_equipment(rental_equipment_id)
WHERE rental_equipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_product_equipment_subcontractor_id
ON offer_product_equipment(subcontractor_id)
WHERE subcontractor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_product_equipment_is_rental
ON offer_product_equipment(is_rental)
WHERE is_rental = true;

COMMENT ON COLUMN offer_product_equipment.rental_equipment_id IS 'Opcjonalny sprzęt rental od podwykonawcy. Jeśli ustawiony, equipment_item_id i equipment_kit_id muszą być NULL';
COMMENT ON COLUMN offer_product_equipment.subcontractor_id IS 'ID podwykonawcy dostarczającego sprzęt rental';
COMMENT ON COLUMN offer_product_equipment.is_rental IS 'Czy ten item jest sprzętem wypożyczonym od podwykonawcy';
COMMENT ON CONSTRAINT check_equipment_xor_with_rental ON offer_product_equipment IS 'Zapewnia że jest albo equipment_item_id albo equipment_kit_id albo rental_equipment_id, nie więcej niż jedno';
