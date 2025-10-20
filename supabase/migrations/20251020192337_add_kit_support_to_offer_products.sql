/*
  # Dodanie wsparcia dla pakietów sprzętu w produktach ofertowych

  1. Zmiany w `offer_product_equipment`
    - Dodanie kolumny `equipment_kit_id` jako opcjonalna
    - Można wybrać albo `equipment_item_id` albo `equipment_kit_id`
    - Dodanie walidacji: jedno z dwóch musi być wypełnione
    
  2. Bezpieczeństwo
    - Zachowanie istniejących policyjna RLS
    - Foreign key do `equipment_kits`
*/

-- Dodaj kolumnę equipment_kit_id do offer_product_equipment
ALTER TABLE offer_product_equipment
ADD COLUMN IF NOT EXISTS equipment_kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE;

-- Zmień equipment_item_id na nullable (bo możemy mieć albo item albo kit)
ALTER TABLE offer_product_equipment
ALTER COLUMN equipment_item_id DROP NOT NULL;

-- Dodaj constraint: musi być albo equipment_item_id albo equipment_kit_id (nie oba, nie żadne)
ALTER TABLE offer_product_equipment
ADD CONSTRAINT check_equipment_xor 
CHECK (
  (equipment_item_id IS NOT NULL AND equipment_kit_id IS NULL) OR
  (equipment_item_id IS NULL AND equipment_kit_id IS NOT NULL)
);

-- Dodaj indeks dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_offer_product_equipment_kit_id 
ON offer_product_equipment(equipment_kit_id) 
WHERE equipment_kit_id IS NOT NULL;

COMMENT ON COLUMN offer_product_equipment.equipment_kit_id IS 'Opcjonalny pakiet sprzętu. Jeśli ustawiony, equipment_item_id musi być NULL';
COMMENT ON CONSTRAINT check_equipment_xor ON offer_product_equipment IS 'Zapewnia że jest albo equipment_item_id albo equipment_kit_id, nie oba i nie żadne';
