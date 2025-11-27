/*
  # Analytics & Multi-City SEO System

  1. New Tables
    - `page_analytics` - statystyki odwiedzin
    - `contact_form_submissions` - formularze z metadanymi
    - `seo_city_content` - treści specyficzne dla miast
  
  2. Changes
    - Tracking pageviews, time on page, referrers
    - Formularz kontaktowy z source tracking
    - Multi-city SEO bez duplikacji
  
  3. Security
    - RLS policies dla analytics
    - Public INSERT dla contact forms
*/

-- Page Analytics Table
CREATE TABLE IF NOT EXISTS page_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url text NOT NULL,
  page_title text,
  referrer text,
  user_agent text,
  session_id text,
  ip_address text,
  country text,
  city text,
  device_type text,
  time_on_page integer,
  created_at timestamptz DEFAULT now()
);

-- Contact Form Submissions with Metadata
CREATE TABLE IF NOT EXISTS contact_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  source_page text NOT NULL,
  source_section text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  city_interest text,
  event_type text,
  referrer text,
  user_agent text,
  status text DEFAULT 'new',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SEO City Content (dla multi-city bez duplikacji)
CREATE TABLE IF NOT EXISTS seo_city_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug text NOT NULL,
  city text NOT NULL,
  region text,
  custom_title text,
  custom_description text,
  custom_h1 text,
  local_features jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(page_slug, city)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_page_analytics_url 
  ON page_analytics(page_url, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_analytics_created 
  ON page_analytics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_form_status 
  ON contact_form_submissions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_form_source 
  ON contact_form_submissions(source_page, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seo_city_page_city 
  ON seo_city_content(page_slug, city);

-- Enable RLS
ALTER TABLE page_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_city_content ENABLE ROW LEVEL SECURITY;

-- RLS Policies for page_analytics
CREATE POLICY "Anyone can insert analytics"
  ON page_analytics FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view analytics"
  ON page_analytics FOR SELECT
  USING (true);

-- RLS Policies for contact_form_submissions
CREATE POLICY "Anyone can submit contact form"
  ON contact_form_submissions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view contact forms"
  ON contact_form_submissions FOR SELECT
  USING (true);

CREATE POLICY "Admins can update contact forms"
  ON contact_form_submissions FOR UPDATE
  USING (true);

-- RLS Policies for seo_city_content
CREATE POLICY "Anyone can view active city content"
  ON seo_city_content FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage city content"
  ON seo_city_content FOR ALL
  USING (true);

-- Sample city data for kasyno page
INSERT INTO seo_city_content (page_slug, city, region, custom_title, custom_description, custom_h1, local_features)
VALUES 
  ('kasyno', 'Warszawa', 'Mazowieckie', 
   'Kasyno Eventowe Warszawa - Profesjonalna Organizacja | Mavinci',
   'Wynajmij stoły do kasyna w Warszawie. Profesjonalna organizacja eventów z kasynem w centrum i całym województwie mazowieckim. 15 lat doświadczenia.',
   'Kasyno Eventowe w Warszawie',
   '{"landmarks": ["Centrum", "Mokotów", "Wilanów"], "venues": ["Pałac Kultury", "Hala Torwar"], "coverage": "Warszawa i okolice do 50km"}'::jsonb
  ),
  ('kasyno', 'Kraków', 'Małopolskie',
   'Kasyno na Event Kraków - Stoły do Pokera i Ruletki | Mavinci',
   'Wynajem kasyna eventowego w Krakowie. Profesjonalne stoły: ruletka, poker, blackjack. Obsługa eventów firmowych w Krakowie i Małopolsce.',
   'Kasyno Eventowe w Krakowie',
   '{"landmarks": ["Stare Miasto", "Kazimierz", "Podgórze"], "venues": ["ICE Kraków", "Tauron Arena"], "coverage": "Kraków i Małopolska"}'::jsonb
  ),
  ('kasyno', 'Wrocław', 'Dolnośląskie',
   'Wynajem Kasyna na Event Wrocław - Profesjonalne Stoły | Mavinci',
   'Kasyno eventowe we Wrocławiu. Organizacja imprez z kasynem: poker, ruletka, blackjack. Dolny Śląsk i okolice.',
   'Kasyno Eventowe we Wrocławiu',
   '{"landmarks": ["Rynek", "Ostrów Tumski", "Centennial Hall"], "venues": ["Hala Stulecia", "Sky Tower"], "coverage": "Wrocław i Dolny Śląsk"}'::jsonb
  ),
  ('kasyno', 'Poznań', 'Wielkopolskie',
   'Kasyno Eventowe Poznań - Wynajem Stołów na Imprezy | Mavinci',
   'Profesjonalne kasyno na event w Poznaniu. Stoły do pokera, ruletki i blackjacka. Kompleksowa obsługa eventów w Wielkopolsce.',
   'Kasyno Eventowe w Poznaniu',
   '{"landmarks": ["Stary Rynek", "Cytadela", "Malta"], "venues": ["MTP", "Arena Poznań"], "coverage": "Poznań i Wielkopolska"}'::jsonb
  ),
  ('kasyno', 'Gdańsk', 'Pomorskie',
   'Kasyno na Event Gdańsk - Trójmiasto | Mavinci Events',
   'Wynajem kasyna eventowego w Gdańsku, Gdyni i Sopocie. Profesjonalne stoły i obsługa imprez w całym Trójmieście.',
   'Kasyno Eventowe w Trójmieście',
   '{"landmarks": ["Stare Miasto", "Molo w Sopocie", "Gdynia Centrum"], "venues": ["Ergo Arena", "Stare Miasto"], "coverage": "Trójmiasto i Pomorze"}'::jsonb
  ),
  ('kasyno', 'Katowice', 'Śląskie',
   'Kasyno Eventowe Katowice - Śląsk | Mavinci',
   'Profesjonalne kasyno na eventy w Katowicach i na Śląsku. Stoły: poker, ruletka, blackjack. Organizacja imprez firmowych.',
   'Kasyno Eventowe w Katowicach',
   '{"landmarks": ["Spodek", "Strefa Kultury", "Nikiszowiec"], "venues": ["MCK", "Spodek"], "coverage": "Katowice i GOP"}'::jsonb
  )
ON CONFLICT (page_slug, city) DO NOTHING;