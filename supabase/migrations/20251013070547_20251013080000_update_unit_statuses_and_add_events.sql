/*
  # Aktualizacja Statusów Jednostek i Historia Zdarzeń

  ## Zmiany

  1. Zmiana statusów jednostek na:
     - available (Dostępny)
     - damaged (Uszkodzony)
     - in_service (Serwis)
     - retired (Wycofany)

  2. Nowa tabela `equipment_unit_events` - historia zdarzeń dla każdej jednostki:
     - Rejestracja uszkodzeń
     - Serwisy
     - Naprawy
     - Zmiany statusu
     - Notatki z możliwością zdjęć

  ## Notatki
  - Rezerwacje i użycie będzie zarządzane przez wydarzenia/oferty
  - Stan magazynowy aktualizuje się automatycznie na podstawie jednostek
*/

-- Najpierw usuń stary constraint
ALTER TABLE equipment_units DROP CONSTRAINT IF EXISTS equipment_units_status_check;

-- Dodaj nowy constraint z poprawnymi statusami
ALTER TABLE equipment_units
ADD CONSTRAINT equipment_units_status_check
CHECK (status IN ('available', 'damaged', 'in_service', 'retired'));

-- Zaktualizuj istniejące statusy
UPDATE equipment_units SET status = 'available' WHERE status = 'in_use';
UPDATE equipment_units SET status = 'available' WHERE status = 'reserved';

-- Tabela historii zdarzeń dla jednostek
CREATE TABLE IF NOT EXISTS equipment_unit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES equipment_units(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('damage', 'repair', 'service', 'status_change', 'note', 'inspection')),
  description text NOT NULL,
  image_url text,
  old_status text,
  new_status text,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_unit_events_unit_id ON equipment_unit_events(unit_id);
CREATE INDEX IF NOT EXISTS idx_equipment_unit_events_type ON equipment_unit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_equipment_unit_events_created ON equipment_unit_events(created_at DESC);

ALTER TABLE equipment_unit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read equipment unit events"
  ON equipment_unit_events
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert equipment unit events"
  ON equipment_unit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update equipment unit events"
  ON equipment_unit_events
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete equipment unit events"
  ON equipment_unit_events
  FOR DELETE
  TO authenticated
  USING (true);

-- Funkcja do automatycznego tworzenia zdarzenia przy zmianie statusu jednostki
CREATE OR REPLACE FUNCTION track_unit_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO equipment_unit_events (
      unit_id,
      event_type,
      description,
      old_status,
      new_status
    ) VALUES (
      NEW.id,
      'status_change',
      'Status zmieniony z ' || OLD.status || ' na ' || NEW.status,
      OLD.status,
      NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_equipment_unit_status_changes
  AFTER UPDATE OF status ON equipment_units
  FOR EACH ROW
  EXECUTE FUNCTION track_unit_status_change();

COMMENT ON TABLE equipment_unit_events IS 'Historia zdarzeń dla każdej jednostki sprzętu - uszkodzenia, naprawy, serwisy, inspekcje';
COMMENT ON COLUMN equipment_unit_events.event_type IS 'Typ zdarzenia: damage (uszkodzenie), repair (naprawa), service (serwis), status_change (zmiana statusu), note (notatka), inspection (inspekcja)';
COMMENT ON COLUMN equipment_unit_events.image_url IS 'Zdjęcie dokumentujące zdarzenie (np. uszkodzenie)';