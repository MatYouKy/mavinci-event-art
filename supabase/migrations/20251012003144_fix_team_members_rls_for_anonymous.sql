/*
  # Fix Team Members RLS Policies for Anonymous Access

  1. Changes
    - Drop existing restrictive policy for authenticated users
    - Add separate policies for INSERT, UPDATE, DELETE that allow anonymous access
    - Keep SELECT policy for public access

  2. Security
    - This allows anyone to manage team members through the API
    - If you need more security, consider implementing admin authentication
*/

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Authenticated users can manage team members" ON team_members;

-- Allow anonymous INSERT
CREATE POLICY "Anyone can insert team members"
  ON team_members
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous UPDATE
CREATE POLICY "Anyone can update team members"
  ON team_members
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anonymous DELETE
CREATE POLICY "Anyone can delete team members"
  ON team_members
  FOR DELETE
  TO anon
  USING (true);

-- Also allow authenticated users to manage
CREATE POLICY "Authenticated users can insert team members"
  ON team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update team members"
  ON team_members
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete team members"
  ON team_members
  FOR DELETE
  TO authenticated
  USING (true);
