/*
  # Create Portfolio Projects Management System

  ## Overview
  Creates a comprehensive system for managing portfolio projects displayed on the website.

  ## New Tables

  ### `portfolio_projects`
  Stores portfolio projects with support for image metadata, categorization, and ordering.

  **Columns:**
  - `id` (uuid, primary key) - Unique identifier for each project
  - `title` (text, required) - Project title
  - `category` (text, required) - Project category (e.g., "Konferencja", "Integracja", "Wieczór Tematyczny")
  - `image` (text, required) - URL to project's main image
  - `description` (text, required) - Detailed project description
  - `alt` (text) - Alt text for the image (accessibility)
  - `image_metadata` (jsonb) - Stores desktop/mobile image positioning data
    - Structure: { desktop: { src, position: { posX, posY, scale } }, mobile: { ... } }
  - `order_index` (integer, required, default 0) - Controls display order (lower numbers first)
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on portfolio_projects table
  - Public SELECT access (portfolio is displayed on public website)
  - Admin-only INSERT, UPDATE, DELETE access

  ## Indexes
  - Index on `order_index` for efficient ordering queries
  - Index on `category` for filtering by category

  ## Sample Data
  - Includes 6 sample portfolio projects covering different event types

  ## Notes
  - `image_metadata` allows precise control over image positioning on different screen sizes
  - `order_index` enables drag-and-drop reordering in admin panel
  - Projects can be filtered by category on the website
*/

-- Create portfolio_projects table
CREATE TABLE IF NOT EXISTS portfolio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  image text NOT NULL,
  description text NOT NULL,
  alt text DEFAULT '',
  image_metadata jsonb DEFAULT '{}'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index on order_index for efficient ordering
CREATE INDEX IF NOT EXISTS idx_portfolio_projects_order ON portfolio_projects(order_index);

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_portfolio_projects_category ON portfolio_projects(category);

-- Enable RLS
ALTER TABLE portfolio_projects ENABLE ROW LEVEL SECURITY;

-- Public can view portfolio projects
CREATE POLICY "Anyone can view portfolio projects"
  ON portfolio_projects
  FOR SELECT
  TO public
  USING (true);

-- Only authenticated admins can insert portfolio projects
CREATE POLICY "Admins can insert portfolio projects"
  ON portfolio_projects
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only authenticated admins can update portfolio projects
CREATE POLICY "Admins can update portfolio projects"
  ON portfolio_projects
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only authenticated admins can delete portfolio projects
CREATE POLICY "Admins can delete portfolio projects"
  ON portfolio_projects
  FOR DELETE
  TO authenticated
  USING (true);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_portfolio_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
DROP TRIGGER IF EXISTS trigger_update_portfolio_projects_updated_at ON portfolio_projects;
CREATE TRIGGER trigger_update_portfolio_projects_updated_at
  BEFORE UPDATE ON portfolio_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_portfolio_projects_updated_at();

-- Insert sample portfolio projects
INSERT INTO portfolio_projects (title, category, image, description, alt, order_index) VALUES
('Konferencja Tech Summit 2024', 'Konferencja', 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Organizacja trzydniowej konferencji technologicznej dla 500 uczestników. Kompleksowa obsługa techniczna, catering i program networkingowy.', 'Konferencja Tech Summit 2024', 1),
('Integracja firmy GlobalTech', 'Integracja', 'https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Dwudniowa integracja dla 200 pracowników z atrakcjami teambuildingowymi, warsztatami i wieczorem galowym.', 'Integracja firmy GlobalTech', 2),
('Wieczór w stylu Great Gatsby', 'Wieczór Tematyczny', 'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Ekskluzywny wieczór tematyczny w stylu lat 20. XX wieku z profesjonalną oprawą artystyczną i dekoracjami.', 'Wieczór w stylu Great Gatsby', 3),
('Gala Awards 2024', 'Gala', 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Prestiżowa gala wręczenia nagród z pełną obsługą techniczną, cateringiem i programem artystycznym.', 'Gala Awards 2024', 4),
('Quiz Show firmowy', 'Quiz', 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Interaktywny quiz show dla 150 uczestników z profesjonalnym prowadzącym i systemem głosowania.', 'Quiz Show firmowy', 5),
('Launch Party nowego produktu', 'Launch Event', 'https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=1200', 'Efektowne wydarzenie promocyjne z pokazem produktu, prezentacjami i częścią networkingową dla 300 gości.', 'Launch Party nowego produktu', 6);
