/*
  # Remove Admin Automatic Access to All Emails

  1. Changes
    - Admin no longer automatically sees all emails in /crm/messages
    - Admin must have explicit assignments like everyone else
    - Admin with messages_manage can still manage accounts in /crm/settings

  2. Security
    - All users (including admin) see only emails from assigned accounts
    - /crm/messages shows only emails from explicitly assigned accounts
*/

-- Update received_emails policy - remove admin automatic access
DROP POLICY IF EXISTS "Users can view received emails from accessible accounts" ON received_emails;

CREATE POLICY "Users can view received emails from assigned accounts"
  ON received_emails
  FOR SELECT
  TO authenticated
  USING (
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
  );

-- Update sent_emails policy - remove admin automatic access
DROP POLICY IF EXISTS "Users can view sent emails from accessible accounts" ON sent_emails;

CREATE POLICY "Users can view sent emails from assigned accounts"
  ON sent_emails
  FOR SELECT
  TO authenticated
  USING (
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
  );

COMMENT ON POLICY "Users can view received emails from assigned accounts" ON received_emails IS 'Wszyscy użytkownicy (także admin) widzą tylko emaile z przypisanych kont';
COMMENT ON POLICY "Users can view sent emails from assigned accounts" ON sent_emails IS 'Wszyscy użytkownicy (także admin) widzą tylko emaile z przypisanych kont';