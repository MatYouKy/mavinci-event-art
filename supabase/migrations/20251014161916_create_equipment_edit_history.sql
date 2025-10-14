/*
  # Equipment Edit History System

  ## Purpose
  Track all changes made to equipment records for auditing and accountability.

  ## Changes
  
  1. New Tables
    - `equipment_edit_history`
      - `id` (uuid, primary key)
      - `equipment_id` (uuid, foreign key to equipment_items)
      - `employee_id` (uuid, foreign key to employees)
      - `field_name` (text) - name of the field that was changed
      - `old_value` (text) - previous value (JSON for complex fields)
      - `new_value` (text) - new value (JSON for complex fields)
      - `change_type` (text) - type of change: 'create', 'update', 'delete'
      - `changed_at` (timestamptz, default: now())
  
  2. Security
    - Enable RLS on equipment_edit_history
    - Admins and employees with equipment_manage permission can view history
    - Only authenticated employees can insert records
  
  3. Indexes
    - Index on equipment_id for fast lookups
    - Index on employee_id for tracking who made changes
    - Index on changed_at for chronological queries
*/

-- Create equipment_edit_history table
CREATE TABLE IF NOT EXISTS equipment_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid REFERENCES equipment_items(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  change_type text NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
  changed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_equipment_edit_history_equipment_id 
  ON equipment_edit_history(equipment_id);

CREATE INDEX IF NOT EXISTS idx_equipment_edit_history_employee_id 
  ON equipment_edit_history(employee_id);

CREATE INDEX IF NOT EXISTS idx_equipment_edit_history_changed_at 
  ON equipment_edit_history(changed_at DESC);

-- Enable RLS
ALTER TABLE equipment_edit_history ENABLE ROW LEVEL SECURITY;

-- Policy: Admins and employees with equipment_manage can view history
CREATE POLICY "Authorized employees can view edit history"
  ON equipment_edit_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id IN (
        SELECT id FROM employees WHERE email = (SELECT email FROM auth.users WHERE auth.users.id = auth.uid())
      )
      AND (
        employees.role = 'admin'
        OR employees.permissions->>'equipment_manage' = 'true'
      )
    )
  );

-- Policy: Authenticated employees can insert edit history
CREATE POLICY "Authenticated employees can insert edit history"
  ON equipment_edit_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = employee_id
      AND employees.email = (SELECT email FROM auth.users WHERE auth.users.id = auth.uid())
    )
  );