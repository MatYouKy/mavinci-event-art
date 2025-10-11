/*
  # Add RLS Policies for team_members table

  1. Security Changes
    - Add public SELECT policy for anyone to view team members
    - Add authenticated ALL policy for admins to manage team members
    
  These policies match the portfolio_projects policies to ensure consistent behavior.
*/

-- Drop existing policies if any
DROP POLICY IF EXISTS "Anyone can view team members" ON team_members;
DROP POLICY IF EXISTS "Authenticated users can manage team members" ON team_members;

-- Allow anyone to view team members
CREATE POLICY "Anyone can view team members"
  ON team_members
  FOR SELECT
  TO public
  USING (true);

-- Allow authenticated users to manage team members (INSERT, UPDATE, DELETE)
CREATE POLICY "Authenticated users can manage team members"
  ON team_members
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
