/*
  # System prywatnych tablic zadań

  1. Zmiany w tabeli tasks
    - Dodanie kolumny `is_private` (boolean, domyślnie false) - określa czy zadanie jest prywatne czy globalne
    - Dodanie kolumny `owner_id` (uuid) - właściciel prywatnego zadania
    
  2. Logika
    - Zadania globalne (is_private = false): widoczne dla wszystkich, zarządzane przez administratorów
    - Zadania prywatne (is_private = true): widoczne tylko dla właściciela (owner_id)
    - Gdy zadanie globalne jest przypisane do pracownika, automatycznie tworzy się jego kopia jako zadanie prywatne
    
  3. Security
    - Prywatne zadania widoczne tylko dla właściciela
    - Globalne zadania widoczne dla wszystkich zalogowanych
*/

-- Add columns for private tasks
ALTER TABLE tasks 
  ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES employees(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_tasks_owner_private ON tasks(owner_id, is_private);
CREATE INDEX IF NOT EXISTS idx_tasks_is_private ON tasks(is_private);

-- Update RLS policies
DROP POLICY IF EXISTS "Authenticated users can view their tasks" ON tasks;

CREATE POLICY "Users can view global and own private tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    is_private = false 
    OR 
    (is_private = true AND owner_id = auth.uid())
  );

-- Update policy for INSERT
DROP POLICY IF EXISTS "Authenticated users can insert tasks" ON tasks;

CREATE POLICY "Users can insert global and own private tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    is_private = false 
    OR 
    (is_private = true AND owner_id = auth.uid())
  );

-- Update policy for UPDATE
DROP POLICY IF EXISTS "Authenticated users can update tasks" ON tasks;

CREATE POLICY "Users can update global and own private tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    is_private = false 
    OR 
    (is_private = true AND owner_id = auth.uid())
  )
  WITH CHECK (
    is_private = false 
    OR 
    (is_private = true AND owner_id = auth.uid())
  );

-- Update policy for DELETE
DROP POLICY IF EXISTS "Authenticated users can delete tasks" ON tasks;

CREATE POLICY "Users can delete global and own private tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    is_private = false 
    OR 
    (is_private = true AND owner_id = auth.uid())
  );

-- Create function to copy global task to private when assigned
CREATE OR REPLACE FUNCTION copy_task_to_private_on_assign()
RETURNS TRIGGER AS $$
DECLARE
  task_record RECORD;
BEGIN
  -- Get the task details
  SELECT * INTO task_record FROM tasks WHERE id = NEW.task_id;
  
  -- Only create private copy if task is global (not private)
  IF task_record.is_private = false THEN
    -- Create a private copy for the assigned employee
    INSERT INTO tasks (
      title,
      description,
      priority,
      status,
      board_column,
      due_date,
      is_private,
      owner_id,
      created_by
    ) VALUES (
      task_record.title,
      task_record.description,
      task_record.priority,
      task_record.status,
      task_record.board_column,
      task_record.due_date,
      true,
      NEW.employee_id,
      task_record.created_by
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on task_assignees
DROP TRIGGER IF EXISTS trigger_copy_task_to_private ON task_assignees;

CREATE TRIGGER trigger_copy_task_to_private
  AFTER INSERT ON task_assignees
  FOR EACH ROW
  EXECUTE FUNCTION copy_task_to_private_on_assign();

COMMENT ON COLUMN tasks.is_private IS 'Określa czy zadanie jest prywatne (true) czy globalne (false)';
COMMENT ON COLUMN tasks.owner_id IS 'Właściciel prywatnego zadania - tylko dla is_private = true';
