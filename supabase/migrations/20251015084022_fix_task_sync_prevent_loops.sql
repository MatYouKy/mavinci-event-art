/*
  # Naprawa triggerów synchronizacji - zapobieganie nieskończonym pętlom

  1. Problem
    - Triggery wywoływały się nawzajem w nieskończoność
    - UPDATE na global → UPDATE na private → UPDATE na global → ...
    - Powodowało błąd stack depth exceeded
    
  2. Rozwiązanie
    - Dodanie warunków OLD != NEW aby trigger nie uruchamiał się gdy wartości się nie zmieniły
    - Usunięcie cyklicznych wywołań
    - Synchronizacja tylko gdy są realne zmiany
    
  3. Bezpieczeństwo
    - Triggery działają tylko przy rzeczywistych zmianach
    - Zapobieganie duplikatom
*/

-- Function to sync private task changes to global task (FIXED)
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
    -- Check if column actually changed
    IF OLD.board_column IS DISTINCT FROM NEW.board_column OR OLD.status IS DISTINCT FROM NEW.status THEN
      -- Store old status for notification
      SELECT board_column INTO old_status FROM tasks WHERE id = NEW.parent_task_id;
      
      -- Update the global (parent) task only if values are different
      UPDATE tasks 
      SET 
        board_column = NEW.board_column,
        status = NEW.status,
        updated_at = now()
      WHERE id = NEW.parent_task_id
        AND (board_column IS DISTINCT FROM NEW.board_column OR status IS DISTINCT FROM NEW.status);
      
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
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync global task changes to all private copies (FIXED)
CREATE OR REPLACE FUNCTION sync_global_to_private()
RETURNS TRIGGER AS $$
BEGIN
  -- Only sync if this is a global task and values actually changed
  IF NEW.is_private = false THEN
    -- Check if any relevant fields changed
    IF (OLD.board_column IS DISTINCT FROM NEW.board_column) OR
       (OLD.status IS DISTINCT FROM NEW.status) OR
       (OLD.title IS DISTINCT FROM NEW.title) OR
       (OLD.description IS DISTINCT FROM NEW.description) OR
       (OLD.priority IS DISTINCT FROM NEW.priority) OR
       (OLD.due_date IS DISTINCT FROM NEW.due_date) THEN
      
      -- Update all private copies only where values are different
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
      AND is_private = true
      AND (
        board_column IS DISTINCT FROM NEW.board_column OR
        status IS DISTINCT FROM NEW.status OR
        title IS DISTINCT FROM NEW.title OR
        description IS DISTINCT FROM NEW.description OR
        priority IS DISTINCT FROM NEW.priority OR
        due_date IS DISTINCT FROM NEW.due_date
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate triggers
DROP TRIGGER IF EXISTS trigger_sync_private_to_global ON tasks;
CREATE TRIGGER trigger_sync_private_to_global
  AFTER UPDATE OF board_column, status ON tasks
  FOR EACH ROW
  WHEN (OLD.board_column IS DISTINCT FROM NEW.board_column OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_private_to_global();

DROP TRIGGER IF EXISTS trigger_sync_global_to_private ON tasks;
CREATE TRIGGER trigger_sync_global_to_private
  AFTER UPDATE OF board_column, status, title, description, priority, due_date ON tasks
  FOR EACH ROW
  WHEN (
    OLD.board_column IS DISTINCT FROM NEW.board_column OR
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.title IS DISTINCT FROM NEW.title OR
    OLD.description IS DISTINCT FROM NEW.description OR
    OLD.priority IS DISTINCT FROM NEW.priority OR
    OLD.due_date IS DISTINCT FROM NEW.due_date
  )
  EXECUTE FUNCTION sync_global_to_private();
