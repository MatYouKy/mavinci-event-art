/*
  # Dodanie pola ilości dla przewodów
  
  1. Zmiany
    - Dodanie kolumny `cable_stock_quantity` do `equipment_items`
    - Tylko dla przewodów (bez jednostek jako obiektów)
    - Domyślna wartość: 0
  
  2. Uwagi
    - Dla przewodów: ilość przechowywana w `cable_stock_quantity`
    - Dla innych: ilość w `equipment_units` (jak dotychczas)
*/

-- Dodaj kolumnę dla ilości przewodów
ALTER TABLE equipment_items
ADD COLUMN IF NOT EXISTS cable_stock_quantity integer DEFAULT 0;

-- Dodaj komentarz
COMMENT ON COLUMN equipment_items.cable_stock_quantity IS 'Ilość sztuk przewodów na magazynie (tylko dla kategorii PRZEWODY)';
