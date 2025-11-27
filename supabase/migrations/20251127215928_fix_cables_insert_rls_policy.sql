/*
  # Fix cables INSERT RLS policy

  1. Changes
    - Drop and recreate INSERT policy with simpler check
    - Make sure WITH CHECK condition works properly

  2. Security
    - Only users with equipment:manage permission can insert cables
*/

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Allow users with equipment:manage to insert cables" ON cables;

-- Recreate with simpler approach
CREATE POLICY "Allow users with equipment:manage to insert cables"
  ON cables
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment:manage' = ANY(employees.permissions)
    )
  );
