/*
  # Fix Employees Primary Key and Link with Team Members

  1. Schema Changes
    - Add primary key to employees.id
    - Add employee_id foreign key to team_members
    - Add website display fields to employees

  2. New Fields in Employees
    - show_on_website (boolean) - flag to display on /zespol page
    - website_bio (text) - biography for website
    - linkedin_url, instagram_url, facebook_url (text) - social media links

  3. Security
    - Public can view employees with show_on_website=true
    - Authenticated users have full access
*/

-- Add primary key to employees if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_pkey'
  ) THEN
    ALTER TABLE employees ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Add employee_id to team_members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_members' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE team_members ADD COLUMN employee_id text REFERENCES employees(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_team_members_employee_id ON team_members(employee_id);
  END IF;
END $$;

-- Add website-related fields to employees
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'show_on_website'
  ) THEN
    ALTER TABLE employees ADD COLUMN show_on_website boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'website_bio'
  ) THEN
    ALTER TABLE employees ADD COLUMN website_bio text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'linkedin_url'
  ) THEN
    ALTER TABLE employees ADD COLUMN linkedin_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'instagram_url'
  ) THEN
    ALTER TABLE employees ADD COLUMN instagram_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'facebook_url'
  ) THEN
    ALTER TABLE employees ADD COLUMN facebook_url text;
  END IF;
END $$;

-- Enable RLS on employees
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DROP POLICY IF EXISTS "Public can view employees marked for website" ON employees;
DROP POLICY IF EXISTS "Authenticated users can view all employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can insert employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can update employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can delete employees" ON employees;

-- Create new policies
CREATE POLICY "Public can view employees marked for website"
  ON employees FOR SELECT
  TO public
  USING (show_on_website = true);

CREATE POLICY "Authenticated users can view all employees"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employees"
  ON employees FOR DELETE
  TO authenticated
  USING (true);
