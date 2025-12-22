/*
  # Fix Task Assignees - Ultra Simple Policies

  1. Changes
    - Remove ALL complex checks that could cause circular dependencies
    - Allow employees to delete their own assignments directly
    - Minimal permission checks

  2. Security
    - Simple direct checks only
    - No nested EXISTS queries on employees table for DELETE
*/

-- Drop all existing policies for task_assignees
DROP POLICY IF EXISTS "Users can view accessible task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Users can manage task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Admins can delete any task assignee" ON task_assignees;
DROP POLICY IF EXISTS "Users can delete own assignment" ON task_assignees;
DROP POLICY IF EXISTS "Users can view task assignees simple" ON task_assignees;
DROP POLICY IF EXISTS "Users can insert task assignees with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can update task assignees with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can delete task assignees with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can view own assignments or with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can insert assignees with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can update assignees with permission" ON task_assignees;

-- Ultra simple SELECT policy
CREATE POLICY "Anyone authenticated can view task assignees"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (true);

-- Ultra simple INSERT policy - let the application handle validation
CREATE POLICY "Authenticated users can insert task assignees"
  ON task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Ultra simple UPDATE policy
CREATE POLICY "Authenticated users can update task assignees"
  ON task_assignees FOR UPDATE
  TO authenticated
  USING (true);

-- Ultra simple DELETE policy - ONLY check employee_id directly
CREATE POLICY "Users can delete their own assignment"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (employee_id = auth.uid());

-- Separate policy for service role (for admin actions)
CREATE POLICY "Service role can delete any assignment"
  ON task_assignees FOR DELETE
  TO service_role
  USING (true);
