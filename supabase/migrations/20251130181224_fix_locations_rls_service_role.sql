/*
  # Fix Locations RLS - Add Service Role Bypass

  1. Changes
    - Add policy to allow service_role to bypass RLS for locations
    - This enables server-side operations and debugging

  2. Security
    - Service role has full access (needed for admin operations)
    - Regular users still protected by existing policies
*/

-- Allow service role full access to locations (for server-side operations)
CREATE POLICY "Service role can manage all locations"
  ON locations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
