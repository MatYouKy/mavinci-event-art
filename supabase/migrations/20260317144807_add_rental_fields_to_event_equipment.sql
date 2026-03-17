/*
  # Dodanie pól rentalu do event_equipment

  1. Nowe kolumny
    - rental_subcontractor_id: ID podwykonawcy od którego wynajmujemy
    - rental_equipment_id: ID sprzętu z katalogu podwykonawcy

  2. Foreign keys
    - Powiązanie z subcontractors
    - Powiązanie z subcontractor_equipment_catalog

  3. Uwagi
    - Gdy use_external_rental = true, te pola będą wypełnione
    - Pozwala śledzić konkretny sprzęt od konkretnego podwykonawcy
*/

-- Dodaj kolumny dla informacji o rentalu
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_equipment' AND column_name = 'rental_subcontractor_id'
  ) THEN
    ALTER TABLE event_equipment ADD COLUMN rental_subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_equipment' AND column_name = 'rental_equipment_id'
  ) THEN
    ALTER TABLE event_equipment ADD COLUMN rental_equipment_id uuid REFERENCES subcontractor_equipment_catalog(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indeksy dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_event_equipment_rental_subcontractor 
  ON event_equipment(rental_subcontractor_id) 
  WHERE rental_subcontractor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_equipment_rental_equipment 
  ON event_equipment(rental_equipment_id) 
  WHERE rental_equipment_id IS NOT NULL;

COMMENT ON COLUMN event_equipment.rental_subcontractor_id IS 'ID podwykonawcy od którego wynajmujemy sprzęt';
COMMENT ON COLUMN event_equipment.rental_equipment_id IS 'ID sprzętu z katalogu podwykonawcy (subcontractor_equipment_catalog)';