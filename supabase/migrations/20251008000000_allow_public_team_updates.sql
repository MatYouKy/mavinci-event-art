/*
  # Allow Public Updates to Team Members

  This migration allows public access to team member management
  for the admin interface to work without authentication.

  ## Changes
  - Drop existing restrictive policies
  - Create new public policies for INSERT, UPDATE, DELETE

  ## Security Note
  In production, replace these with authenticated admin-only policies.
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can insert team members" ON team_members;
DROP POLICY IF EXISTS "Admins can update team members" ON team_members;
DROP POLICY IF EXISTS "Admins can delete team members" ON team_members;

-- Allow public INSERT
CREATE POLICY "Public can insert team members"
  ON team_members
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Allow public UPDATE
CREATE POLICY "Public can update team members"
  ON team_members
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Allow public DELETE
CREATE POLICY "Public can delete team members"
  ON team_members
  FOR DELETE
  TO public
  USING (true);
