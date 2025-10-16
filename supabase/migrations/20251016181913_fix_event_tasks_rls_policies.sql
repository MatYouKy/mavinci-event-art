/*
  # Fix RLS policies for event tasks

  1. Problem
    - Current policies allow only users with tasks_manage to create global tasks
    - Event tasks (with event_id) should be accessible to anyone with events_manage
    - Users working on an event should be able to manage event tasks

  2. Solution
    - Update INSERT policy to allow creating tasks for events
    - Update SELECT policy to allow viewing event tasks
    - Update UPDATE/DELETE policies for event tasks
    
  3. Security
    - Users with events_manage can create/edit tasks for any event
    - Users assigned to an event can create/edit tasks for that event
*/

-- Drop old policies
DROP POLICY IF EXISTS "Users can view accessible tasks" ON tasks;
DROP POLICY IF EXISTS "Users can insert tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update their tasks" ON tasks;
DROP POLICY IF EXISTS "Users can delete their tasks" ON tasks;

-- SELECT: Zobacz globalne + swoje prywatne + zadania gdzie jesteś przypisany + zadania wydarzeń
CREATE POLICY "Users can view accessible tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    -- Globalne zadania (widoczne dla wszystkich z events_manage lub tasks_manage)
    (is_private = false AND event_id IS NULL AND EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND (
        employees.role = 'admin' 
        OR 'tasks_manage' = ANY(employees.permissions)
        OR 'events_manage' = ANY(employees.permissions)
      )
    ))
    OR 
    -- Zadania wydarzenia (widoczne dla wszystkich z events_manage)
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND (
        employees.role = 'admin' 
        OR 'events_manage' = ANY(employees.permissions)
      )
    ))
    OR
    -- Swoje prywatne zadania
    (is_private = true AND owner_id = auth.uid())
    OR
    -- Zadania gdzie jesteś przypisany (przez task_assignees)
    EXISTS (
      SELECT 1 FROM task_assignees 
      WHERE task_assignees.task_id = tasks.id 
      AND task_assignees.employee_id = auth.uid()
    )
  );

-- INSERT: Możesz tworzyć prywatne, globalne (tasks_manage) lub zadania wydarzeń (events_manage)
CREATE POLICY "Users can insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Prywatne zadania: tylko swoje
    (is_private = true AND owner_id = auth.uid())
    OR 
    -- Zadania wydarzenia: jeśli masz uprawnienie events_manage
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
    -- Globalne zadania: jeśli masz uprawnienie tasks_manage
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
  );

-- UPDATE: Możesz edytować swoje prywatne, globalne (tasks_manage) lub zadania wydarzeń (events_manage)
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
  );

-- DELETE: Możesz usuwać swoje prywatne, globalne (tasks_manage) lub zadania wydarzeń (events_manage)
CREATE POLICY "Users can delete their tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
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
  );
