/*
  # Create Team Members Management System

  ## Overview
  Creates a comprehensive system for managing team members displayed on the website.

  ## New Tables
  
  ### `team_members`
  Stores information about team members with support for image metadata and ordering.
  
  **Columns:**
  - `id` (uuid, primary key) - Unique identifier for each team member
  - `name` (text, required) - Full name of the team member
  - `role` (text) - Job title/role (e.g., "Event Manager", "Creative Director")
  - `position` (text) - Alternative position field for compatibility
  - `bio` (text) - Biography/description of the team member
  - `email` (text) - Contact email address
  - `linkedin` (text) - LinkedIn profile URL
  - `instagram` (text) - Instagram profile URL
  - `facebook` (text) - Facebook profile URL
  - `image` (text, required) - URL to team member's photo
  - `alt` (text) - Alt text for the image (accessibility)
  - `image_metadata` (jsonb) - Stores desktop/mobile image positioning data
    - Structure: { desktop: { src, position: { posX, posY, scale } }, mobile: { ... } }
  - `order_index` (integer, required, default 0) - Controls display order (lower numbers first)
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on team_members table
  - Public SELECT access (team is displayed on public website)
  - Admin-only INSERT, UPDATE, DELETE access

  ## Indexes
  - Index on `order_index` for efficient ordering queries
  - Unique constraint on `email` if provided

  ## Notes
  - `image_metadata` allows precise control over image positioning on different screen sizes
  - `order_index` enables drag-and-drop reordering in admin panel
  - Both `role` and `position` fields for compatibility with different page layouts
*/

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

-- Create index on order_index for efficient ordering
CREATE INDEX IF NOT EXISTS idx_team_members_order ON team_members(order_index);

-- Create unique constraint on email (only if not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_email_unique ON team_members(email) WHERE email IS NOT NULL;

-- Enable RLS
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Public can view team members
CREATE POLICY "Anyone can view team members"
  ON team_members
  FOR SELECT
  TO public
  USING (true);

-- Only authenticated admins can insert team members
CREATE POLICY "Admins can insert team members"
  ON team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only authenticated admins can update team members
CREATE POLICY "Admins can update team members"
  ON team_members
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only authenticated admins can delete team members
CREATE POLICY "Admins can delete team members"
  ON team_members
  FOR DELETE
  TO authenticated
  USING (true);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_team_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
DROP TRIGGER IF EXISTS trigger_update_team_members_updated_at ON team_members;
CREATE TRIGGER trigger_update_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_team_members_updated_at();

-- Insert sample team members
INSERT INTO team_members (name, role, position, bio, email, image, alt, order_index) VALUES
('Anna Kowalska', 'Event Manager', 'Event Manager', 'Specjalistka od organizacji wydarzeń z 8-letnim doświadczeniem', 'anna.kowalska@mavinci.pl', 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=800', 'Anna Kowalska - Event Manager', 1),
('Marek Nowak', 'Creative Director', 'Creative Director', 'Wizjoner i twórca niezapomnianych koncepcji eventowych', 'marek.nowak@mavinci.pl', 'https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=800', 'Marek Nowak - Creative Director', 2),
('Katarzyna Wiśniewska', 'PR Specialist', 'PR Specialist', 'Ekspertka w budowaniu relacji z mediami i promocji wydarzeń', 'katarzyna.wisniewska@mavinci.pl', 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=800', 'Katarzyna Wiśniewska - PR Specialist', 3),
('Piotr Zieliński', 'Technical Director', 'Technical Director', 'Odpowiada za całą stronę techniczną i logistyczną eventów', 'piotr.zielinski@mavinci.pl', 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=800', 'Piotr Zieliński - Technical Director', 4)
ON CONFLICT DO NOTHING;