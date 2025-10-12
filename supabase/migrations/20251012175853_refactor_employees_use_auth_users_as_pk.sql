/*
  # Refactor Employees - Use auth.users as Primary Key

  1. Concept Change
    - OLD: employees has own ID + optional auth_user_id reference
    - NEW: employees.id IS the auth.users.id (UUID from Supabase Auth)
    - Every employee record = one auth user who can log in
    - Additional employee data stored in employees table

  2. Schema Changes
    - Drop old employees table
    - Create new employees table with id as FK to auth.users(id)
    - Preserve important fields: show_on_website, website_bio, etc.

  3. Important Notes
    - This is a breaking change - all existing employee data will be lost
    - After this migration, employees can ONLY be created via Supabase Auth
    - To add employee: 1) Create auth user, 2) Insert into employees with that user's ID

  4. Security
    - RLS policies ensure data integrity
    - Only authenticated users can view/manage employees
    - Public can only see employees with show_on_website=true
*/

-- Step 1: Drop old employees table (if you have important data, backup first!)
DROP TABLE IF EXISTS employees CASCADE;

-- Step 2: Create new employees table with auth.users.id as primary key
CREATE TABLE employees (
  -- Primary key is the auth user ID
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Basic Info
  name TEXT,
  surname TEXT,
  nickname TEXT,
  email TEXT UNIQUE,
  phone_number TEXT,
  phone_private TEXT,
  
  -- Profile Images
  avatar_url TEXT,
  avatar_metadata JSONB DEFAULT '{}'::jsonb,
  background_image_url TEXT,
  background_metadata JSONB DEFAULT '{"object_fit": "cover", "object_position": "center"}'::jsonb,
  
  -- Work Info
  role TEXT DEFAULT 'unassigned',
  access_level TEXT DEFAULT 'unassigned',
  occupation TEXT,
  region TEXT,
  
  -- Address
  address_street TEXT,
  address_city TEXT,
  address_postal_code TEXT,
  address_country TEXT DEFAULT 'Polska',
  
  -- Additional Info
  nip TEXT,
  company_name TEXT,
  skills JSONB DEFAULT '[]'::jsonb,
  qualifications TEXT,
  permissions JSONB DEFAULT '{}'::jsonb,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_login TEXT,
  notes TEXT,
  
  -- Website Display
  show_on_website BOOLEAN DEFAULT false NOT NULL,
  website_bio TEXT,
  linkedin_url TEXT,
  instagram_url TEXT,
  facebook_url TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  history JSONB DEFAULT '[]'::jsonb
);

-- Step 3: Create indexes
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);
CREATE INDEX IF NOT EXISTS idx_employees_access_level ON employees(access_level);
CREATE INDEX IF NOT EXISTS idx_employees_show_on_website ON employees(show_on_website);
CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active);

-- Step 4: Enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Step 5: RLS Policies

-- Public can view employees marked for website display
DROP POLICY IF EXISTS "Public can view website employees" ON employees;
CREATE POLICY "Public can view website employees"
  ON employees FOR SELECT
  TO public
  USING (show_on_website = true);

-- Authenticated users can view all employees
DROP POLICY IF EXISTS "Authenticated can view all employees" ON employees;
CREATE POLICY "Authenticated can view all employees"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert employees (when creating auth user)
DROP POLICY IF EXISTS "Authenticated can insert employees" ON employees;
CREATE POLICY "Authenticated can insert employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update employees
DROP POLICY IF EXISTS "Authenticated can update employees" ON employees;
CREATE POLICY "Authenticated can update employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can delete employees
DROP POLICY IF EXISTS "Authenticated can delete employees" ON employees;
CREATE POLICY "Authenticated can delete employees"
  ON employees FOR DELETE
  TO authenticated
  USING (true);

-- Step 6: Add helpful comments
COMMENT ON TABLE employees IS 'Employee data - id references auth.users(id). Each employee is an authenticated user.';
COMMENT ON COLUMN employees.id IS 'References auth.users.id - employee must have auth account';
COMMENT ON COLUMN employees.show_on_website IS 'Display this employee on public /zespol page';
COMMENT ON COLUMN employees.website_bio IS 'Biography text for website display';
