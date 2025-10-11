/*
  # Contact Messages System

  1. New Tables
    - `contact_messages`
      - `id` (uuid, primary key)
      - `name` (text) - sender's name
      - `email` (text) - sender's email
      - `phone` (text, optional) - sender's phone
      - `company` (text, optional) - sender's company
      - `category` (text) - message category (general, team_join, event_inquiry, portfolio, services, etc.)
      - `source_page` (text) - page where form was submitted
      - `subject` (text, optional) - message subject
      - `message` (text) - message content
      - `status` (text) - new, read, replied, archived
      - `priority` (text) - low, normal, high, urgent
      - `assigned_to` (text, optional) - email of assigned user
      - `notes` (text, optional) - internal notes
      - `ip_address` (text, optional) - sender's IP
      - `user_agent` (text, optional) - sender's browser info
      - `read_at` (timestamptz, optional) - when message was first read
      - `replied_at` (timestamptz, optional) - when message was replied to
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `contact_messages` table
    - Add policies for authenticated CRM users to read and update messages
    - Public users can only insert messages (send contact forms)

  3. Indexes
    - Index on status for filtering
    - Index on category for filtering
    - Index on created_at for sorting
*/

-- Create contact_messages table
CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  company text,
  category text NOT NULL DEFAULT 'general',
  source_page text NOT NULL DEFAULT '/',
  subject text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to text,
  notes text,
  ip_address text,
  user_agent text,
  read_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_category ON contact_messages(category);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at DESC);

-- Enable RLS
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert (send contact form)
CREATE POLICY "Anyone can send contact messages"
  ON contact_messages
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Policy: Authenticated users can read all messages
CREATE POLICY "Authenticated users can read contact messages"
  ON contact_messages
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Authenticated users can update messages
CREATE POLICY "Authenticated users can update contact messages"
  ON contact_messages
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can delete messages
CREATE POLICY "Authenticated users can delete contact messages"
  ON contact_messages
  FOR DELETE
  TO authenticated
  USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_contact_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_contact_messages_updated_at_trigger ON contact_messages;
CREATE TRIGGER update_contact_messages_updated_at_trigger
  BEFORE UPDATE ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_messages_updated_at();

-- Add some sample data for testing
INSERT INTO contact_messages (name, email, phone, company, category, source_page, subject, message, status, priority)
VALUES
  ('Jan Kowalski', 'jan.kowalski@example.com', '+48 123 456 789', 'Firma ABC', 'event_inquiry', '/', 'Zapytanie o organizację konferencji', 'Witam, chciałbym zapytać o organizację konferencji dla 200 osób w Warszawie.', 'new', 'high'),
  ('Anna Nowak', 'anna.nowak@example.com', '+48 987 654 321', null, 'team_join', '/zespol', 'Aplikacja na stanowisko Event Managera', 'Dzień dobry, chciałabym dołączyć do Waszego zespołu. Mam 5 lat doświadczenia w branży eventowej.', 'new', 'normal'),
  ('Piotr Wiśniewski', 'piotr.wisniewski@example.com', null, 'Tech Solutions', 'general', '/#kontakt', 'Pytanie o ofertę', 'Witam, proszę o kontakt w sprawie Waszej oferty.', 'read', 'normal');
