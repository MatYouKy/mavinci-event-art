/*
  # Naprawa funkcji preferencji powiadomień - używaj employees.id zamiast user_id

  1. Problem
    - Poprzednie funkcje używały `user_id` która nie istnieje w tabeli employees
    - Tabela employees używa `id` jako klucza głównego

  2. Rozwiązanie
    - Usuń stare funkcje
    - Stwórz nowe funkcje z prawidłową nazwą parametru i kolumną
*/

-- Usuń stare funkcje
DROP FUNCTION IF EXISTS get_employee_notification_preferences(UUID);
DROP FUNCTION IF EXISTS should_notify_employee(UUID, TEXT);

-- Zaktualizowana funkcja do pobierania preferencji powiadomień pracownika
CREATE OR REPLACE FUNCTION get_employee_notification_preferences(employee_id UUID)
RETURNS JSONB AS $$
DECLARE
  emp_preferences JSONB;
  result JSONB;
BEGIN
  -- Pobierz preferencje pracownika używając id, nie user_id
  SELECT preferences INTO emp_preferences
  FROM employees
  WHERE id = employee_id;

  -- Jeśli nie ma preferences lub brak klucza notifications, użyj domyślnych
  IF emp_preferences IS NULL OR emp_preferences->'notifications' IS NULL THEN
    result := get_default_notification_preferences();
  ELSE
    result := emp_preferences->'notifications';
  END IF;

  -- Uzupełnij brakujące klucze domyślnymi wartościami
  IF result->>'contact_form_messages' IS NULL THEN
    result := result || jsonb_build_object('contact_form_messages', true);
  END IF;

  IF result->>'system_messages' IS NULL THEN
    result := result || jsonb_build_object('system_messages', true);
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Zaktualizowana funkcja do sprawdzania, czy pracownik powinien dostać powiadomienie
CREATE OR REPLACE FUNCTION should_notify_employee(
  employee_id UUID,
  notification_type TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  prefs JSONB;
BEGIN
  prefs := get_employee_notification_preferences(employee_id);

  -- Domyślnie zwracaj true, jeśli klucz nie istnieje
  RETURN COALESCE((prefs->>notification_type)::boolean, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dodaj komentarze
COMMENT ON FUNCTION get_employee_notification_preferences IS 'Pobiera preferencje powiadomień pracownika z wartościami domyślnymi (używa employees.id)';
COMMENT ON FUNCTION should_notify_employee IS 'Sprawdza, czy pracownik powinien dostać powiadomienie danego typu (contact_form_messages, system_messages)';
