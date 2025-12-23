/*
  # Dodaj dostęp do formularza kontaktowego bezpośrednio do employees

  1. Changes
    - Dodaj kolumnę `can_receive_contact_forms` do tabeli `employees`
    - Usuń logikę związaną z `employee_email_account_assignments.can_receive_contact_forms`
    - Zaktualizuj RLS policies aby sprawdzały `employees.can_receive_contact_forms`
    - Migruj istniejące dane z assignments do employees

  2. Security
    - Dostęp do formularza kontaktowego jest niezależny od kont email
    - Tylko admin może zarządzać tym dostępem
*/

-- Dodaj kolumnę do employees
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS can_receive_contact_forms boolean DEFAULT false;

-- Migruj istniejące dane z assignments
UPDATE employees e
SET can_receive_contact_forms = true
WHERE EXISTS (
  SELECT 1 FROM employee_email_account_assignments eaa
  WHERE eaa.employee_id = e.id
  AND eaa.can_receive_contact_forms = true
);

-- Usuń starą policy
DROP POLICY IF EXISTS "Users with contact form access can view messages" ON contact_messages;

-- Dodaj nową policy sprawdzającą employees
CREATE POLICY "Users with contact form access can view messages"
  ON contact_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.can_receive_contact_forms = true
    )
  );

-- Zaktualizuj policy dla UPDATE
DROP POLICY IF EXISTS "Users with contact form access can update messages" ON contact_messages;

CREATE POLICY "Users with contact form access can update messages"
  ON contact_messages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.can_receive_contact_forms = true
    )
  );

COMMENT ON COLUMN employees.can_receive_contact_forms IS 'Czy pracownik ma dostęp do wiadomości z formularza kontaktowego (niezależnie od kont email)';
