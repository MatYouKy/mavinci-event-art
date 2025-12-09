/*
  # Odtwórz widok historii wpisów czasu dla adminów

  ## Zmiany
  1. Odtworzenie widoku `admin_time_entries_history_view`
  2. Użycie SECURITY INVOKER dla bezpieczeństwa
  3. Join z tabelą employees dla danych pracownika

  ## Bezpieczeństwo
  - Widok używa SECURITY INVOKER (respektuje RLS)
  - Dostęp dla authenticated users
  - RLS na time_entries_history kontroluje dostęp
*/

-- Utwórz widok z informacjami o pracowniku
CREATE OR REPLACE VIEW admin_time_entries_history_view
WITH (security_invoker = true)
AS
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

-- Grant dostępu dla authenticated users
GRANT SELECT ON admin_time_entries_history_view TO authenticated;

COMMENT ON VIEW admin_time_entries_history_view IS
  'Widok historii zmian wpisów czasu z informacjami o pracownikach - respektuje RLS policies';
