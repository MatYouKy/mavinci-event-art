/*
  # Fix employee_permissions data types v2

  1. Changes
    - Clean up orphaned permissions first
    - Convert employee_permissions.employee_id from text to uuid to match employees.id
    - This fixes the join issue in notification trigger

  2. Security
    - Maintains existing RLS policies
*/

-- Delete orphaned permissions (where employee doesn't exist)
DELETE FROM employee_permissions
WHERE NOT EXISTS (
  SELECT 1 FROM employees e WHERE e.id::text = employee_id
);

-- Drop existing foreign key if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'employee_permissions_employee_id_fkey'
  ) THEN
    ALTER TABLE employee_permissions DROP CONSTRAINT employee_permissions_employee_id_fkey;
  END IF;
END $$;

-- Convert employee_id column to uuid
ALTER TABLE employee_permissions 
ALTER COLUMN employee_id TYPE uuid USING employee_id::uuid;

-- Recreate foreign key constraint
ALTER TABLE employee_permissions
  ADD CONSTRAINT employee_permissions_employee_id_fkey
  FOREIGN KEY (employee_id) 
  REFERENCES employees(id) 
  ON DELETE CASCADE;