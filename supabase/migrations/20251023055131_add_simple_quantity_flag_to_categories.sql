/*
  # Flaga zarządzania ilością w kategoriach
  
  1. Zmiany
    - Dodanie `uses_simple_quantity` do `warehouse_categories`
    - Dla kategorii z flagą TRUE: ilość jako liczba w `cable_stock_quantity`
    - Dla kategorii z flagą FALSE: ilość jako jednostki w `equipment_units`
  
  2. Wartości domyślne
    - FALSE (domyślnie używamy jednostek)
    - TRUE tylko dla PRZEWODY
  
  3. Notatki
    - Pozwala elastycznie zarządzać różnymi kategoriami
    - Nie tylko przewody mogą używać prostej ilości
*/

-- Dodaj flagę do kategorii
ALTER TABLE warehouse_categories
ADD COLUMN IF NOT EXISTS uses_simple_quantity boolean DEFAULT false;

COMMENT ON COLUMN warehouse_categories.uses_simple_quantity IS 
  'TRUE = prosta ilość (cable_stock_quantity), FALSE = jednostki jako obiekty (equipment_units)';

-- Ustaw TRUE dla kategorii PRZEWODY
UPDATE warehouse_categories
SET uses_simple_quantity = true
WHERE LOWER(name) LIKE '%przewod%' OR LOWER(name) = 'cables';
