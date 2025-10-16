/*
  # Add unique constraint to employee_assignments

  1. Changes
    - Add unique constraint on (event_id, employee_id) to prevent duplicates
    - This allows upsert operations when assigning employees to tasks

  2. Note
    - This ensures each employee can only be assigned once to an event
    - Multiple roles should be handled via the role field
*/

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_assignments_event_employee_unique'
  ) THEN
    ALTER TABLE employee_assignments
    ADD CONSTRAINT employee_assignments_event_employee_unique
    UNIQUE (event_id, employee_id);
  END IF;
END $$;
