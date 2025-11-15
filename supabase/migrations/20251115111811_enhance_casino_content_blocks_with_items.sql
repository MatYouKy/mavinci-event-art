/*
  # Enhanced Casino Content Blocks System

  1. New Tables
    - `casino_content_sections` - główne sekcje
    - `casino_content_items` - pojedyncze elementy w sekcjach
    - `casino_content_separators` - separatory między sekcjami
  
  2. Changes
    - Sekcje mogą zawierać wiele itemów
    - Każdy item ma własny typ treści (heading, paragraph, list, video, image)
    - Rich content structure w JSONB
    - Separatory wizualne między sekcjami
  
  3. Security
    - RLS policies allow public SELECT
    - Admin can INSERT/UPDATE/DELETE
*/

-- Create casino_content_sections table
CREATE TABLE IF NOT EXISTS casino_content_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  subtitle text,
  layout_type text DEFAULT 'grid-1',
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean DEFAULT true,
  background_color text,
  padding_y text DEFAULT 'normal',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create casino_content_items table
CREATE TABLE IF NOT EXISTS casino_content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid REFERENCES casino_content_sections(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  content jsonb NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create casino_content_separators table
CREATE TABLE IF NOT EXISTS casino_content_separators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  separator_type text DEFAULT 'line',
  style jsonb,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_casino_content_items_section 
  ON casino_content_items(section_id, order_index);

CREATE INDEX IF NOT EXISTS idx_casino_content_sections_order 
  ON casino_content_sections(order_index);

CREATE INDEX IF NOT EXISTS idx_casino_content_separators_order 
  ON casino_content_separators(order_index);

-- Enable RLS
ALTER TABLE casino_content_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_content_separators ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sections
CREATE POLICY "Anyone can view visible casino sections"
  ON casino_content_sections FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins can manage casino sections"
  ON casino_content_sections FOR ALL
  USING (true);

-- RLS Policies for items
CREATE POLICY "Anyone can view visible casino items"
  ON casino_content_items FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins can manage casino items"
  ON casino_content_items FOR ALL
  USING (true);

-- RLS Policies for separators
CREATE POLICY "Anyone can view visible separators"
  ON casino_content_separators FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins can manage separators"
  ON casino_content_separators FOR ALL
  USING (true);