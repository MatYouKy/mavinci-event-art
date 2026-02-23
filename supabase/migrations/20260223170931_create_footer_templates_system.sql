/*
  # Create Footer Templates System
  
  1. New Tables
    - `footer_templates`
      - `id` (uuid, primary key)
      - `name` (text) - Nazwa szablonu stopki
      - `is_default` (boolean) - Czy domyślna
      - `company_name` (text) - Nazwa firmy
      - `tagline` (text) - Hasło/motto
      - `website` (text) - Strona www
      - `email` (text) - Email kontaktowy
      - `phone` (text) - Telefon
      - `logo_url` (text) - Ścieżka do logo
      - `logo_scale` (integer) - Skala logo (20-120%)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `footer_templates` table
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS footer_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean DEFAULT false,
  company_name text NOT NULL,
  tagline text,
  website text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  logo_url text NOT NULL DEFAULT '/erulers_logo_vect.png',
  logo_scale integer DEFAULT 80 CHECK (logo_scale >= 20 AND logo_scale <= 120),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE footer_templates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view footer templates"
  ON footer_templates FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create footer templates"
  ON footer_templates FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update footer templates"
  ON footer_templates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete footer templates"
  ON footer_templates FOR DELETE
  TO authenticated
  USING (true);

-- Insert default templates
INSERT INTO footer_templates (name, is_default, company_name, tagline, website, email, phone, logo_url, logo_scale) VALUES
  ('EVENT RULERS', true, 'EVENT RULERS', 'Więcej niż Wodzireje!', 'www.eventrulers.pl', 'biuro@eventrulers.pl', '698-212-279', '/erulers_logo_vect.png', 80),
  ('MAVINCI', false, 'MAVINCI', 'Profesjonalna obsługa eventów', 'www.mavinci.pl', 'biuro@mavinci.pl', '698-212-279', '/logo-mavinci-crm.png', 80)
ON CONFLICT DO NOTHING;

-- Create index
CREATE INDEX IF NOT EXISTS idx_footer_templates_is_default ON footer_templates(is_default);