/*
  # Create Polish Cities Database and Page Metadata

  1. New Tables
    - `polish_cities` - Baza polskich miast z kodami pocztowymi
    - `schema_org_page_metadata` - Metadata per strona (keywords, offers, custom data)
    
  2. Features
    - Autocomplete miast
    - Keywords per strona
    - Offers per strona
*/

-- Polish cities database
CREATE TABLE IF NOT EXISTS polish_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  postal_code text,
  region text NOT NULL,
  population integer,
  created_at timestamptz DEFAULT now()
);

-- Page-specific metadata
CREATE TABLE IF NOT EXISTS schema_org_page_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug text UNIQUE NOT NULL,
  title text,
  description text,
  keywords text[],
  og_image text,
  schema_type text DEFAULT 'LocalBusiness',
  custom_schema jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Page offers (per-page pricing/service offers)
CREATE TABLE IF NOT EXISTS schema_org_page_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug text NOT NULL,
  offer_name text NOT NULL,
  description text,
  price_range text,
  price_from numeric(10,2),
  price_to numeric(10,2),
  currency text DEFAULT 'PLN',
  availability text DEFAULT 'InStock',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_polish_cities_slug ON polish_cities(slug);
CREATE INDEX IF NOT EXISTS idx_polish_cities_name ON polish_cities(name);
CREATE INDEX IF NOT EXISTS idx_page_metadata_slug ON schema_org_page_metadata(page_slug);
CREATE INDEX IF NOT EXISTS idx_page_offers_slug ON schema_org_page_offers(page_slug);

-- Enable RLS
ALTER TABLE polish_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_org_page_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_org_page_offers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for polish_cities
CREATE POLICY "Anyone can view cities"
  ON polish_cities
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage cities"
  ON polish_cities
  FOR ALL
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

-- RLS Policies for page_metadata
CREATE POLICY "Anyone can view active metadata"
  ON schema_org_page_metadata
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Website editors can manage metadata"
  ON schema_org_page_metadata
  FOR ALL
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

-- RLS Policies for page_offers
CREATE POLICY "Anyone can view active offers"
  ON schema_org_page_offers
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Website editors can manage offers"
  ON schema_org_page_offers
  FOR ALL
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

-- Insert popular Polish cities
INSERT INTO polish_cities (name, slug, postal_code, region, population) VALUES
('Warszawa', 'warszawa', '00-001', 'Województwo Mazowieckie', 1793579),
('Kraków', 'krakow', '30-001', 'Województwo Małopolskie', 779115),
('Łódź', 'lodz', '90-001', 'Województwo Łódzkie', 670642),
('Wrocław', 'wroclaw', '50-001', 'Województwo Dolnośląskie', 641201),
('Poznań', 'poznan', '60-001', 'Województwo Wielkopolskie', 534813),
('Gdańsk', 'gdansk', '80-001', 'Województwo Pomorskie', 470907),
('Szczecin', 'szczecin', '70-001', 'Województwo Zachodniopomorskie', 401907),
('Bydgoszcz', 'bydgoszcz', '85-001', 'Województwo Kujawsko-Pomorskie', 339053),
('Lublin', 'lublin', '20-001', 'Województwo Lubelskie', 338586),
('Katowice', 'katowice', '40-001', 'Województwo Śląskie', 292774),
('Białystok', 'bialystok', '15-001', 'Województwo Podlaskie', 296958),
('Gdynia', 'gdynia', '81-001', 'Województwo Pomorskie', 243918),
('Częstochowa', 'czestochowa', '42-200', 'Województwo Śląskie', 217530),
('Radom', 'radom', '26-600', 'Województwo Mazowieckie', 209296),
('Sosnowiec', 'sosnowiec', '41-200', 'Województwo Śląskie', 200453),
('Toruń', 'torun', '87-100', 'Województwo Kujawsko-Pomorskie', 201106),
('Kielce', 'kielce', '25-001', 'Województwo Świętokrzyskie', 194852),
('Rzeszów', 'rzeszow', '35-001', 'Województwo Podkarpackie', 192682),
('Gliwice', 'gliwice', '44-100', 'Województwo Śląskie', 175102),
('Zabrze', 'zabrze', '41-800', 'Województwo Śląskie', 171087),
('Olsztyn', 'olsztyn', '10-001', 'Województwo Warmińsko-Mazurskie', 171249),
('Bielsko-Biała', 'bielskobiala', '43-300', 'Województwo Śląskie', 169756),
('Bytom', 'bytom', '41-900', 'Województwo Śląskie', 164490),
('Zielona Góra', 'zielonagora', '65-001', 'Województwo Lubuskie', 140892),
('Rybnik', 'rybnik', '44-200', 'Województwo Śląskie', 138696),
('Ruda Śląska', 'rudaslaska', '41-700', 'Województwo Śląskie', 136423),
('Opole', 'opole', '45-001', 'Województwo Opolskie', 127839),
('Tychy', 'tychy', '43-100', 'Województwo Śląskie', 127831),
('Gorzów Wielkopolski', 'gorzowwielkopolski', '66-400', 'Województwo Lubuskie', 122550),
('Dąbrowa Górnicza', 'dabrowagornicza', '41-300', 'Województwo Śląskie', 119340)
ON CONFLICT (slug) DO NOTHING;

-- Sample page metadata for konferencje
INSERT INTO schema_org_page_metadata (
  page_slug,
  title,
  description,
  keywords,
  schema_type
) VALUES (
  'konferencje',
  'Profesjonalna obsługa konferencji - Mavinci',
  'Kompleksowa obsługa techniczna konferencji: nagłośnienie, projekcja, streaming, rejestracja wideo. Doświadczenie, profesjonalizm, nowoczesny sprzęt.',
  ARRAY['obsługa konferencji', 'nagłośnienie konferencji', 'streaming konferencji', 'realizacja video', 'technika konferencyjna', 'eventy biznesowe'],
  'LocalBusiness'
) ON CONFLICT (page_slug) DO NOTHING;

-- Sample offers for konferencje
INSERT INTO schema_org_page_offers (page_slug, offer_name, description, price_range, display_order) VALUES
('konferencje', 'Obsługa Basic', 'Podstawowy pakiet: nagłośnienie + mikrofony bezprzewodowe', '$$', 0),
('konferencje', 'Obsługa Standard', 'Nagłośnienie + projekcja + oświetlenie sceniczne', '$$$', 1),
('konferencje', 'Obsługa Premium', 'Pełna obsługa: nagłośnienie, projekcja, streaming, rejestracja wideo', '$$$$', 2)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE polish_cities IS 'Baza polskich miast z kodami pocztowymi i województwami';
COMMENT ON TABLE schema_org_page_metadata IS 'Metadata per strona (title, description, keywords, schema_type)';
COMMENT ON TABLE schema_org_page_offers IS 'Oferty cenowe per strona (dla Schema.org offers)';
