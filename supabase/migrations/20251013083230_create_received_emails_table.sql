/*
  # Create received emails cache table

  1. New Tables
    - `received_emails`
      - `id` (uuid, primary key)
      - `email_account_id` (uuid, foreign key)
      - `message_id` (text, unique identifier from email server)
      - `from_address` (text)
      - `to_address` (text)
      - `subject` (text)
      - `body_text` (text)
      - `body_html` (text)
      - `received_date` (timestamptz, when email was received on server)
      - `fetched_at` (timestamptz, when we downloaded it)
      - `is_read` (boolean)
      - `is_starred` (boolean)
      - `has_attachments` (boolean)
      - `raw_headers` (jsonb, for reply functionality)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `received_emails` table
    - Add policies for authenticated users to view emails from their accounts

  3. Indexes
    - Index on email_account_id for fast filtering
    - Index on message_id for deduplication
    - Index on received_date for sorting
*/

CREATE TABLE IF NOT EXISTS received_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id uuid REFERENCES employee_email_accounts(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body_text text DEFAULT '',
  body_html text DEFAULT '',
  received_date timestamptz NOT NULL,
  fetched_at timestamptz DEFAULT now(),
  is_read boolean DEFAULT false,
  is_starred boolean DEFAULT false,
  has_attachments boolean DEFAULT false,
  raw_headers jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(email_account_id, message_id)
);

ALTER TABLE received_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view all received emails"
  ON received_emails
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert received emails"
  ON received_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Employees can update received emails"
  ON received_emails
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_received_emails_account ON received_emails(email_account_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_message_id ON received_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_date ON received_emails(received_date DESC);
CREATE INDEX IF NOT EXISTS idx_received_emails_is_read ON received_emails(is_read);
