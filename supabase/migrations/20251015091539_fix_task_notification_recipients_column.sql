/*
  # Napraw kolumnę w triggerze notyfikacji zadań

  1. Problem
    - Trigger używa 'employee_id' w INSERT do notification_recipients
    - Tabela notification_recipients ma kolumnę 'user_id', nie 'employee_id'
    
  2. Rozwiązanie
    - Zmień INSERT żeby używał 'user_id' zamiast 'employee_id'
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_notify_task_status_change ON tasks;
DROP FUNCTION IF EXISTS notify_task_status_change();

-- Create updated notification trigger function with correct column name
CREATE OR REPLACE FUNCTION notify_task_status_change()
RETURNS TRIGGER AS $$
DECLARE
  assignee_name text;
  column_label text;
  notif_id uuid;
  changer_id uuid;
BEGIN
  -- Only notify if column changed
  IF OLD.board_column IS DISTINCT FROM NEW.board_column THEN
    -- Get the user who made the change (from current session)
    changer_id := auth.uid();
    
    -- Get changer name
    SELECT name || ' ' || surname INTO assignee_name
    FROM employees
    WHERE id = changer_id;
    
    -- If no name found, use default
    IF assignee_name IS NULL THEN
      assignee_name := 'Użytkownik';
    END IF;
    
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
      related_entity_type,
      related_entity_id,
      created_at
    ) VALUES (
      'Zmieniono status zadania',
      assignee_name || ' przeniósł(a) zadanie "' || NEW.title || '" do kolumny: ' || column_label,
      'tasks',
      'task',
      NEW.id::text,
      now()
    )
    RETURNING id INTO notif_id;
    
    -- Add recipients (creator and all assignees, except the one who made the change)
    -- FIXED: Use 'user_id' instead of 'employee_id'
    INSERT INTO notification_recipients (notification_id, user_id, is_read)
    SELECT 
      notif_id,
      e.id,
      false
    FROM (
      SELECT created_by as id FROM tasks WHERE id = NEW.id AND created_by IS NOT NULL
      UNION
      SELECT ta.employee_id as id 
      FROM task_assignees ta 
      WHERE ta.task_id = NEW.id
    ) e
    WHERE e.id IS NOT NULL
    AND e.id != changer_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for notifications
CREATE TRIGGER trigger_notify_task_status_change
  AFTER UPDATE OF board_column ON tasks
  FOR EACH ROW
  WHEN (OLD.board_column IS DISTINCT FROM NEW.board_column)
  EXECUTE FUNCTION notify_task_status_change();

COMMENT ON TRIGGER trigger_notify_task_status_change ON tasks IS 'Wysyła notyfikacje gdy zmieni się status zadania';
