/*
  # Dodaj flagę konta systemowego do email accounts
  
  1. Zmiany
    - Dodaj kolumnę `is_system_account` do tabeli `employee_email_accounts`
    - Ustaw domyślne konto jako systemowe
  
  2. Uwagi
    - Tylko jedno konto może być systemowe
    - Konto systemowe służy do wysyłania automatycznych maili (zaproszenia, notyfikacje)
*/

-- Dodaj kolumnę is_system_account
ALTER TABLE employee_email_accounts
ADD COLUMN IF NOT EXISTS is_system_account boolean DEFAULT false;

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN employee_email_accounts.is_system_account IS 
'Określa czy to konto jest używane do automatycznych maili systemowych (zaproszenia, notyfikacje)';

-- Ustaw pierwsze aktywne konto z is_default jako systemowe
UPDATE employee_email_accounts
SET is_system_account = true
WHERE id = (
  SELECT id 
  FROM employee_email_accounts 
  WHERE is_default = true AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1
);

-- Jeśli nie ma domyślnego, ustaw pierwsze aktywne
UPDATE employee_email_accounts
SET is_system_account = true
WHERE is_system_account IS NULL
  AND id = (
    SELECT id 
    FROM employee_email_accounts 
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM employee_email_accounts WHERE is_system_account = true
  );
