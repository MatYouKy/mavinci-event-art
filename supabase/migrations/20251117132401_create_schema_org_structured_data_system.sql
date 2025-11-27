/*
  # Create Schema.org Structured Data Management System

  1. New Tables
    - `schema_org_business` - Główne dane LocalBusiness
    - `schema_org_places` - Obszary obsługi (areaServed)
    
  2. Security
    - Enable RLS on all tables
    - Public can read active data
    - Only users with website_edit permission can modify
    
  3. Features
    - Centralne zarządzanie danymi strukturalnymi
    - Wsparcie dla LocalBusiness type
    - Zarządzanie miejscami z pełnymi adresami
    - Elastyczna struktura dla różnych typów Schema.org
*/

-- Schema.org Business/Organization data
CREATE TABLE IF NOT EXISTS schema_org_business (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug text UNIQUE NOT NULL,
  schema_type text NOT NULL DEFAULT 'LocalBusiness',
  name text NOT NULL,
  description text,
  image_url text,
  telephone text,
  email text,
  url text,
  price_range text,
  opening_hours text,
  street_address text,
  locality text,
  postal_code text,
  region text,
  country text DEFAULT 'PL',
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  rating_value numeric(2,1),
  best_rating integer DEFAULT 5,
  review_count integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Schema.org Places (areaServed)
CREATE TABLE IF NOT EXISTS schema_org_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES schema_org_business(id) ON DELETE CASCADE,
  name text NOT NULL,
  locality text NOT NULL,
  postal_code text,
  region text,
  country text DEFAULT 'PL',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schema_org_business_page_slug ON schema_org_business(page_slug);
CREATE INDEX IF NOT EXISTS idx_schema_org_business_active ON schema_org_business(is_active);
CREATE INDEX IF NOT EXISTS idx_schema_org_places_business ON schema_org_places(business_id);
CREATE INDEX IF NOT EXISTS idx_schema_org_places_active ON schema_org_places(is_active);

-- Enable RLS
ALTER TABLE schema_org_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_org_places ENABLE ROW LEVEL SECURITY;

-- RLS Policies for schema_org_business
CREATE POLICY "Public can view active business data"
  ON schema_org_business
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Website editors can insert business data"
  ON schema_org_business
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Website editors can update business data"
  ON schema_org_business
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

CREATE POLICY "Website editors can delete business data"
  ON schema_org_business
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- RLS Policies for schema_org_places
CREATE POLICY "Public can view active places"
  ON schema_org_places
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Website editors can insert places"
  ON schema_org_places
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Website editors can update places"
  ON schema_org_places
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

CREATE POLICY "Website editors can delete places"
  ON schema_org_places
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Sample data for conferences page
INSERT INTO schema_org_business (
  page_slug,
  schema_type,
  name,
  description,
  telephone,
  email,
  url,
  price_range,
  opening_hours,
  street_address,
  locality,
  postal_code,
  region,
  country,
  facebook_url,
  instagram_url,
  linkedin_url,
  rating_value,
  best_rating,
  review_count
) VALUES (
  'konferencje',
  'LocalBusiness',
  'Mavinci - Obsługa Konferencji',
  'Kompleksowa obsługa konferencji - nagłośnienie, oświetlenie, projekcja, rejestracja video. Profesjonalne wsparcie techniczne dla wydarzeń biznesowych.',
  '+48 698-212-279',
  'kontakt@mavinci.pl',
  'https://mavinci.pl/oferta/konferencje',
  '$$$',
  'Mo-Fr 08:00-18:00',
  'ul. Przykładowa 1',
  'Warszawa',
  '00-001',
  'Województwo Mazowieckie',
  'PL',
  'https://www.facebook.com/mavinci',
  'https://www.instagram.com/mavinci',
  'https://www.linkedin.com/company/mavinci',
  4.8,
  5,
  87
) ON CONFLICT (page_slug) DO NOTHING;
