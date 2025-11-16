/*
  # Allow public INSERT/DELETE for conferences_related_services

  1. Changes
    - Add policy allowing public INSERT
    - Add policy allowing public DELETE
    - Keep existing SELECT policy for active items
    - Keep existing admin/editor UPDATE policy

  2. Security Note
    - This is intentionally permissive to allow website editing without authentication
    - In production, you may want to add rate limiting or other protections
    - Consider adding a separate API key validation if needed
*/

-- Allow anyone to insert related services
CREATE POLICY "Anyone can insert related services"
  ON conferences_related_services
  FOR INSERT
  WITH CHECK (true);

-- Allow anyone to delete related services
CREATE POLICY "Anyone can delete related services"
  ON conferences_related_services
  FOR DELETE
  USING (true);
