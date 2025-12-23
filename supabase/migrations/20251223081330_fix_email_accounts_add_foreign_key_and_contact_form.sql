/*
  # Fix Email Accounts - Add Foreign Key and Contact Form Access

  1. Changes
    - Add foreign key between employee_email_accounts.employee_id and employees.id
    - Add can_receive_contact_forms to assignments table
    - Fix admin access - admins also need assignments (no automatic access)

  2. Security
    - All users (including admin) must have explicit assignments
    - Admin with messages_manage can still manage everything
*/

-- Add foreign key if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_email_accounts_employee_id_fkey'
  ) THEN
    ALTER TABLE employee_email_accounts
    ADD CONSTRAINT employee_email_accounts_employee_id_fkey
    FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- Add contact form access to assignments
ALTER TABLE employee_email_account_assignments
ADD COLUMN IF NOT EXISTS can_receive_contact_forms boolean DEFAULT false;

-- Add description to assignment
ALTER TABLE employee_email_account_assignments
ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN employee_email_account_assignments.can_receive_contact_forms IS 'Czy pracownik otrzymuje powiadomienia z formularza kontaktowego na to konto';