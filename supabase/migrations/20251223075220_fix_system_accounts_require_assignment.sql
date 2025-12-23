/*
  # Fix System Accounts - Require Assignment

  1. Changes
    - System accounts are no longer available to everyone automatically
    - System accounts must be assigned by admin just like shared accounts
    - Only difference: system accounts can't have a specific owner (employee_id is null)

  2. Security
    - All account types require explicit assignment
    - No automatic access based on account_type alone
*/

-- Update received_emails RLS policy to require assignment for ALL account types
DROP POLICY IF EXISTS "Users can view received emails from accessible accounts" ON received_emails;

CREATE POLICY "Users can view received emails from accessible accounts"
  ON received_emails
  FOR SELECT
  TO authenticated
  USING (
    -- Admin with messages_manage sees all
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
    OR
    -- Users see emails from their assigned accounts only
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
      AND
      EXISTS (
        SELECT 1 FROM employee_email_accounts eea
        WHERE eea.id = received_emails.email_account_id
        AND eea.is_active = true
        AND (
          -- Personal account owned by user
          (eea.account_type = 'personal' AND eea.employee_id = auth.uid())
          OR
          -- Shared or system account explicitly assigned to user
          ((eea.account_type = 'shared' OR eea.account_type = 'system') AND EXISTS (
            SELECT 1 FROM employee_email_account_assignments
            WHERE email_account_id = eea.id
            AND employee_id = auth.uid()
          ))
        )
      )
    )
  );

-- Ensure sent_emails follows same logic
DROP POLICY IF EXISTS "Users can view sent emails from accessible accounts" ON sent_emails;

CREATE POLICY "Users can view sent emails from accessible accounts"
  ON sent_emails
  FOR SELECT
  TO authenticated
  USING (
    -- Admin with messages_manage sees all
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
    OR
    -- Users see sent emails from their assigned accounts only
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
      AND
      EXISTS (
        SELECT 1 FROM employee_email_accounts eea
        WHERE eea.id = sent_emails.email_account_id
        AND eea.is_active = true
        AND (
          -- Personal account owned by user
          (eea.account_type = 'personal' AND eea.employee_id = auth.uid())
          OR
          -- Shared or system account explicitly assigned to user
          ((eea.account_type = 'shared' OR eea.account_type = 'system') AND EXISTS (
            SELECT 1 FROM employee_email_account_assignments
            WHERE email_account_id = eea.id
            AND employee_id = auth.uid()
          ))
        )
      )
    )
  );