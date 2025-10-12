/*
  # Add RLS Policies for Employees Table

  1. Changes
    - Add SELECT policy for authenticated users (CRM users can view all employees)
    - Add INSERT policy for authenticated users (CRM users can add employees)
    - Add UPDATE policy for authenticated users (CRM users can update all employees)
    - Add DELETE policy for authenticated users (CRM users can delete employees)

  2. Security
    - All authenticated users in CRM can manage employees
    - Anonymous users cannot access employees table
*/

-- Allow authenticated users to view all employees
CREATE POLICY "Authenticated users can view employees"
  ON employees
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert employees
CREATE POLICY "Authenticated users can insert employees"
  ON employees
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update employees
CREATE POLICY "Authenticated users can update employees"
  ON employees
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete employees
CREATE POLICY "Authenticated users can delete employees"
  ON employees
  FOR DELETE
  TO authenticated
  USING (true);
