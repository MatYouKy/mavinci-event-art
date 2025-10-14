/*
  # Add message assignment system

  1. Changes
    - Add `assigned_to` column to `contact_messages` table
      - References `employees(id)` table
      - Allows tracking who is responsible for handling each contact form message
    - Add `assigned_to` column to `received_emails` table
      - References `employees(id)` table
      - Allows tracking who is responsible for handling each received email
    - Add `assigned_at` timestamps to track when assignment was made
    - Add `assigned_by` to track who made the assignment
    - Add indexes for better query performance

  2. Security
    - RLS policies remain unchanged
    - Only employees with messages_manage permission can assign messages
*/

-- Add assignment columns to contact_messages
ALTER TABLE contact_messages
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Add assignment columns to received_emails
ALTER TABLE received_emails
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_contact_messages_assigned_to ON contact_messages(assigned_to);
CREATE INDEX IF NOT EXISTS idx_received_emails_assigned_to ON received_emails(assigned_to);

-- Add comments
COMMENT ON COLUMN contact_messages.assigned_to IS 'Employee responsible for handling this message';
COMMENT ON COLUMN contact_messages.assigned_at IS 'When the message was assigned';
COMMENT ON COLUMN contact_messages.assigned_by IS 'Who assigned this message';

COMMENT ON COLUMN received_emails.assigned_to IS 'Employee responsible for handling this email';
COMMENT ON COLUMN received_emails.assigned_at IS 'When the email was assigned';
COMMENT ON COLUMN received_emails.assigned_by IS 'Who assigned this email';
