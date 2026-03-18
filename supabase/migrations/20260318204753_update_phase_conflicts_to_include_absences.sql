/*
  # Aktualizacja sprawdzania konfliktów faz - dodanie nieobecności

  1. Zmiany
    - Zaktualizuj get_employee_phase_conflicts aby używała check_employee_availability
    - Dodaj sprawdzanie nieobecności (urlopów, zwolnień, etc.)
    - Zachowaj kompatybilność z istniejącym API (te same kolumny zwracane)
    
  2. Powód
    - Aktualna funkcja sprawdza tylko konflikty z innymi fazami
    - Nie sprawdza nieobecności pracownika (urlopy, zwolnienia)
    - Trzeba ostrzec użytkownika o wszystkich konfliktach przed przypisaniem
*/

DROP FUNCTION IF EXISTS get_employee_phase_conflicts(uuid, timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION get_employee_phase_conflicts(
  p_employee_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_exclude_assignment_id uuid DEFAULT NULL
)
RETURNS TABLE (
  conflict_type text,
  conflict_id uuid,
  phase_id uuid,
  event_id uuid,
  event_name text,
  phase_name text,
  assignment_start timestamptz,
  assignment_end timestamptz,
  conflict_status text,
  conflict_details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.conflict_type,
    c.conflict_id,
    CAST(NULL AS uuid) as phase_id,
    CAST(NULL AS uuid) as event_id,
    c.conflict_title as event_name,
    CAST(NULL AS text) as phase_name,
    c.conflict_start as assignment_start,
    c.conflict_end as assignment_end,
    c.conflict_status,
    c.conflict_details
  FROM check_employee_availability(
    p_employee_id,
    p_start_time,
    p_end_time,
    NULL, -- nie wykluczamy żadnego eventu
    (
      SELECT phase_id FROM event_phase_assignments 
      WHERE id = p_exclude_assignment_id
      LIMIT 1
    ) -- wyklucz fazę z exclude_assignment_id
  ) c
  WHERE c.has_conflict = true;
END;
$$;

COMMENT ON FUNCTION get_employee_phase_conflicts IS 
'Sprawdza konflikty pracownika przy przypisaniu do fazy. Zwraca nieobecności, inne wydarzenia i przypisania do innych faz.';