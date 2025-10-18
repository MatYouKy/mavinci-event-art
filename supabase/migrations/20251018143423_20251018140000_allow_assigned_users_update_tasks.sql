/*
  # Allow assigned users to update tasks

  1. Changes
    - Modify UPDATE policy for tasks to allow assigned users to update their tasks
    - Users assigned to a global task can update it (change board_column, etc.) even without tasks_manage permission
    - This ensures single source of truth for task state

  2. Security
    - Users can still only update tasks they're assigned to or have permissions for
    - Private tasks remain protected (only owner can update)
    - Event tasks still require events_manage permission
*/

-- Drop existing UPDATE policy
DROP POLICY IF EXISTS "Users can update their tasks" ON tasks;

-- Create new UPDATE policy that allows assigned users to update
CREATE POLICY "Users can update their tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    -- Swoje prywatne zadania
    (is_private = true AND owner_id = auth.uid())
    OR
    -- Zadania wydarzenia z uprawnieniami events_manage
    (
      is_private = false
      AND event_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          employees.role = 'admin'
          OR 'events_manage' = ANY(employees.permissions)
        )
      )
    )
    OR
    -- Globalne zadania z uprawnieniami tasks_manage
    (
      is_private = false
      AND event_id IS NULL
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          employees.role = 'admin'
          OR 'tasks_manage' = ANY(employees.permissions)
        )
      )
    )
    OR
    -- NEW: Globalne zadania do których użytkownik jest przypisany
    (
      is_private = false
      AND event_id IS NULL
      AND EXISTS (
        SELECT 1 FROM task_assignees
        WHERE task_assignees.task_id = tasks.id
        AND task_assignees.employee_id = auth.uid()
      )
    )
    OR
    -- NEW: Zadania wydarzenia do których użytkownik jest przypisany
    (
      is_private = false
      AND event_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM task_assignees
        WHERE task_assignees.task_id = tasks.id
        AND task_assignees.employee_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    (is_private = true AND owner_id = auth.uid())
    OR
    (
      is_private = false
      AND event_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          employees.role = 'admin'
          OR 'events_manage' = ANY(employees.permissions)
        )
      )
    )
    OR
    (
      is_private = false
      AND event_id IS NULL
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          employees.role = 'admin'
          OR 'tasks_manage' = ANY(employees.permissions)
        )
      )
    )
    OR
    -- NEW: Przypisani użytkownicy mogą aktualizować globalne zadania
    (
      is_private = false
      AND event_id IS NULL
      AND EXISTS (
        SELECT 1 FROM task_assignees
        WHERE task_assignees.task_id = tasks.id
        AND task_assignees.employee_id = auth.uid()
      )
    )
    OR
    -- NEW: Przypisani użytkownicy mogą aktualizować zadania wydarzenia
    (
      is_private = false
      AND event_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM task_assignees
        WHERE task_assignees.task_id = tasks.id
        AND task_assignees.employee_id = auth.uid()
      )
    )
  );
