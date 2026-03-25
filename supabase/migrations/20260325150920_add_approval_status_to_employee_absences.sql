/*
  # Add approval_status Column to employee_absences

  1. Changes
    - Add approval_status column (if missing)
    - Migrate existing status data to approval_status
    - Keep status column for backward compatibility temporarily

  2. Notes
    - approval_status is the new standard column name
    - status column will be deprecated in future
*/

-- Add approval_status column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_absences' AND column_name = 'approval_status'
  ) THEN
    ALTER TABLE employee_absences
    ADD COLUMN approval_status text DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected'));

    -- Copy data from status to approval_status if status column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'employee_absences' AND column_name = 'status'
    ) THEN
      UPDATE employee_absences
      SET approval_status = status
      WHERE approval_status IS NULL;
    END IF;
  END IF;
END $$;

-- Create index on approval_status
CREATE INDEX IF NOT EXISTS idx_employee_absences_approval_status ON employee_absences(approval_status);

-- Update existing RLS policies to use approval_status
DROP POLICY IF EXISTS "Employees can update own pending absences" ON employee_absences;
DROP POLICY IF EXISTS "Employees can delete own pending absences" ON employee_absences;

-- Employees can update their own PENDING absences
CREATE POLICY "Employees can update own pending absences"
  ON employee_absences FOR UPDATE
  TO authenticated
  USING (
    employee_id = auth.uid()
    AND approval_status = 'pending'
  )
  WITH CHECK (
    employee_id = auth.uid()
    AND approval_status = 'pending'
  );

-- Employees can delete their own PENDING absences
CREATE POLICY "Employees can delete own pending absences"
  ON employee_absences FOR DELETE
  TO authenticated
  USING (
    employee_id = auth.uid()
    AND approval_status = 'pending'
  );