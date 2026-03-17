/*
  # Dodanie systemu wynajmu zewnętrznego sprzętu

  1. Zmiany w event_equipment
    - Dodanie kolumny use_external_rental (boolean)
    - Integracja z zakładką Podwykonawcy

  2. Rozszerzenie subcontractor_tasks
    - Dodanie powiązania z event_equipment
    - Śledzenie wynajętego sprzętu

  3. Nowy widok equipment_rentals
    - Widok łączący event_equipment z subcontractor_tasks
    - Pokazuje sprzęt wynajmowany zewnętrznie
*/

-- Dodaj kolumnę use_external_rental do event_equipment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_equipment' AND column_name = 'use_external_rental'
  ) THEN
    ALTER TABLE event_equipment ADD COLUMN use_external_rental boolean DEFAULT false;
  END IF;
END $$;

-- Indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_event_equipment_external_rental
  ON event_equipment(event_id, use_external_rental)
  WHERE use_external_rental = true;

COMMENT ON COLUMN event_equipment.use_external_rental IS 'Czy sprzęt jest wynajmowany z zewnętrznego źródła (podwykonawca)';

-- Dodaj powiązanie do event_equipment w subcontractor_tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_tasks' AND column_name = 'event_equipment_id'
  ) THEN
    ALTER TABLE subcontractor_tasks 
      ADD COLUMN event_equipment_id uuid REFERENCES event_equipment(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Dodaj typ zadania
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_tasks' AND column_name = 'task_type'
  ) THEN
    ALTER TABLE subcontractor_tasks 
      ADD COLUMN task_type text DEFAULT 'service' CHECK (task_type IN ('service', 'equipment_rental', 'other'));
  END IF;
END $$;

-- Indeks dla powiązań sprzętu
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_equipment
  ON subcontractor_tasks(event_equipment_id)
  WHERE event_equipment_id IS NOT NULL;

COMMENT ON COLUMN subcontractor_tasks.event_equipment_id IS 'Powiązanie z wypożyczanym sprzętem z event_equipment';
COMMENT ON COLUMN subcontractor_tasks.task_type IS 'Typ zadania: service (usługa), equipment_rental (wynajem sprzętu), other (inne)';

-- Widok łączący wynajem sprzętu z zadaniami podwykonawców
CREATE OR REPLACE VIEW equipment_external_rentals AS
SELECT 
  ee.id as equipment_id,
  ee.event_id,
  ee.equipment_id as item_id,
  ee.kit_id,
  ee.cable_id,
  ee.quantity,
  ee.status as equipment_status,
  ee.notes as equipment_notes,
  st.id as task_id,
  st.subcontractor_id,
  st.task_name,
  st.description,
  st.fixed_price,
  st.total_cost,
  st.status as task_status,
  st.payment_status,
  s.company_name as subcontractor_name,
  COALESCE(ei.name, ek.name, c.name) as equipment_name,
  COALESCE(ei.thumbnail_url, ek.thumbnail_url) as equipment_thumbnail
FROM event_equipment ee
LEFT JOIN subcontractor_tasks st ON st.event_equipment_id = ee.id
LEFT JOIN subcontractors s ON s.id = st.subcontractor_id
LEFT JOIN equipment_items ei ON ei.id = ee.equipment_id
LEFT JOIN equipment_kits ek ON ek.id = ee.kit_id
LEFT JOIN cables c ON c.id = ee.cable_id
WHERE ee.use_external_rental = true;

COMMENT ON VIEW equipment_external_rentals IS 'Widok pokazujący sprzęt wynajmowany z zewnętrznych źródeł wraz z danymi podwykonawców';
