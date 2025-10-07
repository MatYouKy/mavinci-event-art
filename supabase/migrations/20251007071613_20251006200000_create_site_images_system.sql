/*
  # Site Images Management System

  1. New Tables
    - `site_images`
      - `id` (uuid, primary key)
      - `section` (text) - Section identifier (e.g., 'hero', 'divider1', 'services', 'portfolio')
      - `name` (text) - Friendly name for admin panel
      - `description` (text) - Description of image usage
      - `desktop_url` (text) - Desktop version URL
      - `mobile_url` (text, nullable) - Mobile version URL (optional)
      - `alt_text` (text) - Alt text for accessibility
      - `position` (text, nullable) - Position information (e.g., 'top', 'center', 'cover')
      - `order_index` (integer) - Display order within section
      - `is_active` (boolean) - Whether image is currently active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `site_images` table
    - Add policy for public read access
    - Add policy for authenticated admin write access

  3. Indexes
    - Index on `section` for fast filtering
    - Index on `order_index` for sorting
*/

-- Create site_images table
CREATE TABLE IF NOT EXISTS site_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  desktop_url text NOT NULL,
  mobile_url text,
  alt_text text DEFAULT '',
  position text DEFAULT 'center',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_site_images_section ON site_images(section);
CREATE INDEX IF NOT EXISTS idx_site_images_order ON site_images(order_index);
CREATE INDEX IF NOT EXISTS idx_site_images_active ON site_images(is_active);

-- Enable RLS
ALTER TABLE site_images ENABLE ROW LEVEL SECURITY;

-- Policy for public read access (anyone can view active images)
CREATE POLICY "Anyone can view active site images"
  ON site_images
  FOR SELECT
  USING (is_active = true);

-- Policy for authenticated users to view all images (including inactive)
CREATE POLICY "Authenticated users can view all site images"
  ON site_images
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy for authenticated users to insert images
CREATE POLICY "Authenticated users can insert site images"
  ON site_images
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy for authenticated users to update images
CREATE POLICY "Authenticated users can update site images"
  ON site_images
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy for authenticated users to delete images
CREATE POLICY "Authenticated users can delete site images"
  ON site_images
  FOR DELETE
  TO authenticated
  USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_site_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_site_images_updated_at
  BEFORE UPDATE ON site_images
  FOR EACH ROW
  EXECUTE FUNCTION update_site_images_updated_at();