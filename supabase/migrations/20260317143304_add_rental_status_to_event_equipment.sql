/*
  # Dodanie statusu 'rental' do event_equipment

  1. Rozszerzenie check constraint
    - Dodanie wartości 'rental' do dozwolonych statusów
    - Status 'rental' oznacza sprzęt wynajmowany od podwykonawcy

  2. Uwagi
    - Status 'rental' jest używany gdy use_external_rental = true
    - Pozwala odróżnić sprzęt własny od wynajmowanego
*/

-- Usuń stary constraint
ALTER TABLE event_equipment DROP CONSTRAINT IF EXISTS event_equipment_status_check;

-- Dodaj nowy constraint z wartością 'rental'
ALTER TABLE event_equipment 
  ADD CONSTRAINT event_equipment_status_check 
  CHECK (status IN ('draft', 'reserved', 'in_use', 'returned', 'cancelled', 'rental'));

COMMENT ON CONSTRAINT event_equipment_status_check ON event_equipment IS 
  'Dozwolone statusy: draft, reserved, in_use, returned, cancelled, rental (sprzęt wynajmowany od podwykonawcy)';