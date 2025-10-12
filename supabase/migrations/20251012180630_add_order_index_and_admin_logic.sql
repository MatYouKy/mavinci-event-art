/*
  # Add Order Index and Admin Logic to Employees

  1. Changes
    - Add order_index column for sorting (default 999)
    - Admins automatically get order_index = 0
    - Add function to check if user is admin
    - Update RLS policies to restrict editing

  2. Admin Logic
    - access_level = 'admin' OR role = 'admin' = is admin
    - Admins can edit all employees
    - Regular employees can only edit their own profile
    - Admins appear first on website (order_index = 0)

  3. Security
    - RLS ensures non-admins can't edit others
*/

-- Step 1: Add order_index column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'order_index'
  ) THEN
    ALTER TABLE employees ADD COLUMN order_index INTEGER DEFAULT 999 NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_employees_order_index ON employees(order_index);
  END IF;
END $$;

-- Step 2: Set existing admins to order_index = 0
UPDATE employees 
SET order_index = 0 
WHERE (access_level = 'admin' OR role = 'admin');

-- Step 3: Create helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM employees
    WHERE id = user_id 
    AND (access_level = 'admin' OR role = 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Update RLS policies for editing

-- Drop old update policy
DROP POLICY IF EXISTS "Authenticated can update employees" ON employees;

-- New update policy: admins can update all, users can update only themselves
CREATE POLICY "Users can update own profile, admins can update all"
  ON employees FOR UPDATE
  TO authenticated
  USING (
    -- User is editing their own profile OR user is admin
    auth.uid() = id OR is_admin(auth.uid())
  )
  WITH CHECK (
    -- Same check for the new data
    auth.uid() = id OR is_admin(auth.uid())
  );

-- Step 5: Update delete policy - only admins can delete
DROP POLICY IF EXISTS "Authenticated can delete employees" ON employees;

CREATE POLICY "Only admins can delete employees"
  ON employees FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- Step 6: Add trigger to auto-set order_index for admins
CREATE OR REPLACE FUNCTION set_admin_order_index()
RETURNS TRIGGER AS $$
BEGIN
  -- If user is admin, set order_index to 0
  IF (NEW.access_level = 'admin' OR NEW.role = 'admin') THEN
    NEW.order_index := 0;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_admin_order_index ON employees;
CREATE TRIGGER trigger_set_admin_order_index
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION set_admin_order_index();

-- Step 7: Add comments
COMMENT ON COLUMN employees.order_index IS 'Sort order for website display. Admins automatically get 0 (first).';
COMMENT ON FUNCTION is_admin IS 'Check if user has admin access (access_level=admin OR role=admin)';
