/*
  # System śledzenia czasu pracy (Time Tracking)

  ## Funkcjonalność
  1. Pracownicy logują swój czas pracy
  2. Wpisy mogą być powiązane z zadaniami (tasks) lub mieć własny tytuł
  3. Timer do aktywnego logowania czasu
  4. Admin widzi wszystkich pracowników i może filtrować
  5. Raporty i statystyki

  ## Struktura
  
  ### Tabela `time_entries`
  - `id` - UUID, primary key
  - `employee_id` - UUID, FK do employees (auth.users)
  - `task_id` - UUID, FK do tasks (opcjonalne)
  - `event_id` - UUID, FK do events (opcjonalne, dziedziczone z task)
  - `title` - text, własny tytuł (gdy nie ma task_id)
  - `description` - text, opis wykonanej pracy
  - `start_time` - timestamptz, początek pracy
  - `end_time` - timestamptz, koniec pracy (null = w trakcie)
  - `duration_minutes` - integer, obliczone minuty
  - `is_billable` - boolean, czy płatne dla klienta
  - `hourly_rate` - numeric, stawka godzinowa
  - `tags` - text[], tagi (np. "development", "meeting", "support")
  - `created_at` - timestamptz
  - `updated_at` - timestamptz

  ## Bezpieczeństwo
  - Pracownicy widzą tylko swoje wpisy
  - Admini widzą wszystkie wpisy
  - Service role ma pełen dostęp
*/

-- Utwórz tabelę time_entries
CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  title text,
  description text,
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  duration_minutes integer GENERATED ALWAYS AS (
    CASE 
      WHEN end_time IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60
      ELSE NULL
    END
  ) STORED,
  is_billable boolean DEFAULT true,
  hourly_rate numeric(10, 2),
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraint: musi być task_id LUB title
  CONSTRAINT time_entry_has_task_or_title CHECK (
    task_id IS NOT NULL OR title IS NOT NULL
  ),
  
  -- Constraint: end_time musi być po start_time
  CONSTRAINT valid_time_range CHECK (
    end_time IS NULL OR end_time > start_time
  )
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_event ON time_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_end_time ON time_entries(end_time);

-- Trigger do automatycznej aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_time_entry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_time_entry_updated_at();

-- RLS Policies
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- Pracownicy widzą swoje wpisy
CREATE POLICY "Pracownicy widzą swoje wpisy czasu"
  ON time_entries
  FOR SELECT
  TO authenticated
  USING (employee_id = auth.uid());

-- Pracownicy mogą dodawać swoje wpisy
CREATE POLICY "Pracownicy mogą dodawać swoje wpisy czasu"
  ON time_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = auth.uid());

-- Pracownicy mogą edytować swoje wpisy
CREATE POLICY "Pracownicy mogą edytować swoje wpisy czasu"
  ON time_entries
  FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

-- Pracownicy mogą usuwać swoje wpisy
CREATE POLICY "Pracownicy mogą usuwać swoje wpisy czasu"
  ON time_entries
  FOR DELETE
  TO authenticated
  USING (employee_id = auth.uid());

-- Service role ma pełen dostęp
CREATE POLICY "Service role ma pełen dostęp do time_entries"
  ON time_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Funkcja pomocnicza: pobierz aktywny timer dla pracownika
CREATE OR REPLACE FUNCTION get_active_timer(p_employee_id uuid)
RETURNS TABLE (
  id uuid,
  task_id uuid,
  event_id uuid,
  title text,
  description text,
  start_time timestamptz,
  tags text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    te.id,
    te.task_id,
    te.event_id,
    te.title,
    te.description,
    te.start_time,
    te.tags
  FROM time_entries te
  WHERE te.employee_id = p_employee_id
    AND te.end_time IS NULL
  ORDER BY te.start_time DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja pomocnicza: podsumowanie czasu pracy w okresie
CREATE OR REPLACE FUNCTION get_time_summary(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  total_minutes integer,
  total_hours numeric,
  billable_minutes integer,
  billable_hours numeric,
  entries_count integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(duration_minutes), 0)::integer as total_minutes,
    ROUND(COALESCE(SUM(duration_minutes), 0) / 60.0, 2) as total_hours,
    COALESCE(SUM(CASE WHEN is_billable THEN duration_minutes ELSE 0 END), 0)::integer as billable_minutes,
    ROUND(COALESCE(SUM(CASE WHEN is_billable THEN duration_minutes ELSE 0 END), 0) / 60.0, 2) as billable_hours,
    COUNT(*)::integer as entries_count
  FROM time_entries
  WHERE employee_id = p_employee_id
    AND start_time >= p_start_date
    AND start_time < p_end_date
    AND end_time IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Widok dla adminów: wszystkie wpisy z danymi pracowników
CREATE OR REPLACE VIEW admin_time_entries_view AS
SELECT 
  te.id,
  te.employee_id,
  te.task_id,
  te.event_id,
  te.title,
  te.description,
  te.start_time,
  te.end_time,
  te.duration_minutes,
  te.is_billable,
  te.hourly_rate,
  te.tags,
  te.created_at,
  te.updated_at,
  e.name as employee_name,
  e.surname as employee_surname,
  e.email as employee_email,
  t.title as task_title,
  ev.name as event_name
FROM time_entries te
JOIN employees e ON e.id = te.employee_id
LEFT JOIN tasks t ON t.id = te.task_id
LEFT JOIN events ev ON ev.id = te.event_id;

-- Grant dostępu do widoku dla authenticated users
GRANT SELECT ON admin_time_entries_view TO authenticated;

-- Komentarze
COMMENT ON TABLE time_entries IS 
  'Wpisy czasu pracy pracowników - timetracking z możliwością powiązania z zadaniami lub własnym tytułem';

COMMENT ON COLUMN time_entries.duration_minutes IS 
  'Automatycznie obliczane minuty na podstawie start_time i end_time';

COMMENT ON COLUMN time_entries.end_time IS 
  'NULL = timer aktywny (w trakcie), wartość = timer zakończony';