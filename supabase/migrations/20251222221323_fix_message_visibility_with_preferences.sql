/*
  # Fix Message Visibility Based on Employee Preferences

  1. Changes
    - Update RLS policy for contact_messages to respect preferences.notifications.contact_form_messages
    - Update RLS policy for received_emails to respect preferences.notifications.system_messages for system accounts
    - Employees with disabled preferences will not see those message types

  2. Security
    - Admin with messages_manage still sees everything
    - Users with messages_view see only what they have enabled in preferences
    - System messages respect system_messages preference
    - Contact form messages respect contact_form_messages preference
*/

-- Drop old contact_messages SELECT policy
DROP POLICY IF EXISTS "Authenticated users can read contact messages" ON contact_messages;

-- New policy for contact_messages with preference check
CREATE POLICY "Users can view contact messages based on permissions and preferences"
  ON contact_messages
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
    -- Users with messages_view see only if they have contact_form_messages preference enabled
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
        AND (
          -- Check if preference exists and is true, or if it doesn't exist (default true)
          (preferences->'notifications'->>'contact_form_messages')::boolean IS NOT FALSE
        )
      )
    )
  );

-- Drop old received_emails SELECT policy
DROP POLICY IF EXISTS "Users can view received emails from accessible accounts" ON received_emails;

-- New policy for received_emails with system account preference check
CREATE POLICY "Users can view received emails from accessible accounts with preferences"
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
    -- Users with messages_view see emails from their accessible accounts
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
          -- Shared account assigned to user
          (eea.account_type = 'shared' AND EXISTS (
            SELECT 1 FROM employee_email_account_assignments
            WHERE email_account_id = eea.id
            AND employee_id = auth.uid()
          ))
          OR
          -- System account - check preferences
          (
            eea.account_type = 'system'
            AND EXISTS (
              SELECT 1 FROM employees
              WHERE employees.id = auth.uid()
              AND (
                -- Check if preference exists and is true, or if it doesn't exist (default true)
                (preferences->'notifications'->>'system_messages')::boolean IS NOT FALSE
              )
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view contact messages based on permissions and preferences" ON contact_messages IS
'Users with messages_manage see all. Users with messages_view see only if contact_form_messages preference is enabled.';

COMMENT ON POLICY "Users can view received emails from accessible accounts with preferences" ON received_emails IS
'Users see emails from their personal/shared/system accounts. System accounts respect system_messages preference.';