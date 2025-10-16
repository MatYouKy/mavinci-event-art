/*
  # Create Access Level System

  1. New Tables
    - `access_levels` - defines different access levels (manager, dj, technician, etc.)
      - `id` (uuid, primary key)
      - `name` (text) - nazwa poziomu (np. "Manager", "DJ", "Technik")
      - `slug` (text, unique) - slug dla kodu (np. "manager", "dj", "technician")
      - `description` (text) - opis poziomu dostępu
      - `config` (jsonb) - konfiguracja widoczności i dostępu
        - view_full_event: boolean - czy widzi pełne wydarzenie
        - view_agenda: boolean - czy widzi agendę
        - view_files: boolean - czy widzi pliki
        - view_team: boolean - czy widzi zespół
        - view_equipment: boolean - czy widzi sprzęt
        - view_client_info: boolean - czy widzi dane klienta
        - edit_tasks: boolean - czy może edytować zadania
        - etc.
      - `default_permissions` (text[]) - domyślne uprawnienia dla tego poziomu
      - `order_index` (integer) - kolejność wyświetlania
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Changes
    - Add `access_level_id` to employees table
    - Keep existing `role` field for display purposes
    - Keep existing `permissions` array for fine-grained control

  3. Security
    - Enable RLS on `access_levels` table
    - Allow all authenticated users to read access levels
    - Only admins can modify access levels

  4. Sample Data
    - Create default access levels: admin, manager, employee, contractor
*/

-- Create access_levels table
CREATE TABLE IF NOT EXISTS access_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  config jsonb DEFAULT '{
    "view_full_event": false,
    "view_agenda": false,
    "view_files": false,
    "view_team": false,
    "view_equipment": false,
    "view_client_info": false,
    "view_budget": false,
    "edit_tasks": false,
    "manage_equipment": false
  }'::jsonb,
  default_permissions text[] DEFAULT '{}',
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add access_level_id to employees
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'access_level_id'
  ) THEN
    ALTER TABLE employees ADD COLUMN access_level_id uuid REFERENCES access_levels(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index
CREATE INDEX IF NOT EXISTS idx_employees_access_level_id ON employees(access_level_id);
CREATE INDEX IF NOT EXISTS idx_access_levels_slug ON access_levels(slug);

-- Enable RLS
ALTER TABLE access_levels ENABLE ROW LEVEL SECURITY;

-- Policies: Everyone can read access levels
CREATE POLICY "Authenticated users can view access levels"
  ON access_levels FOR SELECT
  TO authenticated
  USING (true);

-- Policies: Only admins can insert
CREATE POLICY "Admins can insert access levels"
  ON access_levels FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Policies: Only admins can update
CREATE POLICY "Admins can update access levels"
  ON access_levels FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Policies: Only admins can delete
CREATE POLICY "Admins can delete access levels"
  ON access_levels FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_access_levels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_access_levels_updated_at_trigger
  BEFORE UPDATE ON access_levels
  FOR EACH ROW
  EXECUTE FUNCTION update_access_levels_updated_at();

-- Insert default access levels
INSERT INTO access_levels (name, slug, description, config, default_permissions, order_index) VALUES
(
  'Administrator',
  'admin',
  'Pełny dostęp do wszystkich funkcji systemu',
  '{
    "view_full_event": true,
    "view_agenda": true,
    "view_files": true,
    "view_team": true,
    "view_equipment": true,
    "view_client_info": true,
    "view_budget": true,
    "edit_tasks": true,
    "manage_equipment": true
  }'::jsonb,
  ARRAY['events_manage', 'clients_manage', 'employees_manage', 'equipment_manage', 'offers_manage', 'contracts_manage', 'messages_manage', 'attractions_manage', 'event_categories_manage']::text[],
  1
),
(
  'Manager',
  'manager',
  'Pełny dostęp do wydarzeń - widzi wszystko, zarządza zespołem i sprzętem',
  '{
    "view_full_event": true,
    "view_agenda": true,
    "view_files": true,
    "view_team": true,
    "view_equipment": true,
    "view_client_info": true,
    "view_budget": true,
    "edit_tasks": true,
    "manage_equipment": true
  }'::jsonb,
  ARRAY['events_manage', 'equipment_manage']::text[],
  2
),
(
  'Pracownik',
  'employee',
  'Dostęp do agendy, plików i podstawowych informacji o wydarzeniu',
  '{
    "view_full_event": false,
    "view_agenda": true,
    "view_files": true,
    "view_team": true,
    "view_equipment": false,
    "view_client_info": false,
    "view_budget": false,
    "edit_tasks": false,
    "manage_equipment": false
  }'::jsonb,
  ARRAY[]::text[],
  3
),
(
  'DJ',
  'dj',
  'Dostęp do agendy i plików muzycznych',
  '{
    "view_full_event": false,
    "view_agenda": true,
    "view_files": true,
    "view_team": false,
    "view_equipment": false,
    "view_client_info": false,
    "view_budget": false,
    "edit_tasks": false,
    "manage_equipment": false
  }'::jsonb,
  ARRAY[]::text[],
  4
),
(
  'Technik',
  'technician',
  'Dostęp do informacji technicznych i sprzętu',
  '{
    "view_full_event": false,
    "view_agenda": true,
    "view_files": true,
    "view_team": false,
    "view_equipment": true,
    "view_client_info": false,
    "view_budget": false,
    "edit_tasks": false,
    "manage_equipment": false
  }'::jsonb,
  ARRAY[]::text[],
  5
),
(
  'Wykonawca zewnętrzny',
  'contractor',
  'Minimalny dostęp - tylko agenda i podstawowe informacje',
  '{
    "view_full_event": false,
    "view_agenda": true,
    "view_files": false,
    "view_team": false,
    "view_equipment": false,
    "view_client_info": false,
    "view_budget": false,
    "edit_tasks": false,
    "manage_equipment": false
  }'::jsonb,
  ARRAY[]::text[],
  6
)
ON CONFLICT (slug) DO NOTHING;
