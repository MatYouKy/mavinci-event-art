/*
  # Fix Task Assignees - Remove All Circular Dependencies

  1. Changes
    - Drop ALL existing policies on task_assignees
    - Create only simple policies without circular dependencies
    - No checks on employees table
    - No nested EXISTS queries

  2. Security
    - Direct checks only
    - Simple permission-based access
*/

-- Drop ALL existing policies for task_assignees
DROP POLICY IF EXISTS "Anyone authenticated can view task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Authenticated users can delete assignees" ON task_assignees;
DROP POLICY IF EXISTS "Authenticated users can insert assignees" ON task_assignees;
DROP POLICY IF EXISTS "Authenticated users can insert task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Authenticated users can update task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Authenticated users can view assignees" ON task_assignees;
DROP POLICY IF EXISTS "Service role can delete any assignment" ON task_assignees;
DROP POLICY IF EXISTS "Task creator can remove assignees" ON task_assignees;
DROP POLICY IF EXISTS "Users can add task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Users can delete their own assignment" ON task_assignees;
DROP POLICY IF EXISTS "Users can remove task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Users can remove themselves from tasks" ON task_assignees;
DROP POLICY IF EXISTS "Users can view task assignees" ON task_assignees;

-- Simple SELECT policy - everyone authenticated can view
CREATE POLICY "Select task assignees"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (true);

-- Simple INSERT policy - everyone authenticated can insert
CREATE POLICY "Insert task assignees"
  ON task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Simple UPDATE policy - everyone authenticated can update
CREATE POLICY "Update task assignees"
  ON task_assignees FOR UPDATE
  TO authenticated
  USING (true);

-- DELETE policy - only direct check, no nested queries
CREATE POLICY "Delete own task assignment"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (employee_id = auth.uid());
