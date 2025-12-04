/*
  # Dodaj konfigurację systemowej skrzynki email

  1. Nowa tabela
    - `system_email_config` - konfiguracja systemowej skrzynki do wysyłania faktur i ofert
      - `id` (uuid, primary key)
      - `config_key` (text, unique) - klucz konfiguracji (np. 'invoices', 'offers')
      - `from_name` (text) - nazwa nadawcy
      - `from_email` (text) - email nadawcy
      - `smtp_host` (text) - host SMTP
      - `smtp_port` (integer) - port SMTP
      - `smtp_username` (text) - login SMTP
      - `smtp_password` (text) - hasło SMTP (enkrypted)
      - `smtp_use_tls` (boolean) - czy używać TLS
      - `imap_host` (text) - host IMAP
      - `imap_port` (integer) - port IMAP
      - `imap_username` (text) - login IMAP
      - `imap_password` (text) - hasło IMAP
      - `imap_use_ssl` (boolean) - czy używać SSL
      - `signature` (text) - podpis email
      - `is_active` (boolean) - czy aktywna
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Bezpieczeństwo
    - Enable RLS
    - Admin-only access policies
*/

-- Create system email config table
CREATE TABLE IF NOT EXISTS system_email_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text UNIQUE NOT NULL,
  from_name text NOT NULL,
  from_email text NOT NULL,
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_username text,
  smtp_password text,
  smtp_use_tls boolean DEFAULT true,
  imap_host text,
  imap_port integer DEFAULT 993,
  imap_username text,
  imap_password text,
  imap_use_ssl boolean DEFAULT true,
  signature text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE system_email_config ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admins can view system email config"
  ON system_email_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE id = auth.uid() 
      AND 'admin' = ANY(permissions)
    )
  );

CREATE POLICY "Admins can insert system email config"
  ON system_email_config FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE id = auth.uid() 
      AND 'admin' = ANY(permissions)
    )
  );

CREATE POLICY "Admins can update system email config"
  ON system_email_config FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE id = auth.uid() 
      AND 'admin' = ANY(permissions)
    )
  );

CREATE POLICY "Admins can delete system email config"
  ON system_email_config FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE id = auth.uid() 
      AND 'admin' = ANY(permissions)
    )
  );

-- Service role bypass for send-email function
CREATE POLICY "Service role full access to system email config"
  ON system_email_config FOR ALL
  TO service_role
  USING (true);

-- Insert default configuration (to be filled with environment variables)
INSERT INTO system_email_config (config_key, from_name, from_email, smtp_host, smtp_port, smtp_username, smtp_use_tls, imap_host, imap_port, imap_username, imap_use_ssl, signature, is_active)
VALUES (
  'system',
  'System CRM',
  'system@example.com',
  'smtp.example.com',
  587,
  'system@example.com',
  true,
  'imap.example.com',
  993,
  'system@example.com',
  true,
  '<p>Pozdrawiamy,<br>Zespół CRM</p>',
  false
) ON CONFLICT (config_key) DO NOTHING;

COMMENT ON TABLE system_email_config IS 'Konfiguracja systemowej skrzynki email do wysyłania faktur i ofert. Hasła powinny być ustawione jako zmienne środowiskowe.';
