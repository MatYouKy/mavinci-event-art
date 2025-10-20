/*
  # Allow Admin and Task Creator to Delete Comments
  
  1. Changes
    - Update DELETE policy for task_comments
    - Allow: comment author, task creator, users with tasks_manage permission, and admins
    
  2. Security
    - Maintains existing author and permission-based access
    - Adds task creator access
    - Adds admin access
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can delete their own comments or if they manage tasks" ON task_comments;

-- Create new policy with extended permissions
CREATE POLICY "Users can delete comments"
  ON task_comments
  FOR DELETE
  TO authenticated
  USING (
    -- Comment author can delete
    employee_id = auth.uid()
    OR
    -- User has tasks_manage permission
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_manage' = ANY(employees.permissions)
    )
    OR
    -- Task creator can delete comments in their task
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_comments.task_id
      AND tasks.created_by = auth.uid()
    )
    OR
    -- Admin can delete any comment
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );
