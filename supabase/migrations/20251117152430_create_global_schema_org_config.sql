/*
  # Create Global Schema.org Configuration

  1. New Table
    - `schema_org_global` - Globalne dane Schema.org (areaServed, sameAs, etc.)
    
  2. Changes to existing tables
    - Keep `schema_org_business` for page-specific data
    - Keep `schema_org_places` for areas
    
  3. Security
    - RLS policies for website_edit permission
*/

-- Global Schema.org configuration (one row)
CREATE TABLE IF NOT EXISTS schema_org_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name text NOT NULL DEFAULT 'Mavinci',
  organization_url text NOT NULL DEFAULT 'https://mavinci.pl',
  organization_logo text,
  telephone text,
  email text,
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  youtube_url text,
  twitter_url text,
  street_address text,
  locality text,
  postal_code text,
  region text,
  country text DEFAULT 'PL',
  default_image text,
  updated_at timestamptz DEFAULT now()
);

-- Insert default global config
INSERT INTO schema_org_global (
  organization_name,
  organization_url,
  organization_logo,
  telephone,
  email,
  facebook_url,
  instagram_url,
  linkedin_url,
  street_address,
  locality,
  postal_code,
  region,
  country
) VALUES (
  'Mavinci Event & ART',
  'https://mavinci.pl',
  'https://mavinci.pl/logo-mavinci-crm.png',
  '+48 698-212-279',
  'kontakt@mavinci.pl',
  'https://www.facebook.com/mavinci',
  'https://www.instagram.com/mavinci',
  'https://www.linkedin.com/company/mavinci',
  'ul. Przykładowa 1',
  'Warszawa',
  '00-001',
  'Województwo Mazowieckie',
  'PL'
) ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE schema_org_global ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view global config"
  ON schema_org_global
  FOR SELECT
  USING (true);

CREATE POLICY "Website editors can update global config"
  ON schema_org_global
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Update schema_org_places to be global (not tied to specific business)
-- Add is_global flag
ALTER TABLE schema_org_places 
ADD COLUMN IF NOT EXISTS is_global boolean DEFAULT true;

-- Make business_id nullable for global places
ALTER TABLE schema_org_places 
ALTER COLUMN business_id DROP NOT NULL;

-- Update existing places to be global
UPDATE schema_org_places 
SET is_global = true, business_id = NULL 
WHERE business_id IS NOT NULL;

COMMENT ON TABLE schema_org_global IS 'Globalna konfiguracja Schema.org - dane wspólne dla wszystkich stron';
COMMENT ON TABLE schema_org_business IS 'Dane Schema.org specyficzne dla konkretnych podstron';
COMMENT ON TABLE schema_org_places IS 'Obszary obsługi (areaServed) - mogą być globalne lub per strona';
