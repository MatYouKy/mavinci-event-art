/*
  # Automatyczne przypisywanie autora do zadania i wypisywanie się z tasków

  1. Funkcjonalność
    - Autor zadania jest automatycznie dodawany do task_assignees
    - Trigger uruchamia się po INSERT na tasks
    - Autor otrzyma powiadomienia o komentarzach i zmianach
    - Użytkownicy mogą wypisać się z zadania (usunąć swoje przypisanie)
    - Autor może wypisać innych użytkowników z zadania

  2. Implementacja
    - Nowa funkcja: auto_assign_task_creator()
    - Trigger: trigger_auto_assign_task_creator
    - Aktualizacja polityk RLS dla task_assignees
*/

-- Funkcja do automatycznego przypisywania autora
CREATE OR REPLACE FUNCTION auto_assign_task_creator()
RETURNS TRIGGER AS $$
BEGIN
  -- Sprawdź czy zadanie ma twórcę
  IF NEW.created_by IS NOT NULL THEN
    -- Dodaj twórcę do task_assignees jeśli go tam nie ma
    INSERT INTO task_assignees (task_id, employee_id)
    VALUES (NEW.id, NEW.created_by)
    ON CONFLICT (task_id, employee_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger który uruchamia funkcję po utworzeniu zadania
DROP TRIGGER IF EXISTS trigger_auto_assign_task_creator ON tasks;

CREATE TRIGGER trigger_auto_assign_task_creator
  AFTER INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_task_creator();

-- Dodaj politykę RLS pozwalającą na wypisywanie się z tasków
DROP POLICY IF EXISTS "Users can remove themselves from tasks" ON task_assignees;

CREATE POLICY "Users can remove themselves from tasks"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (employee_id = auth.uid());

-- Dodaj politykę RLS pozwalającą autorowi na wypisywanie innych
DROP POLICY IF EXISTS "Task creator can remove assignees" ON task_assignees;

CREATE POLICY "Task creator can remove assignees"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_assignees.task_id
      AND tasks.created_by = auth.uid()
    )
  );
