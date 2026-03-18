/*
  # Dodaj kategorię magazynową do sprzętu wynajmu

  1. Zmiany
    - Dodanie kolumny `warehouse_category_id` do `subcontractor_rental_equipment`
    - Foreign key do tabeli `warehouse_categories`
    - Indeks dla wydajności zapytań

  2. Uwagi
    - Kolumna nullable - nie wszystkie sprzęty muszą mieć kategorię magazynową
    - To pozwala na spójną kategoryzację sprzętu własnego i wynajmowanego
*/

-- Dodaj kolumnę warehouse_category_id
ALTER TABLE subcontractor_rental_equipment
ADD COLUMN IF NOT EXISTS warehouse_category_id uuid REFERENCES warehouse_categories(id) ON DELETE SET NULL;

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_rental_equipment_warehouse_category 
ON subcontractor_rental_equipment(warehouse_category_id);

-- Dodaj komentarz
COMMENT ON COLUMN subcontractor_rental_equipment.warehouse_category_id IS 
'Kategoria magazynowa sprzętu (wspólna z equipment_items)';
