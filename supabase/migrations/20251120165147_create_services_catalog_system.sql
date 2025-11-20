/*
  # Create Services Catalog System

  ## Overview
  System for managing service offerings displayed on /oferta page as dynamic cards.
  Each service card shows hero image thumbnail (40%), icon, title, description, and links to service detail page.

  ## 1. New Tables
    - `services_catalog` - Main catalog of all services offered

  ## 2. Schema Details
    
  ### services_catalog
  Stores all service offerings with their display data:
  - `id` (uuid, primary key) - Unique service identifier
  - `slug` (text, unique) - URL-friendly identifier (e.g., "konferencje", "streaming")
  - `title` (text) - Display title
  - `description` (text) - Short description for card
  - `icon_name` (text) - Lucide icon name (e.g., "Presentation", "Video")
  - `color_from` (text) - Gradient color start (e.g., "blue-500/20")
  - `color_to` (text) - Gradient color end (e.g., "blue-600/20")
  - `border_color` (text) - Border color (e.g., "border-blue-500/30")
  - `hero_image_url` (text) - URL to hero/thumbnail image
  - `hero_opacity` (numeric) - Image opacity 0-2
  - `order_index` (integer) - Display order on page
  - `is_active` (boolean) - Whether to show on page
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## 3. Security
    - Enable RLS on all tables
    - Public SELECT for displaying services
    - Website edit permission for managing services
*/

-- Create services_catalog table
CREATE TABLE IF NOT EXISTS services_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_name TEXT DEFAULT 'Settings',
  color_from TEXT DEFAULT 'blue-500/20',
  color_to TEXT DEFAULT 'blue-600/20',
  border_color TEXT DEFAULT 'border-blue-500/30',
  hero_image_url TEXT,
  hero_opacity NUMERIC DEFAULT 1.0,
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE services_catalog ENABLE ROW LEVEL SECURITY;

-- Public can view active services
CREATE POLICY "Allow public read access to services"
  ON services_catalog FOR SELECT
  TO public
  USING (is_active = true);

-- Authenticated users with website_edit permission can manage
CREATE POLICY "Allow website edit to manage services"
  ON services_catalog FOR ALL
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

-- Create index on slug for faster lookups
CREATE INDEX IF NOT EXISTS idx_services_catalog_slug ON services_catalog(slug);
CREATE INDEX IF NOT EXISTS idx_services_catalog_order ON services_catalog(order_index);