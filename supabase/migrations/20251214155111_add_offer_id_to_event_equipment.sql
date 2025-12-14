/*
  # Dodaj offer_id do event_equipment

  1. Zmiany
    - Dodaj kolumnę offer_id do event_equipment
    - Umożliwia powiązanie sprzętu z ofertą która go dodała
    - Ułatwia usuwanie sprzętu przy usunięciu oferty
    
  2. Cel
    - Śledzenie źródła automatycznie dodanego sprzętu
    - Kaskadowe usuwanie sprzętu przy usunięciu oferty
*/

-- Dodaj kolumnę offer_id
ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id) ON DELETE CASCADE;

-- Indeks dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_event_equipment_offer_id
  ON event_equipment(offer_id);

-- Komentarz
COMMENT ON COLUMN event_equipment.offer_id IS 
'ID oferty która automatycznie dodała ten sprzęt (null dla ręcznie dodanego sprzętu)';
