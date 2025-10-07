/*
  Combined Migration Script for New Database

  This script sets up all necessary tables and data for:
  - team_members
  - portfolio_projects
  - site_images
*/

-- ============================================
-- TEAM MEMBERS TABLE
-- ============================================

-- Create team_members table
CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  position text,
  bio text,
  email text,
  linkedin text,
  instagram text,
  facebook text,
  image text NOT NULL,
  alt text,
  image_metadata jsonb DEFAULT '{}'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_team_members_order ON team_members(order_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_email_unique ON team_members(email) WHERE email IS NOT NULL;

-- Enable RLS
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view team members" ON team_members;
DROP POLICY IF EXISTS "Admins can insert team members" ON team_members;
DROP POLICY IF EXISTS "Admins can update team members" ON team_members;
DROP POLICY IF EXISTS "Admins can delete team members" ON team_members;
DROP POLICY IF EXISTS "Public users can view team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can add team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can update team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can delete team members" ON team_members;

-- Create new policies
CREATE POLICY "Anyone can view team members"
  ON team_members FOR SELECT TO public USING (true);

CREATE POLICY "Admins can insert team members"
  ON team_members FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update team members"
  ON team_members FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins can delete team members"
  ON team_members FOR DELETE TO authenticated USING (true);

-- ============================================
-- PORTFOLIO PROJECTS TABLE
-- ============================================

-- Create portfolio_projects table
CREATE TABLE IF NOT EXISTS portfolio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  image text NOT NULL,
  description text NOT NULL,
  alt text DEFAULT '',
  image_metadata jsonb,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE portfolio_projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Public users can view portfolio projects" ON portfolio_projects;
DROP POLICY IF EXISTS "Authenticated users can add portfolio projects" ON portfolio_projects;
DROP POLICY IF EXISTS "Authenticated users can update portfolio projects" ON portfolio_projects;
DROP POLICY IF EXISTS "Authenticated users can delete portfolio projects" ON portfolio_projects;

-- Create policies
CREATE POLICY "Public users can view portfolio projects"
  ON portfolio_projects FOR SELECT USING (true);

CREATE POLICY "Authenticated users can add portfolio projects"
  ON portfolio_projects FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update portfolio projects"
  ON portfolio_projects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete portfolio projects"
  ON portfolio_projects FOR DELETE TO authenticated USING (true);

-- ============================================
-- SITE IMAGES TABLE
-- ============================================

-- Create site_images table
CREATE TABLE IF NOT EXISTS site_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  image text NOT NULL,
  alt text DEFAULT '',
  image_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE site_images ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view site images" ON site_images;
DROP POLICY IF EXISTS "Admins can insert site images" ON site_images;
DROP POLICY IF EXISTS "Admins can update site images" ON site_images;
DROP POLICY IF EXISTS "Admins can delete site images" ON site_images;

-- Create policies
CREATE POLICY "Anyone can view site images"
  ON site_images FOR SELECT TO public USING (true);

CREATE POLICY "Admins can insert site images"
  ON site_images FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update site images"
  ON site_images FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins can delete site images"
  ON site_images FOR DELETE TO authenticated USING (true);

-- ============================================
-- TRIGGERS
-- ============================================

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to team_members
DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members;
CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add trigger to portfolio_projects
DROP TRIGGER IF EXISTS update_portfolio_projects_updated_at ON portfolio_projects;
CREATE TRIGGER update_portfolio_projects_updated_at
  BEFORE UPDATE ON portfolio_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add trigger to site_images
DROP TRIGGER IF EXISTS update_site_images_updated_at ON site_images;
CREATE TRIGGER update_site_images_updated_at
  BEFORE UPDATE ON site_images
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SAMPLE DATA
-- ============================================

-- Insert sample team members
INSERT INTO team_members (name, role, position, bio, email, image, alt, order_index) VALUES
('Anna Kowalska', 'Event Manager', 'Event Manager', 'Specjalistka od organizacji wydarzeń z 8-letnim doświadczeniem', 'anna.kowalska@mavinci.pl', 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=800', 'Anna Kowalska - Event Manager', 1),
('Marek Nowak', 'Creative Director', 'Creative Director', 'Wizjoner i twórca niezapomnianych koncepcji eventowych', 'marek.nowak@mavinci.pl', 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=800', 'Marek Nowak - Creative Director', 2),
('Katarzyna Wiśniewska', 'PR Specialist', 'PR Specialist', 'Ekspertka w budowaniu relacji z mediami i promocji wydarzeń', 'katarzyna.wisniewska@mavinci.pl', 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=800', 'Katarzyna Wiśniewska - PR Specialist', 3),
('Piotr Zieliński', 'Technical Director', 'Technical Director', 'Odpowiada za całą stronę techniczną i logistyczną eventów', 'piotr.zielinski@mavinci.pl', 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=800', 'Piotr Zieliński - Technical Director', 4)
ON CONFLICT (email) DO NOTHING;

-- Insert sample site images
INSERT INTO site_images (key, image, alt) VALUES
('hero-background', 'https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=1920', 'Hero section background'),
('about-image', 'https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg?auto=compress&cs=tinysrgb&w=1200', 'O nas - zespół podczas eventu'),
('services-background', 'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=1920', 'Tło sekcji usług')
ON CONFLICT (key) DO NOTHING;
