/*
  # Conferences Page Content System

  1. New Tables
    - `conferences_hero` - hero section content
    - `conferences_problems` - common problems and solutions
    - `conferences_services` - technical services scope
    - `conferences_packages` - ready conference packages
    - `conferences_case_studies` - case study examples
    - `conferences_advantages` - why choose us
    - `conferences_process` - cooperation process steps
    - `conferences_pricing` - pricing tiers
    - `conferences_faq` - frequently asked questions
    - `conferences_images` - all images for the page
  
  2. Features
    - Full CMS for conferences page
    - Image management with metadata
    - SEO optimization fields
    - Multi-city support ready
  
  3. Security
    - Public read access
    - Admin-only write access
*/

-- Hero section
CREATE TABLE IF NOT EXISTS conferences_hero (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text NOT NULL,
  cta_primary text NOT NULL,
  cta_secondary text,
  trust_badge text NOT NULL,
  background_image text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Problems and solutions
CREATE TABLE IF NOT EXISTS conferences_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  problem_description text NOT NULL,
  solution_description text NOT NULL,
  icon_name text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Technical services
CREATE TABLE IF NOT EXISTS conferences_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text NOT NULL,
  category_description text NOT NULL,
  services_list text[] NOT NULL,
  icon_name text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Conference packages
CREATE TABLE IF NOT EXISTS conferences_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name text NOT NULL,
  package_level text NOT NULL CHECK (package_level IN ('basic', 'standard', 'pro')),
  description text NOT NULL,
  target_audience text NOT NULL,
  features jsonb NOT NULL,
  price_info text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Case studies
CREATE TABLE IF NOT EXISTS conferences_case_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name text NOT NULL,
  client_name text,
  event_type text NOT NULL,
  challenge text NOT NULL,
  solution text NOT NULL,
  result text NOT NULL,
  equipment_used text[] NOT NULL,
  attendees_count int,
  image_url text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Advantages
CREATE TABLE IF NOT EXISTS conferences_advantages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  icon_name text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Process steps
CREATE TABLE IF NOT EXISTS conferences_process (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_number int NOT NULL,
  step_title text NOT NULL,
  step_description text NOT NULL,
  duration_info text,
  icon_name text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Pricing tiers
CREATE TABLE IF NOT EXISTS conferences_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_name text NOT NULL,
  tier_description text NOT NULL,
  price_range text NOT NULL,
  attendees_range text NOT NULL,
  whats_included text[] NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- FAQ
CREATE TABLE IF NOT EXISTS conferences_faq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Images management
CREATE TABLE IF NOT EXISTS conferences_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_name text NOT NULL,
  image_url text NOT NULL,
  alt_text text NOT NULL,
  title text,
  caption text,
  display_order int NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_conferences_problems_order ON conferences_problems(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_services_order ON conferences_services(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_packages_order ON conferences_packages(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_case_studies_order ON conferences_case_studies(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_advantages_order ON conferences_advantages(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_process_order ON conferences_process(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_pricing_order ON conferences_pricing(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_faq_order ON conferences_faq(display_order);
CREATE INDEX IF NOT EXISTS idx_conferences_images_section ON conferences_images(section_name);

-- Enable RLS
ALTER TABLE conferences_hero ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_case_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_advantages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_process ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_faq ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_images ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Anyone can view conferences hero" ON conferences_hero FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences problems" ON conferences_problems FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences services" ON conferences_services FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences packages" ON conferences_packages FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences case studies" ON conferences_case_studies FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences advantages" ON conferences_advantages FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences process" ON conferences_process FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences pricing" ON conferences_pricing FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences faq" ON conferences_faq FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view conferences images" ON conferences_images FOR SELECT TO public USING (true);

-- Admin write policies (authenticated users only)
CREATE POLICY "Authenticated users can manage conferences hero" ON conferences_hero FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences problems" ON conferences_problems FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences services" ON conferences_services FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences packages" ON conferences_packages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences case studies" ON conferences_case_studies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences advantages" ON conferences_advantages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences process" ON conferences_process FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences pricing" ON conferences_pricing FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences faq" ON conferences_faq FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage conferences images" ON conferences_images FOR ALL TO authenticated USING (true) WITH CHECK (true);
