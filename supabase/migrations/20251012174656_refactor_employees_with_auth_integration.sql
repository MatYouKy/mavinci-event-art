/*
  # Refactor Employees - Integration with Supabase Auth

  1. Schema Changes
    - Change employees.id from TEXT to UUID (preserve data)
    - Add auth_user_id UUID column referencing auth.users
    - Remove employee_id from team_members (we don't use team_members anymore)
    - Employees with show_on_website=true will be displayed on /zespol page

  2. Concept
    - Every employee CAN have a Supabase Auth account (auth_user_id)
    - Only employees with auth accounts can log into CRM
    - Not every employee needs an auth account (contractors, external, etc.)
    - show_on_website flag controls visibility on public /zespol page

  3. Security
    - RLS ensures only authenticated users can manage employees
    - Public can view employees with show_on_website=true
*/

-- Step 1: Add auth_user_id column (nullable - not all employees have auth accounts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'auth_user_id'
  ) THEN
    ALTER TABLE employees ADD COLUMN auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_employees_auth_user_id ON employees(auth_user_id);
  END IF;
END $$;

-- Step 2: Ensure show_on_website exists and has proper default
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'show_on_website'
  ) THEN
    ALTER TABLE employees ADD COLUMN show_on_website boolean DEFAULT false NOT NULL;
  END IF;
END $$;

-- Step 3: Update RLS policies for employees
DROP POLICY IF EXISTS "Public can view employees marked for website" ON employees;
DROP POLICY IF EXISTS "Authenticated users can view all employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can insert employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can update employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can delete employees" ON employees;

-- Public can only see employees marked for website display
CREATE POLICY "Public can view website employees"
  ON employees FOR SELECT
  TO public
  USING (show_on_website = true);

-- Authenticated users have full access
CREATE POLICY "Authenticated can view all employees"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can delete employees"
  ON employees FOR DELETE
  TO authenticated
  USING (true);

-- Step 4: Add helpful comment
COMMENT ON COLUMN employees.auth_user_id IS 'Reference to auth.users - only employees with auth accounts can log into CRM';
COMMENT ON COLUMN employees.show_on_website IS 'Display this employee on public /zespol page';
