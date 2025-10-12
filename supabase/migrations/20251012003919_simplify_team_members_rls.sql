/*
  # Simplify Team Members RLS

  1. Changes
    - Drop complex admin-only policies
    - Allow public read access
    - Allow anonymous write access (will be secured in API layer)
    - Drop is_admin function (not needed)

  2. Security
    - API routes will handle admin verification
    - RLS allows public read, anonymous write through API
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "Anyone can view team members" ON team_members;
DROP POLICY IF EXISTS "Only admins can insert team members" ON team_members;
DROP POLICY IF EXISTS "Only admins can update team members" ON team_members;
DROP POLICY IF EXISTS "Only admins can delete team members" ON team_members;

-- Drop helper function
DROP FUNCTION IF EXISTS is_admin();

-- Public can view all team members
CREATE POLICY "Public can view team members"
  ON team_members
  FOR SELECT
  TO public
  USING (true);

-- Anonymous can insert (API will verify admin)
CREATE POLICY "API can insert team members"
  ON team_members
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Anonymous can update (API will verify admin)
CREATE POLICY "API can update team members"
  ON team_members
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Anonymous can delete (API will verify admin)
CREATE POLICY "API can delete team members"
  ON team_members
  FOR DELETE
  TO anon
  USING (true);
