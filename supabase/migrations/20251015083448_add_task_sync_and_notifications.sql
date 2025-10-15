/*
  # Synchronizacja zadań i notyfikacje o zmianach statusu

  1. Zmiany w tabeli tasks
    - Dodanie kolumny `parent_task_id` - link do zadania globalnego (dla prywatnych kopii)
    
  2. Synchronizacja dwukierunkowa
    - Gdy prywatne zadanie zmienia status/kolumnę → aktualizuje globalne zadanie
    - Gdy globalne zadanie zmienia status/kolumnę → aktualizuje wszystkie prywatne kopie
    
  3. Notyfikacje
    - Gdy pracownik zmienia status zadania → notyfikacja dla twórcy i innych przypisanych
    - Informacja o tym kto zmienił i na jaki status
    
  4. Security
    - Notyfikacje widoczne dla odbiorców
    - Synchronizacja działa automatycznie przez triggery
*/

-- Add parent_task_id column to track relationship
ALTER TABLE tasks 
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

-- Update the copy function to include parent_task_id
CREATE OR REPLACE FUNCTION copy_task_to_private_on_assign()
RETURNS TRIGGER AS $$
DECLARE
  task_record RECORD;
BEGIN
  -- Get the task details
  SELECT * INTO task_record FROM tasks WHERE id = NEW.task_id;
  
  -- Only create private copy if task is global (not private)
  IF task_record.is_private = false THEN
    -- Check if private copy already exists for this employee
    IF NOT EXISTS (
      SELECT 1 FROM tasks 
      WHERE parent_task_id = NEW.task_id 
      AND owner_id = NEW.employee_id
      AND is_private = true
    ) THEN
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
        created_by,
        parent_task_id
      ) VALUES (
        task_record.title,
        task_record.description,
        task_record.priority,
        task_record.status,
        task_record.board_column,
        task_record.due_date,
        true,
        NEW.employee_id,
        task_record.created_by,
        NEW.task_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync private task changes to global task
CREATE OR REPLACE FUNCTION sync_private_to_global()
RETURNS TRIGGER AS $$
DECLARE
  old_status text;
  assignee_name text;
  column_label text;
  notif_id uuid;
BEGIN
  -- Only sync if this is a private task with a parent
  IF NEW.is_private = true AND NEW.parent_task_id IS NOT NULL THEN
    -- Store old status for notification
    SELECT board_column INTO old_status FROM tasks WHERE id = NEW.parent_task_id;
    
    -- Update the global (parent) task
    UPDATE tasks 
    SET 
      board_column = NEW.board_column,
      status = NEW.status,
      updated_at = now()
    WHERE id = NEW.parent_task_id;
    
    -- Send notification if column changed
    IF old_status IS DISTINCT FROM NEW.board_column THEN
      -- Get employee name who made the change
      SELECT name || ' ' || surname INTO assignee_name
      FROM employees
      WHERE id = NEW.owner_id;
      
      -- Translate column to Polish
      column_label := CASE NEW.board_column
        WHEN 'todo' THEN 'Do zrobienia'
        WHEN 'in_progress' THEN 'W trakcie'
        WHEN 'review' THEN 'Do sprawdzenia'
        WHEN 'completed' THEN 'Ukończone'
        ELSE NEW.board_column
      END;
      
      -- Create notification
      INSERT INTO notifications (
        title,
        message,
        category,
        related_id,
        created_at
      ) VALUES (
        'Zmieniono status zadania',
        assignee_name || ' przeniósł(a) zadanie "' || NEW.title || '" do kolumny: ' || column_label,
        'tasks',
        NEW.parent_task_id,
        now()
      )
      RETURNING id INTO notif_id;
      
      -- Add recipients (creator and other assignees, except the one who made the change)
      INSERT INTO notification_recipients (notification_id, employee_id, is_read)
      SELECT 
        notif_id,
        e.id,
        false
      FROM (
        SELECT created_by as id FROM tasks WHERE id = NEW.parent_task_id AND created_by IS NOT NULL
        UNION
        SELECT ta.employee_id as id 
        FROM task_assignees ta 
        WHERE ta.task_id = NEW.parent_task_id 
        AND ta.employee_id != NEW.owner_id
      ) e
      WHERE e.id IS NOT NULL
      AND e.id != NEW.owner_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync global task changes to all private copies
CREATE OR REPLACE FUNCTION sync_global_to_private()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync if this is a global task
  IF NEW.is_private = false THEN
    -- Update all private copies
    UPDATE tasks 
    SET 
      board_column = NEW.board_column,
      status = NEW.status,
      title = NEW.title,
      description = NEW.description,
      priority = NEW.priority,
      due_date = NEW.due_date,
      updated_at = now()
    WHERE parent_task_id = NEW.id
    AND is_private = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_sync_private_to_global ON tasks;
CREATE TRIGGER trigger_sync_private_to_global
  AFTER UPDATE OF board_column, status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION sync_private_to_global();

DROP TRIGGER IF EXISTS trigger_sync_global_to_private ON tasks;
CREATE TRIGGER trigger_sync_global_to_private
  AFTER UPDATE OF board_column, status, title, description, priority, due_date ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION sync_global_to_private();

COMMENT ON COLUMN tasks.parent_task_id IS 'ID zadania globalnego dla prywatnych kopii - używane do synchronizacji';
