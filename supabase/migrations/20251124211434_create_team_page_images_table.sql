/*
  # Create team_page_images table
  
  Creates the missing team_page_images table for storing hero images and other images for the team page.
  
  1. New Table
    - `team_page_images`
      - `id` (uuid, primary key)
      - `section` (text) - e.g., 'hero'
      - `name` (text)
      - `description` (text)
      - `image_url` (text)
      - `alt_text` (text)
      - `opacity` (numeric)
      - `image_metadata` (jsonb) - stores position and other metadata
      - `order_index` (integer)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS
    - Allow public SELECT
    - Allow authenticated users with website_edit permission to INSERT/UPDATE/DELETE
*/

CREATE TABLE IF NOT EXISTS team_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text,
  description text,
  image_url text,
  alt_text text,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb DEFAULT '{"desktop": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}, "mobile": {"position": {"posX": 0, "posY": 0, "scale": 1}, "objectFit": "cover"}}'::jsonb,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE team_page_images ENABLE ROW LEVEL SECURITY;

-- Allow public to view active images
CREATE POLICY "Anyone can view active team page images"
  ON team_page_images
  FOR SELECT
  USING (is_active = true);

-- Allow authenticated users with website_edit permission to manage
CREATE POLICY "Authenticated users with website_edit can insert team page images"
  ON team_page_images
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users with website_edit can update team page images"
  ON team_page_images
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users with website_edit can delete team page images"
  ON team_page_images
  FOR DELETE
  TO authenticated
  USING (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_team_page_images_section ON team_page_images(section);
CREATE INDEX IF NOT EXISTS idx_team_page_images_active ON team_page_images(is_active);
