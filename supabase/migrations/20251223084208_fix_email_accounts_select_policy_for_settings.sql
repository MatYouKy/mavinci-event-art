/*
  # Fix Email Accounts Select Policy for Settings Page

  1. Changes
    - Admin with messages_manage can see ALL accounts (including inactive)
    - Regular users see only active accounts (personal or assigned)

  2. Security
    - /crm/settings/email-accounts - admin sees all accounts to manage them
    - /crm/messages - users see only their active accounts
*/

DROP POLICY IF EXISTS "Select email accounts" ON employee_email_accounts;

CREATE POLICY "Select email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    -- Admin with messages_manage sees ALL accounts (including inactive)
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
    OR
    -- Regular users see only active accounts
    (
      is_active = true
      AND (
        -- Personal account owned by user
        (account_type = 'personal' AND employee_id = auth.uid())
        OR
        -- Shared or system account assigned to user
        ((account_type = 'shared' OR account_type = 'system') AND EXISTS (
          SELECT 1 FROM employee_email_account_assignments
          WHERE email_account_id = employee_email_accounts.id
          AND employee_id = auth.uid()
        ))
      )
    )
  );

COMMENT ON POLICY "Select email accounts" ON employee_email_accounts IS 'Admin widzi wszystkie konta (także nieaktywne), zwykli użytkownicy tylko aktywne przypisane';