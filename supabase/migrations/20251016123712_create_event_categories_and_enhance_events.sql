/*
  # Create event categories and enhance events table

  1. New Tables
    - `event_categories`
      - `id` (uuid, primary key)
      - `name` (text) - Nazwa kategorii
      - `color` (text) - Kolor w formacie hex (#RRGGBB)
      - `description` (text, optional)
      - `is_active` (boolean) - Czy kategoria jest aktywna
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Changes to events table
    - Add `category_id` (uuid) - Foreign key do event_categories
    - Add `created_by` (uuid) - Foreign key do employees (twórca wydarzenia)
    
  3. Security
    - Enable RLS on event_categories
    - Add policies for authenticated employees
    
  4. Sample Data
    - Add default event categories
*/

-- Create event_categories table
CREATE TABLE IF NOT EXISTS event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add columns to events table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE events ADD COLUMN category_id UUID REFERENCES event_categories(id) ON DELETE SET NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE events ADD COLUMN created_by UUID REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;

-- Policies for event_categories
CREATE POLICY "Authenticated employees can view event categories"
  ON event_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees with events_manage can insert categories"
  ON event_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with events_manage can update categories"
  ON event_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with events_manage can delete categories"
  ON event_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
  );

-- Insert default categories
INSERT INTO event_categories (name, color, description) VALUES
  ('Konferencja', '#3B82F6', 'Wydarzenia konferencyjne i biznesowe'),
  ('Wesele', '#EC4899', 'Wesela i uroczystości ślubne'),
  ('Koncert', '#8B5CF6', 'Koncerty i wydarzenia muzyczne'),
  ('Impreza firmowa', '#10B981', 'Eventy firmowe i integracyjne'),
  ('Targi', '#F59E0B', 'Targi i wystawy'),
  ('Event sportowy', '#EF4444', 'Wydarzenia sportowe'),
  ('Inne', '#6B7280', 'Pozostałe wydarzenia')
ON CONFLICT DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_event_categories_active ON event_categories(is_active) WHERE is_active = true;
