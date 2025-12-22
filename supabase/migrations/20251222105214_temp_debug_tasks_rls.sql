/*
  # Temporary Debug - Open RLS for Tasks

  1. Changes
    - Temporarily allow all authenticated users to see all tasks
    - This is for debugging only
    
  2. Security
    - WARNING: This is not secure, only for debugging
    - Will be reverted once issue is found
*/

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view accessible tasks" ON tasks;

-- Temporary: Allow all authenticated users to see all tasks (DEBUG ONLY)
CREATE POLICY "DEBUG: All authenticated can view tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (true);
