/*
  # Naprawa triggera powiadomień o komentarzach

  1. Problem
    - Trigger używał entity_type, ale kolumna to related_entity_type
    - Trigger używał entity_id, ale kolumna to related_entity_id
    - Trigger używał employee_id w recipients, ale kolumna to user_id

  2. Rozwiązanie
    - Zmiana wszystkich nazw kolumn na właściwe
*/

-- Naprawa funkcji do wysyłania powiadomień o nowych komentarzach
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
  JOIN employees e ON e.id = NEW.employee_id
  WHERE t.id = NEW.task_id;

  -- Utwórz główne powiadomienie
  INSERT INTO notifications (
    title,
    message,
    category,
    related_entity_type,
    related_entity_id
  )
  VALUES (
    'Nowy komentarz w zadaniu',
    v_comment_author_name || ' dodał komentarz do zadania: ' || v_task_title,
    'system',
    'task',
    NEW.task_id::text
  )
  RETURNING id INTO v_notification_id;

  -- Wyślij powiadomienie do twórcy taska (jeśli to nie autor komentarza)
  IF v_task_creator_id IS NOT NULL AND v_task_creator_id != NEW.employee_id THEN
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read
    )
    VALUES (
      v_notification_id,
      v_task_creator_id,
      FALSE
    )
    ON CONFLICT (notification_id, user_id) DO NOTHING;
  END IF;

  -- Wyślij powiadomienia do wszystkich przypisanych użytkowników (oprócz autora komentarza)
  FOR v_assignee_id IN
    SELECT DISTINCT ta.employee_id
    FROM task_assignees ta
    WHERE ta.task_id = NEW.task_id
    AND ta.employee_id != NEW.employee_id
  LOOP
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read
    )
    VALUES (
      v_notification_id,
      v_assignee_id,
      FALSE
    )
    ON CONFLICT (notification_id, user_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;