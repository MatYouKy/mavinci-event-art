/*
  # Fix event_equipment rental foreign key
  
  1. Problem
    - rental_equipment_id wskazuje na nieistniejącą tabelę subcontractor_equipment_catalog
    - Powinna wskazywać na subcontractor_rental_equipment
  
  2. Rozwiązanie
    - Usuń stary foreign key
    - Dodaj nowy wskazujący na subcontractor_rental_equipment
*/

-- Usuń stary constraint (jeśli istnieje)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name LIKE '%rental_equipment_id%'
    AND table_name = 'event_equipment'
  ) THEN
    ALTER TABLE event_equipment 
    DROP CONSTRAINT IF EXISTS event_equipment_rental_equipment_id_fkey;
  END IF;
END $$;

-- Dodaj nowy foreign key wskazujący na subcontractor_rental_equipment
ALTER TABLE event_equipment
  DROP CONSTRAINT IF EXISTS event_equipment_rental_equipment_id_fkey,
  ADD CONSTRAINT event_equipment_rental_equipment_id_fkey
    FOREIGN KEY (rental_equipment_id)
    REFERENCES subcontractor_rental_equipment(id)
    ON DELETE SET NULL;

-- Aktualizuj komentarz
COMMENT ON COLUMN event_equipment.rental_equipment_id IS 'ID sprzętu z katalogu wynajmu podwykonawcy (subcontractor_rental_equipment)';
