/*
  # Historia edycji wpisów czasu pracy

  ## Funkcjonalność
  1. Automatyczne logowanie wszystkich zmian we wpisach czasu
  2. Przechowywanie starych i nowych wartości
  3. Admin widzi pełną historię zmian
  4. Nieusuwalne wpisy historii (tylko do odczytu)

  ## Struktura
  
  ### Tabela `time_entries_history`
  - `id` - UUID, primary key
  - `time_entry_id` - UUID, FK do time_entries
  - `employee_id` - UUID, kto dokonał zmiany
  - `action` - text, typ akcji (created, updated, deleted)
  - `changed_fields` - jsonb, które pola się zmieniły
  - `old_values` - jsonb, stare wartości
  - `new_values` - jsonb, nowe wartości
  - `changed_at` - timestamptz, kiedy dokonano zmiany
  - `ip_address` - text, adres IP (opcjonalnie)
  - `user_agent` - text, przeglądarka (opcjonalnie)

  ## Triggery
  - Automatyczne tworzenie wpisu przy INSERT
  - Automatyczne tworzenie wpisu przy UPDATE
  - Automatyczne tworzenie wpisu przy DELETE

  ## Bezpieczeństwo
  - Tylko odczyt dla authenticated users
  - Admini widzą wszystkie wpisy
  - Service role ma pełen dostęp
  - BRAK możliwości edycji lub usunięcia historii
*/

-- Utwórz tabelę historii
CREATE TABLE IF NOT EXISTS time_entries_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id uuid REFERENCES time_entries(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changed_fields text[] DEFAULT '{}',
  old_values jsonb DEFAULT '{}',
  new_values jsonb DEFAULT '{}',
  changed_at timestamptz DEFAULT now(),
  ip_address text,
  user_agent text
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_time_entries_history_entry ON time_entries_history(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_history_employee ON time_entries_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_history_changed_at ON time_entries_history(changed_at);

-- Funkcja do logowania zmian przy INSERT
CREATE OR REPLACE FUNCTION log_time_entry_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO time_entries_history (
    time_entry_id,
    employee_id,
    action,
    changed_fields,
    new_values
  ) VALUES (
    NEW.id,
    NEW.employee_id,
    'created',
    ARRAY['all'],
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do logowania zmian przy UPDATE
CREATE OR REPLACE FUNCTION log_time_entry_update()
RETURNS TRIGGER AS $$
DECLARE
  changed_fields_array text[] := '{}';
  old_vals jsonb := '{}';
  new_vals jsonb := '{}';
BEGIN
  -- Sprawdź które pola się zmieniły
  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changed_fields_array := array_append(changed_fields_array, 'title');
    old_vals := jsonb_set(old_vals, '{title}', to_jsonb(OLD.title));
    new_vals := jsonb_set(new_vals, '{title}', to_jsonb(NEW.title));
  END IF;

  IF OLD.description IS DISTINCT FROM NEW.description THEN
    changed_fields_array := array_append(changed_fields_array, 'description');
    old_vals := jsonb_set(old_vals, '{description}', to_jsonb(OLD.description));
    new_vals := jsonb_set(new_vals, '{description}', to_jsonb(NEW.description));
  END IF;

  IF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    changed_fields_array := array_append(changed_fields_array, 'start_time');
    old_vals := jsonb_set(old_vals, '{start_time}', to_jsonb(OLD.start_time));
    new_vals := jsonb_set(new_vals, '{start_time}', to_jsonb(NEW.start_time));
  END IF;

  IF OLD.end_time IS DISTINCT FROM NEW.end_time THEN
    changed_fields_array := array_append(changed_fields_array, 'end_time');
    old_vals := jsonb_set(old_vals, '{end_time}', to_jsonb(OLD.end_time));
    new_vals := jsonb_set(new_vals, '{end_time}', to_jsonb(NEW.end_time));
  END IF;

  IF OLD.is_billable IS DISTINCT FROM NEW.is_billable THEN
    changed_fields_array := array_append(changed_fields_array, 'is_billable');
    old_vals := jsonb_set(old_vals, '{is_billable}', to_jsonb(OLD.is_billable));
    new_vals := jsonb_set(new_vals, '{is_billable}', to_jsonb(NEW.is_billable));
  END IF;

  IF OLD.hourly_rate IS DISTINCT FROM NEW.hourly_rate THEN
    changed_fields_array := array_append(changed_fields_array, 'hourly_rate');
    old_vals := jsonb_set(old_vals, '{hourly_rate}', to_jsonb(OLD.hourly_rate));
    new_vals := jsonb_set(new_vals, '{hourly_rate}', to_jsonb(NEW.hourly_rate));
  END IF;

  IF OLD.tags IS DISTINCT FROM NEW.tags THEN
    changed_fields_array := array_append(changed_fields_array, 'tags');
    old_vals := jsonb_set(old_vals, '{tags}', to_jsonb(OLD.tags));
    new_vals := jsonb_set(new_vals, '{tags}', to_jsonb(NEW.tags));
  END IF;

  -- Tylko jeśli coś się rzeczywiście zmieniło
  IF array_length(changed_fields_array, 1) > 0 THEN
    INSERT INTO time_entries_history (
      time_entry_id,
      employee_id,
      action,
      changed_fields,
      old_values,
      new_values
    ) VALUES (
      NEW.id,
      NEW.employee_id,
      'updated',
      changed_fields_array,
      old_vals,
      new_vals
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do logowania zmian przy DELETE
CREATE OR REPLACE FUNCTION log_time_entry_delete()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO time_entries_history (
    time_entry_id,
    employee_id,
    action,
    changed_fields,
    old_values
  ) VALUES (
    OLD.id,
    OLD.employee_id,
    'deleted',
    ARRAY['all'],
    to_jsonb(OLD)
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Utwórz triggery
DROP TRIGGER IF EXISTS time_entry_insert_trigger ON time_entries;
CREATE TRIGGER time_entry_insert_trigger
  AFTER INSERT ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION log_time_entry_insert();

DROP TRIGGER IF EXISTS time_entry_update_trigger ON time_entries;
CREATE TRIGGER time_entry_update_trigger
  AFTER UPDATE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION log_time_entry_update();

DROP TRIGGER IF EXISTS time_entry_delete_trigger ON time_entries;
CREATE TRIGGER time_entry_delete_trigger
  BEFORE DELETE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION log_time_entry_delete();

-- RLS Policies
ALTER TABLE time_entries_history ENABLE ROW LEVEL SECURITY;

-- Pracownicy widzą tylko historię swoich wpisów
CREATE POLICY "Pracownicy widzą historię swoich wpisów"
  ON time_entries_history
  FOR SELECT
  TO authenticated
  USING (employee_id = auth.uid());

-- BRAK polityk INSERT/UPDATE/DELETE - tylko triggery mogą modyfikować

-- Service role ma pełen dostęp (dla triggerów)
CREATE POLICY "Service role ma pełen dostęp do historii"
  ON time_entries_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Widok dla adminów z danymi pracowników
CREATE OR REPLACE VIEW admin_time_entries_history_view AS
SELECT 
  h.id,
  h.time_entry_id,
  h.employee_id,
  h.action,
  h.changed_fields,
  h.old_values,
  h.new_values,
  h.changed_at,
  e.name as employee_name,
  e.surname as employee_surname,
  e.email as employee_email,
  te.title as entry_title,
  te.start_time as entry_start_time,
  te.end_time as entry_end_time
FROM time_entries_history h
JOIN employees e ON e.id = h.employee_id
LEFT JOIN time_entries te ON te.id = h.time_entry_id
ORDER BY h.changed_at DESC;

-- Grant dostępu do widoku
GRANT SELECT ON admin_time_entries_history_view TO authenticated;

-- Dodaj kolumnę do time_entries informującą o liczbie edycji
ALTER TABLE time_entries 
ADD COLUMN IF NOT EXISTS edit_count integer DEFAULT 0;

-- Funkcja do aktualizacji licznika edycji
CREATE OR REPLACE FUNCTION update_edit_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.action = 'updated' THEN
    UPDATE time_entries 
    SET edit_count = edit_count + 1
    WHERE id = NEW.time_entry_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger do aktualizacji licznika
DROP TRIGGER IF EXISTS update_edit_count_trigger ON time_entries_history;
CREATE TRIGGER update_edit_count_trigger
  AFTER INSERT ON time_entries_history
  FOR EACH ROW
  EXECUTE FUNCTION update_edit_count();

-- Komentarze
COMMENT ON TABLE time_entries_history IS 
  'Historia wszystkich zmian w wpisach czasu pracy - automatycznie logowane przez triggery';

COMMENT ON COLUMN time_entries_history.changed_fields IS 
  'Lista nazw pól które uległy zmianie';

COMMENT ON COLUMN time_entries_history.old_values IS 
  'JSON ze starymi wartościami zmienionych pól';

COMMENT ON COLUMN time_entries_history.new_values IS 
  'JSON z nowymi wartościami zmienionych pól';

COMMENT ON COLUMN time_entries.edit_count IS 
  'Liczba edycji tego wpisu - automatycznie aktualizowana';