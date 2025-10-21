/*
  # Naprawa usuwania zadań i time_entries

  1. Problem
    - Usuwanie zadania powoduje błąd przez constraint time_entry_has_task_or_title
    - Gdy task_id jest ustawiony na NULL (ON DELETE SET NULL), constraint wymaga title
    - Brak uprawnień do usuwania zadań dla użytkowników z permissions

  2. Rozwiązanie
    - Zmień ON DELETE SET NULL na ON DELETE CASCADE dla time_entries
    - Dodaj polityki RLS do usuwania zadań dla użytkowników z uprawnieniami
*/

-- Usuń istniejący foreign key dla task_id w time_entries
ALTER TABLE time_entries 
  DROP CONSTRAINT IF EXISTS time_entries_task_id_fkey;

-- Dodaj nowy foreign key z CASCADE
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_task_id_fkey 
  FOREIGN KEY (task_id) 
  REFERENCES tasks(id) 
  ON DELETE CASCADE;

-- Dodaj polityki RLS do usuwania zadań
-- Właściciel prywatnego zadania może je usunąć
CREATE POLICY "Właściciel może usunąć prywatne zadanie"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    is_private = true 
    AND owner_id = auth.uid()
  );

-- Użytkownicy z uprawnieniami tasks_manage mogą usuwać publiczne zadania
CREATE POLICY "Użytkownicy z tasks_manage mogą usuwać zadania"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'tasks_manage' = ANY(employees.permissions)
      )
    )
  );

-- Twórca zadania może je usunąć
CREATE POLICY "Twórca może usunąć swoje zadanie"
  ON tasks FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- Użytkownicy przypisani do zadania mogą je usunąć jeśli mają uprawnienie tasks_view
CREATE POLICY "Przypisani użytkownicy mogą usunąć zadanie"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = tasks.id
      AND task_assignees.employee_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_view' = ANY(employees.permissions)
    )
  );
