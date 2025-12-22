/*
  # Zezwól na dostęp do konta systemowego dla messages_view
  
  1. Changes
    - Modyfikuje policy dla users with messages_view
    - Pozwala zobaczyć:
      - Własne konta email (employee_id = auth.uid())
      - Konto systemowe (is_system_account = true)
    
  2. Security
    - Użytkownicy z messages_view widzą swoje konta + system
    - Użytkownicy z messages_manage widzą wszystkie konta (bez zmian)
*/

-- Drop old policy
DROP POLICY IF EXISTS "Users with messages_view can view own email accounts" ON employee_email_accounts;

-- Create new policy with system account access
CREATE POLICY "Users with messages_view can view own and system accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    (is_active = true) 
    AND (
      (employee_id = auth.uid()) 
      OR (is_system_account = true)
    )
    AND (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
    )
  );
