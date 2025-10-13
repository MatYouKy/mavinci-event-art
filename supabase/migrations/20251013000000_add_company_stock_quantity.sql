/*
  # Dodanie pola "Stan na firmie"

  ## Zmiany
  - Dodanie kolumny `company_stock_quantity` do tabeli `equipment_stock`
  - Wartość domyślna: 0
  - Przechowuje ilość sprzętu znajdującego się fizycznie na firmie

  ## Notatki
  - To pole pozwala śledzić ile sprzętu jest aktualnie w magazynie firmy
  - Może różnić się od `available_quantity` (dostępne do wypożyczenia)
*/

ALTER TABLE equipment_stock
ADD COLUMN IF NOT EXISTS company_stock_quantity integer DEFAULT 0 NOT NULL;

COMMENT ON COLUMN equipment_stock.company_stock_quantity IS 'Ilość sprzętu znajdującego się fizycznie w magazynie firmy';
