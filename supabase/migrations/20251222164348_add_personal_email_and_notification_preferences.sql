/*
  # Dodanie emaila prywatnego i preferencji powiadomień dla pracowników

  1. Nowe kolumny
    - `personal_email` (text, nullable) - email prywatny pracownika
    - `notification_email_preference` (text) - na jaki email wysyłać powiadomienia
      * 'work' - na email służbowy (domyślny z auth.users.email)
      * 'personal' - na email prywatny
      * 'both' - na oba emaile
      * 'none' - nie wysyłaj emaili (tylko powiadomienia w systemie)

  2. Domyślne wartości
    - `notification_email_preference` domyślnie 'work'

  3. Bezpieczeństwo
    - Pracownicy mogą odczytać swoje dane
    - Tylko admin może edytować te ustawienia
*/

-- Dodaj kolumnę personal_email
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS personal_email text DEFAULT NULL;

-- Dodaj kolumnę notification_email_preference
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS notification_email_preference text DEFAULT 'work';

-- Dodaj constraint aby wartość była z dozwolonego zakresu
ALTER TABLE employees
DROP CONSTRAINT IF EXISTS employees_notification_email_preference_check;

ALTER TABLE employees
ADD CONSTRAINT employees_notification_email_preference_check
CHECK (notification_email_preference IN ('work', 'personal', 'both', 'none'));

-- Dodaj komentarze do kolumn
COMMENT ON COLUMN employees.personal_email IS 'Email prywatny pracownika (opcjonalny)';
COMMENT ON COLUMN employees.notification_email_preference IS 'Preferencja na który email wysyłać powiadomienia: work (służbowy), personal (prywatny), both (oba), none (brak emaili)';

-- Walidacja: jeśli preference = 'personal' lub 'both', personal_email nie może być NULL
CREATE OR REPLACE FUNCTION validate_notification_email_preference()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.notification_email_preference IN ('personal', 'both') AND NEW.personal_email IS NULL) THEN
    RAISE EXCEPTION 'Personal email is required when notification preference is set to personal or both';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_notification_email_preference_trigger ON employees;

CREATE TRIGGER validate_notification_email_preference_trigger
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION validate_notification_email_preference();