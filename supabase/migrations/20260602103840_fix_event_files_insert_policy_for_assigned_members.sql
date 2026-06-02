/*
  # Fix event_files INSERT policy for assigned members

  1. Changes
    - Update INSERT policy to allow any accepted team member to upload files
    - Previously required `can_edit_files = true` which defaults to false
    - This caused silent upload failures where files went to storage but not to the database

  2. Security
    - Still requires authenticated user
    - Still requires either: events_manage permission, event creator, or accepted assignment
    - Aligns INSERT permissions with SELECT permissions for file uploads
*/

DROP POLICY IF EXISTS "Authorized users can upload files" ON event_files;

CREATE POLICY "Authorized users can upload files"
  ON event_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    ))
    OR
    (EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_files.event_id
      AND events.created_by = auth.uid()
    ))
    OR
    (EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_files.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
    ))
  );
