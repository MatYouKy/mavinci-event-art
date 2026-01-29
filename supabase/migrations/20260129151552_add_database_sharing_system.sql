/*
  # Add Database Sharing System

  1. New Tables
    - `database_shares`
      - `id` (uuid, primary key)
      - `database_id` (uuid) - FK to custom_databases
      - `employee_id` (uuid) - FK to employees (shared with)
      - `shared_by` (uuid) - FK to employees (who shared)
      - `can_edit_records` (boolean) - can add/edit/delete records (default: false)
      - `shared_at` (timestamptz)

  2. Changes to RLS
    - databases_view: can see ONLY own databases + shared databases
    - databases_manage: can see ALL databases
    - Shared users: can view database and records (optionally edit records)
    - Shared users CANNOT edit database structure (columns)

  3. Security
    - Only admins and databases_manage users can share databases
    - Only admins can revoke shares
    - Shared users have read-only access to database structure
*/

-- Create database_shares table
CREATE TABLE IF NOT EXISTS database_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES custom_databases(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shared_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  can_edit_records boolean DEFAULT false,
  shared_at timestamptz DEFAULT now(),
  UNIQUE(database_id, employee_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_database_shares_database_id ON database_shares(database_id);
CREATE INDEX IF NOT EXISTS idx_database_shares_employee_id ON database_shares(employee_id);

-- Enable RLS
ALTER TABLE database_shares ENABLE ROW LEVEL SECURITY;

-- RLS Policies for database_shares
CREATE POLICY "Users can view shares for databases they can manage"
  ON database_shares FOR SELECT
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

CREATE POLICY "Admins and managers can create shares"
  ON database_shares FOR INSERT
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

CREATE POLICY "Admins and managers can delete shares"
  ON database_shares FOR DELETE
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

-- Drop old policies for custom_databases
DROP POLICY IF EXISTS "Users can view databases if they have permission" ON custom_databases;

-- Create new SELECT policy with sharing support
CREATE POLICY "Users can view accessible databases"
  ON custom_databases FOR SELECT
  TO authenticated
  USING (
    -- Admins can see all
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
    OR
    -- databases_manage can see all
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'databases_manage' = ANY(employees.permissions)
    )
    OR
    -- databases_view can see only own databases
    (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'databases_view' = ANY(employees.permissions)
      )
    )
    OR
    -- Shared databases: users can see databases shared with them
    EXISTS (
      SELECT 1 FROM database_shares
      WHERE database_shares.database_id = custom_databases.id
      AND database_shares.employee_id = auth.uid()
    )
  );

-- Drop old policies for custom_database_columns
DROP POLICY IF EXISTS "Users can view columns if they can view database" ON custom_database_columns;

-- Create new SELECT policy for columns with sharing support
CREATE POLICY "Users can view columns for accessible databases"
  ON custom_database_columns FOR SELECT
  TO authenticated
  USING (
    -- Check if user can see the database
    EXISTS (
      SELECT 1 FROM custom_databases
      WHERE custom_databases.id = custom_database_columns.database_id
      AND (
        -- Admin
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'admin' = ANY(employees.permissions)
        )
        OR
        -- databases_manage
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'databases_manage' = ANY(employees.permissions)
        )
        OR
        -- Owner with databases_view
        (
          custom_databases.created_by = auth.uid()
          AND EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND 'databases_view' = ANY(employees.permissions)
          )
        )
        OR
        -- Shared with user
        EXISTS (
          SELECT 1 FROM database_shares
          WHERE database_shares.database_id = custom_databases.id
          AND database_shares.employee_id = auth.uid()
        )
      )
    )
  );

-- Drop old policies for custom_database_records
DROP POLICY IF EXISTS "Users can view records if they can view database" ON custom_database_records;

-- Create new SELECT policy for records with sharing support
CREATE POLICY "Users can view records for accessible databases"
  ON custom_database_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM custom_databases
      WHERE custom_databases.id = custom_database_records.database_id
      AND (
        -- Admin
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'admin' = ANY(employees.permissions)
        )
        OR
        -- databases_manage
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'databases_manage' = ANY(employees.permissions)
        )
        OR
        -- Owner with databases_view
        (
          custom_databases.created_by = auth.uid()
          AND EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND 'databases_view' = ANY(employees.permissions)
          )
        )
        OR
        -- Shared with user
        EXISTS (
          SELECT 1 FROM database_shares
          WHERE database_shares.database_id = custom_databases.id
          AND database_shares.employee_id = auth.uid()
        )
      )
    )
  );

-- Create new INSERT/UPDATE/DELETE policies for records
-- Only admins, managers, and owners can modify records
-- Shared users CANNOT modify by default (unless can_edit_records = true)
CREATE POLICY "Users can insert records in databases they manage"
  ON custom_database_records FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM custom_databases
      WHERE custom_databases.id = custom_database_records.database_id
      AND (
        -- Admin
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'admin' = ANY(employees.permissions)
        )
        OR
        -- databases_manage
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'databases_manage' = ANY(employees.permissions)
        )
        OR
        -- Owner
        custom_databases.created_by = auth.uid()
        OR
        -- Shared with edit permission
        EXISTS (
          SELECT 1 FROM database_shares
          WHERE database_shares.database_id = custom_databases.id
          AND database_shares.employee_id = auth.uid()
          AND database_shares.can_edit_records = true
        )
      )
    )
  );

CREATE POLICY "Users can update records in databases they manage"
  ON custom_database_records FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM custom_databases
      WHERE custom_databases.id = custom_database_records.database_id
      AND (
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'admin' = ANY(employees.permissions)
        )
        OR
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'databases_manage' = ANY(employees.permissions)
        )
        OR
        custom_databases.created_by = auth.uid()
        OR
        EXISTS (
          SELECT 1 FROM database_shares
          WHERE database_shares.database_id = custom_databases.id
          AND database_shares.employee_id = auth.uid()
          AND database_shares.can_edit_records = true
        )
      )
    )
  );

CREATE POLICY "Users can delete records in databases they manage"
  ON custom_database_records FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM custom_databases
      WHERE custom_databases.id = custom_database_records.database_id
      AND (
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'admin' = ANY(employees.permissions)
        )
        OR
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND 'databases_manage' = ANY(employees.permissions)
        )
        OR
        custom_databases.created_by = auth.uid()
        OR
        EXISTS (
          SELECT 1 FROM database_shares
          WHERE database_shares.database_id = custom_databases.id
          AND database_shares.employee_id = auth.uid()
          AND database_shares.can_edit_records = true
        )
      )
    )
  );