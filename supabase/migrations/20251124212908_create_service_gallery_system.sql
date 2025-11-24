/*
  # Create Service Gallery System
  
  Creates a gallery system for service detail pages to display additional images.
  
  1. New Table
    - `conferences_service_gallery`
      - `id` (uuid, primary key)
      - `service_id` (uuid, foreign key to conferences_service_items)
      - `image_url` (text)
      - `alt_text` (text)
      - `caption` (text)
      - `display_order` (integer)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS
    - Allow public SELECT for active images
    - Allow authenticated users with website_edit to manage
*/

CREATE TABLE IF NOT EXISTS conferences_service_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES conferences_service_items(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  alt_text text,
  caption text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE conferences_service_gallery ENABLE ROW LEVEL SECURITY;

-- Allow public to view active images
CREATE POLICY "Anyone can view active service gallery images"
  ON conferences_service_gallery
  FOR SELECT
  USING (is_active = true);

-- Allow authenticated users to manage
CREATE POLICY "Authenticated users can insert service gallery images"
  ON conferences_service_gallery
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update service gallery images"
  ON conferences_service_gallery
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete service gallery images"
  ON conferences_service_gallery
  FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_service_gallery_service_id ON conferences_service_gallery(service_id);
CREATE INDEX IF NOT EXISTS idx_service_gallery_active ON conferences_service_gallery(is_active);
CREATE INDEX IF NOT EXISTS idx_service_gallery_order ON conferences_service_gallery(display_order);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_conferences_service_gallery_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conferences_service_gallery_updated_at
  BEFORE UPDATE ON conferences_service_gallery
  FOR EACH ROW
  EXECUTE FUNCTION update_conferences_service_gallery_updated_at();
