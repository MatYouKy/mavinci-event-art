/*
  # Update Events RLS with Access Control

  1. Changes
    - Update events policies to respect new access control system
    - Event creator has full control
    - Collaborators can edit based on their specific permissions
    - Regular members have read-only access
*/

-- Drop existing UPDATE policy
DROP POLICY IF EXISTS "Users can update own events" ON events;
DROP POLICY IF EXISTS "Users can update events they created or manage" ON events;

-- Create new UPDATE policy with access control
CREATE POLICY "Users can update events based on permissions"
  ON events FOR UPDATE
  TO authenticated
  USING (
    -- Event creator can update everything
    auth.uid() = created_by
    OR
    -- Admins with events_manage can update everything
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    -- Collaborators with can_edit_event permission
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = events.id
      AND ea.employee_id = auth.uid()
      AND ea.can_edit_event = true
      AND ea.status = 'accepted'
    )
  )
  WITH CHECK (
    -- Same conditions for WITH CHECK
    auth.uid() = created_by
    OR
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = events.id
      AND ea.employee_id = auth.uid()
      AND ea.can_edit_event = true
      AND ea.status = 'accepted'
    )
  );

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete own events" ON events;
DROP POLICY IF EXISTS "Users can delete events they created or manage" ON events;

-- Create new DELETE policy (only creator and admins)
CREATE POLICY "Event creators and admins can delete events"
  ON events FOR DELETE
  TO authenticated
  USING (
    -- Only event creator
    auth.uid() = created_by
    OR
    -- Or admins with events_manage
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
  );

-- Update employee_assignments policies to allow collaborators to invite members
DROP POLICY IF EXISTS "Users can insert employee assignments for their events" ON employee_assignments;
DROP POLICY IF EXISTS "Event creators can assign employees" ON employee_assignments;

CREATE POLICY "Authorized users can assign employees to events"
  ON employee_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Event creator
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = employee_assignments.event_id
      AND events.created_by = auth.uid()
    )
    OR
    -- Admins with events_manage
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    -- Collaborators with can_invite_members permission
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = employee_assignments.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_invite_members = true
      AND ea.status = 'accepted'
    )
  );

-- Update policy to allow collaborators to modify assignments (like granting permissions)
DROP POLICY IF EXISTS "Users can update employee assignments for their events" ON employee_assignments;
DROP POLICY IF EXISTS "Event creators can update assignments" ON employee_assignments;

CREATE POLICY "Authorized users can update employee assignments"
  ON employee_assignments FOR UPDATE
  TO authenticated
  USING (
    -- Event creator
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = employee_assignments.event_id
      AND events.created_by = auth.uid()
    )
    OR
    -- Admins with events_manage
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    -- Users can update their own assignment (accept/reject)
    employee_assignments.employee_id = auth.uid()
    OR
    -- Collaborators with can_invite_members can update assignments
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = employee_assignments.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_invite_members = true
      AND ea.status = 'accepted'
    )
  )
  WITH CHECK (
    -- Same conditions
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = employee_assignments.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    employee_assignments.employee_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = employee_assignments.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_invite_members = true
      AND ea.status = 'accepted'
    )
  );

-- Update tasks policies to respect new permissions
DROP POLICY IF EXISTS "Users can update tasks for their events" ON tasks;

CREATE POLICY "Authorized users can update tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    tasks.event_id IS NULL -- Private tasks
    OR
    -- Event creator
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = tasks.event_id
      AND events.created_by = auth.uid()
    )
    OR
    -- Admins
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    -- Collaborators with can_edit_tasks permission
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = tasks.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_edit_tasks = true
      AND ea.status = 'accepted'
    )
    OR
    -- Task assignee can update own task
    EXISTS (
      SELECT 1 FROM task_assignees ta
      WHERE ta.task_id = tasks.id
      AND ta.employee_id = auth.uid()
    )
  )
  WITH CHECK (
    tasks.event_id IS NULL
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = tasks.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = tasks.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_edit_tasks = true
      AND ea.status = 'accepted'
    )
    OR
    EXISTS (
      SELECT 1 FROM task_assignees ta
      WHERE ta.task_id = tasks.id
      AND ta.employee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert tasks for their events" ON tasks;

CREATE POLICY "Authorized users can create tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    tasks.event_id IS NULL -- Private tasks
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = tasks.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = tasks.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_edit_tasks = true
      AND ea.status = 'accepted'
    )
  );

DROP POLICY IF EXISTS "Users can delete tasks for their events" ON tasks;

CREATE POLICY "Authorized users can delete tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    tasks.event_id IS NULL
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = tasks.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = tasks.event_id
      AND ea.employee_id = auth.uid()
      AND ea.can_edit_tasks = true
      AND ea.status = 'accepted'
    )
  );
