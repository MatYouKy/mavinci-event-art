/*
  # Add Foreign Key Constraint for tasks.event_id

  1. Changes
    - Add foreign key constraint from tasks.event_id to events.id
    - This allows proper relationship queries between events and tasks

  2. Notes
    - Uses CASCADE on delete to automatically remove tasks when event is deleted
    - Existing event_id column is already present, just adding the constraint
*/

-- Add foreign key constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'tasks_event_id_fkey'
  ) THEN
    ALTER TABLE tasks 
    ADD CONSTRAINT tasks_event_id_fkey 
    FOREIGN KEY (event_id) 
    REFERENCES events(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_event_id ON tasks(event_id);
