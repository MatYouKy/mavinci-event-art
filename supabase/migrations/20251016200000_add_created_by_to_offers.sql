/*
  # Add created_by to offers table

  1. Changes
    - Add `created_by` column to offers table referencing employees
    - Add index for faster queries by creator
    - Update RLS policies to filter by creator for non-admins

  2. Security
    - Employees can see their own offers
    - Admins can see all offers
    - Only creator can update their draft offers
*/

-- Add created_by column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE offers ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_offers_created_by ON offers(created_by);

-- Drop existing RLS policies if they exist
DROP POLICY IF EXISTS "Users with events_manage can view offers" ON offers;
DROP POLICY IF EXISTS "Users with events_manage can insert offers" ON offers;
DROP POLICY IF EXISTS "Users with events_manage can update offers" ON offers;
DROP POLICY IF EXISTS "Users with events_manage can delete offers" ON offers;

-- Create new RLS policies

-- View: Admins see all, others see only their own
CREATE POLICY "Employees can view offers"
  ON offers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
        OR offers.created_by = employees.id
      )
    )
  );

-- Insert: Anyone with offers_manage permission
CREATE POLICY "Employees can insert offers"
  ON offers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
      )
    )
  );

-- Update: Creator can update draft, admins can update all
CREATE POLICY "Employees can update offers"
  ON offers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
        OR (offers.created_by = employees.id AND offers.status = 'draft')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
        OR (offers.created_by = employees.id AND offers.status = 'draft')
      )
    )
  );

-- Delete: Only admins
CREATE POLICY "Admins can delete offers"
  ON offers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );
