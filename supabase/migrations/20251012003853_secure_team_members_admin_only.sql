/*
  # Secure Team Members - Admin Only Edit

  1. Changes
    - Drop all existing permissive policies for team_members
    - Keep public SELECT (everyone can view)
    - Allow INSERT/UPDATE/DELETE only for admins (checked via custom claim in JWT)
    - Create helper function to check if user is admin

  2. Security
    - Only authenticated users with admin role can modify team_members
    - Everyone can view team_members
    - Uses JWT claims to verify admin status
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "Anyone can view team members" ON team_members;
DROP POLICY IF EXISTS "Anyone can insert team members" ON team_members;
DROP POLICY IF EXISTS "Anyone can update team members" ON team_members;
DROP POLICY IF EXISTS "Anyone can delete team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can insert team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can update team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can delete team members" ON team_members;

-- Create helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user_role in JWT is 'admin'
  RETURN (auth.jwt() -> 'user_metadata' ->> 'user_role' = 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Public can view all team members
CREATE POLICY "Anyone can view team members"
  ON team_members
  FOR SELECT
  TO public
  USING (true);

-- Only admins can insert
CREATE POLICY "Only admins can insert team members"
  ON team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

-- Only admins can update
CREATE POLICY "Only admins can update team members"
  ON team_members
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Only admins can delete
CREATE POLICY "Only admins can delete team members"
  ON team_members
  FOR DELETE
  TO authenticated
  USING (is_admin());
