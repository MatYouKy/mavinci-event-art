/*
  # Dodaj pole expand_kit_in_checklist do offer_product_equipment

  1. Zmiany
    - Dodanie kolumny `expand_kit_in_checklist` do tabeli `offer_product_equipment`
    - Kontroluje czy zestaw ma być rozwinięty podczas kopiowania do eventu
    - Jeśli true, wszystkie elementy zestawu są kopiowane jako osobne pozycje do event_equipment
    - Jeśli false, tylko zestaw jest kopiowany jako jeden item
  
  2. Notatki
    - Domyślnie false - zestawy nie są rozwijane
    - To zapobiega duplikatom podczas tworzenia eventu z oferty
*/

ALTER TABLE offer_product_equipment
ADD COLUMN IF NOT EXISTS expand_kit_in_checklist boolean DEFAULT false;

COMMENT ON COLUMN offer_product_equipment.expand_kit_in_checklist IS 'True = rozwiń zestaw podczas kopiowania do eventu (dodaj wszystkie elementy), False = kopiuj tylko zestaw';
