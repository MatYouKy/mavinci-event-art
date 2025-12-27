/*
  # Dodaj system śledzenia aktywności pracowników

  1. Zmiany
    - Dodaj kolumnę `last_active_at` do tabeli `employees`
    - Ustaw domyślną wartość na now()
    - Dodaj indeks dla szybszego zapytania o aktywnych użytkowników

  2. Cel
    - Umożliwić śledzenie ostatniej aktywności pracownika
    - Pokazywać status online w czasie rzeczywistym
    - Wyświetlać wskaźnik aktywności:
      * Zielony = aktywny teraz (ostatnia aktywność < 1 minuta)
      * Żółty = nieaktywny 10 minut (ostatnia aktywność 1-30 minut)
      * Brak = nieaktywny > 30 minut
*/

-- Dodaj kolumnę do śledzenia ostatniej aktywności
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();

COMMENT ON COLUMN employees.last_active_at IS 
  'Timestamp ostatniej aktywności pracownika w systemie, aktualizowany przez heartbeat';

-- Dodaj indeks dla szybszego filtrowania aktywnych użytkowników
CREATE INDEX IF NOT EXISTS idx_employees_last_active 
  ON employees(last_active_at DESC);

COMMENT ON INDEX idx_employees_last_active IS
  'Indeks dla szybkiego zapytania o ostatnio aktywnych pracowników';

-- Funkcja pomocnicza do sprawdzania statusu aktywności
CREATE OR REPLACE FUNCTION get_employee_activity_status(p_last_active_at timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  minutes_inactive integer;
BEGIN
  IF p_last_active_at IS NULL THEN
    RETURN 'offline';
  END IF;
  
  minutes_inactive := EXTRACT(EPOCH FROM (now() - p_last_active_at)) / 60;
  
  IF minutes_inactive < 1 THEN
    RETURN 'online';
  ELSIF minutes_inactive < 30 THEN
    RETURN 'away';
  ELSE
    RETURN 'offline';
  END IF;
END;
$$;

COMMENT ON FUNCTION get_employee_activity_status IS
  'Zwraca status aktywności: online (<1min), away (1-30min), offline (>30min)';
