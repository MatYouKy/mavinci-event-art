/*
  # Dodanie powiązania z subcontractor_rental_equipment

  1. Zmiany
    - Dodanie kolumny `rental_equipment_id` do `subcontractor_tasks`
    - Foreign key do `subcontractor_rental_equipment`
    - Indeks dla wydajności

  2. Cel
    - Umożliwienie śledzenia konkretnego sprzętu wynajmowanego z katalogu podwykonawcy
    - Powiązanie zadania wynajmu z katalogiem sprzętu podwykonawcy
*/

-- Dodaj kolumnę rental_equipment_id do subcontractor_tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_tasks' AND column_name = 'rental_equipment_id'
  ) THEN
    ALTER TABLE subcontractor_tasks
      ADD COLUMN rental_equipment_id uuid REFERENCES subcontractor_rental_equipment(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_rental_equipment
  ON subcontractor_tasks(rental_equipment_id)
  WHERE rental_equipment_id IS NOT NULL;

COMMENT ON COLUMN subcontractor_tasks.rental_equipment_id IS 'Powiązanie z konkretnym sprzętem z katalogu wynajmu podwykonawcy (subcontractor_rental_equipment)';
