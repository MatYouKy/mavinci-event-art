/*
  # Dodaj powiadomienia o nowych komentarzach w taskach

  1. Nowe funkcje
    - Funkcja triggerująca powiadomienia o nowych komentarzach

  2. Triggery
    - Trigger na task_comments - wysyła powiadomienie do przypisanych użytkowników

  3. Bezpieczeństwo
    - Powiadomienia tylko dla przypisanych użytkowników i twórcy taska
*/

-- Funkcja do wysyłania powiadomień o nowych komentarzach
CREATE OR REPLACE FUNCTION notify_task_comment()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_title TEXT;
  v_comment_author_name TEXT;
  v_assignee_id UUID;
  v_notification_id UUID;
  v_task_creator_id UUID;
BEGIN
  -- Pobierz dane o tasku i autorze komentarza
  SELECT
    t.title,
    t.created_by,
    COALESCE(e.nickname, e.name || ' ' || e.surname)
  INTO v_task_title, v_task_creator_id, v_comment_author_name
  FROM tasks t
  JOIN employees e ON e.id = NEW.created_by
  WHERE t.id = NEW.task_id;

  -- Utwórz główne powiadomienie
  INSERT INTO notifications (
    title,
    message,
    category,
    entity_type,
    entity_id,
    created_by
  )
  VALUES (
    'Nowy komentarz w zadaniu',
    v_comment_author_name || ' dodał komentarz do zadania: ' || v_task_title,
    'task_comment',
    'task',
    NEW.task_id,
    NEW.created_by
  )
  RETURNING id INTO v_notification_id;

  -- Wyślij powiadomienie do twórcy taska (jeśli to nie autor komentarza)
  IF v_task_creator_id IS NOT NULL AND v_task_creator_id != NEW.created_by THEN
    INSERT INTO notification_recipients (
      notification_id,
      employee_id,
      is_read
    )
    VALUES (
      v_notification_id,
      v_task_creator_id,
      FALSE
    )
    ON CONFLICT (notification_id, employee_id) DO NOTHING;
  END IF;

  -- Wyślij powiadomienia do wszystkich przypisanych użytkowników (oprócz autora komentarza)
  FOR v_assignee_id IN
    SELECT DISTINCT ta.employee_id
    FROM task_assignees ta
    WHERE ta.task_id = NEW.task_id
    AND ta.employee_id != NEW.created_by
  LOOP
    INSERT INTO notification_recipients (
      notification_id,
      employee_id,
      is_read
    )
    VALUES (
      v_notification_id,
      v_assignee_id,
      FALSE
    )
    ON CONFLICT (notification_id, employee_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Trigger na task_comments
DROP TRIGGER IF EXISTS task_comment_notification_trigger ON task_comments;
CREATE TRIGGER task_comment_notification_trigger
  AFTER INSERT ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_comment();
