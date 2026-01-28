/*
  # Create Custom Databases System

  1. New Tables
    - `custom_databases`
      - `id` (uuid, primary key)
      - `name` (text) - nazwa bazy danych
      - `description` (text) - opcjonalny opis
      - `created_by` (uuid) - utworzył
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `custom_database_columns`
      - `id` (uuid, primary key)
      - `database_id` (uuid) - FK do custom_databases
      - `name` (text) - nazwa kolumny
      - `column_type` (text) - typ: text, number, date, boolean
      - `order_index` (int) - kolejność wyświetlania
      - `created_at` (timestamptz)

    - `custom_database_records`
      - `id` (uuid, primary key)
      - `database_id` (uuid) - FK do custom_databases
      - `data` (jsonb) - dane rekordu (klucze = column_id)
      - `order_index` (int) - kolejność wyświetlania
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Allow users with 'admin' permission full access
    - Allow users with 'databases_view' to read
    - Allow users with 'databases_manage' to manage
*/

-- Create custom_databases table
CREATE TABLE IF NOT EXISTS custom_databases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create custom_database_columns table
CREATE TABLE IF NOT EXISTS custom_database_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES custom_databases(id) ON DELETE CASCADE,
  name text NOT NULL,
  column_type text DEFAULT 'text' CHECK (column_type IN ('text', 'number', 'date', 'boolean')),
  order_index int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create custom_database_records table
CREATE TABLE IF NOT EXISTS custom_database_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES custom_databases(id) ON DELETE CASCADE,
  data jsonb DEFAULT '{}'::jsonb,
  order_index int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_custom_db_columns_database_id ON custom_database_columns(database_id);
CREATE INDEX IF NOT EXISTS idx_custom_db_columns_order ON custom_database_columns(database_id, order_index);
CREATE INDEX IF NOT EXISTS idx_custom_db_records_database_id ON custom_database_records(database_id);
CREATE INDEX IF NOT EXISTS idx_custom_db_records_order ON custom_database_records(database_id, order_index);

-- Enable RLS
ALTER TABLE custom_databases ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_database_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_database_records ENABLE ROW LEVEL SECURITY;

-- RLS Policies for custom_databases
CREATE POLICY "Users can view databases if they have permission"
  ON custom_databases FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_view' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users can create databases if they have permission"
  ON custom_databases FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users can update databases if they have permission"
  ON custom_databases FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Only admins can delete databases"
  ON custom_databases FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- RLS Policies for custom_database_columns
CREATE POLICY "Users can view columns if they can view database"
  ON custom_database_columns FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_view' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users can manage columns if they can manage database"
  ON custom_database_columns FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

-- RLS Policies for custom_database_records
CREATE POLICY "Users can view records if they can view database"
  ON custom_database_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_view' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users can manage records if they can manage database"
  ON custom_database_records FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_custom_database_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_custom_databases_updated_at
  BEFORE UPDATE ON custom_databases
  FOR EACH ROW
  EXECUTE FUNCTION update_custom_database_updated_at();

CREATE TRIGGER update_custom_database_records_updated_at
  BEFORE UPDATE ON custom_database_records
  FOR EACH ROW
  EXECUTE FUNCTION update_custom_database_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE custom_databases;
ALTER PUBLICATION supabase_realtime ADD TABLE custom_database_columns;
ALTER PUBLICATION supabase_realtime ADD TABLE custom_database_records;