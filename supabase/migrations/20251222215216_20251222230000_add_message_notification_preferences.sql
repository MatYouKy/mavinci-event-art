/*
  # Dodanie preferencji powiadomień o wiadomościach

  1. Rozszerzenie
    - Pracownicy mogą wyłączyć powiadomienia o wiadomościach z formularza kontaktowego
    - Pracownicy mogą wyłączyć powiadomienia systemowe
    - Używamy istniejącej kolumny `preferences` (JSONB)

  2. Struktura preferences.notifications:
    {
      "notifications": {
        "contact_form_messages": true,  // Powiadomienia z formularza kontaktowego
        "system_messages": true          // Powiadomienia systemowe
      }
    }

  3. Domyślne wartości
    - Wszystkie powiadomienia domyślnie włączone (true)
    - NULL w preferences oznacza użycie domyślnych wartości

  4. Bezpieczeństwo
    - Tylko admin może zmieniać te preferencje dla innych pracowników
    - Pracownik może zmieniać swoje własne preferencje
*/

-- Funkcja pomocnicza do ustawiania domyślnych preferencji powiadomień
CREATE OR REPLACE FUNCTION get_default_notification_preferences()
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'contact_form_messages', true,
    'system_messages', true
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Funkcja do pobierania preferencji powiadomień pracownika (z domyślnymi wartościami)
CREATE OR REPLACE FUNCTION get_employee_notification_preferences(employee_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  emp_preferences JSONB;
  result JSONB;
BEGIN
  -- Pobierz preferencje pracownika
  SELECT preferences INTO emp_preferences
  FROM employees
  WHERE user_id = employee_user_id;

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

-- Funkcja do sprawdzania, czy pracownik powinien dostać powiadomienie danego typu
CREATE OR REPLACE FUNCTION should_notify_employee(
  employee_user_id UUID,
  notification_type TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  prefs JSONB;
BEGIN
  prefs := get_employee_notification_preferences(employee_user_id);

  -- Domyślnie zwracaj true, jeśli klucz nie istnieje
  RETURN COALESCE((prefs->>notification_type)::boolean, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dodaj komentarz
COMMENT ON FUNCTION get_employee_notification_preferences IS 'Pobiera preferencje powiadomień pracownika z wartościami domyślnymi';
COMMENT ON FUNCTION should_notify_employee IS 'Sprawdza, czy pracownik powinien dostać powiadomienie danego typu (contact_form_messages, system_messages)';
