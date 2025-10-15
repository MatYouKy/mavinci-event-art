/*
  # Finalizuj prywatne zadania z sortowaniem
  
  1. Problem
    - Kolumny is_private i owner_id istnieją ale brak indeksów i polityk
    - Zadania nie są sortowane po priorytecie i terminie
    - Prywatne zadania z profilu pojawiają się w globalnych
    
  2. Rozwiązanie
    - Dodaj indeksy dla performance
    - Zaktualizuj polityki RLS
    - Dodaj indeksy dla sortowania
*/

-- Indeksy dla prywatnych zadań
CREATE INDEX IF NOT EXISTS idx_tasks_owner_private ON tasks(owner_id, is_private);
CREATE INDEX IF NOT EXISTS idx_tasks_is_private ON tasks(is_private);

-- Indeksy dla sortowania po priorytecie i terminie
CREATE INDEX IF NOT EXISTS idx_tasks_priority_due_date ON tasks(priority DESC, due_date ASC NULLS LAST);

-- Drop old policies
DROP POLICY IF EXISTS "Authenticated users can view their tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can insert tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can update tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can delete tasks" ON tasks;

-- SELECT: Zobacz globalne + swoje prywatne + zadania gdzie jesteś przypisany
CREATE POLICY "Users can view accessible tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    -- Globalne zadania (widoczne dla wszystkich)
    is_private = false 
    OR 
    -- Swoje prywatne zadania
    (is_private = true AND owner_id = auth.uid())
    OR
    -- Zadania gdzie jesteś przypisany (przez task_assignees)
    EXISTS (
      SELECT 1 FROM task_assignees 
      WHERE task_assignees.task_id = tasks.id 
      AND task_assignees.employee_id = auth.uid()
    )
  );

-- INSERT: Możesz tworzyć globalne (jeśli masz uprawnienia) lub swoje prywatne
CREATE POLICY "Users can insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Prywatne zadania: tylko swoje
    (is_private = true AND owner_id = auth.uid())
    OR 
    -- Globalne zadania: jeśli masz uprawnienie tasks_manage
    (
      is_private = false 
      AND EXISTS (
        SELECT 1 FROM employees 
        WHERE employees.id = auth.uid() 
        AND (
          employees.role = 'admin' 
          OR 'tasks_manage' = ANY(employees.permissions)
        )
      )
    )
  );

-- UPDATE: Możesz edytować swoje prywatne lub globalne (jeśli masz uprawnienia)
CREATE POLICY "Users can update their tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    -- Swoje prywatne zadania
    (is_private = true AND owner_id = auth.uid())
    OR 
    -- Globalne zadania z uprawnieniami
    (
      is_private = false 
      AND EXISTS (
        SELECT 1 FROM employees 
        WHERE employees.id = auth.uid() 
        AND (
          employees.role = 'admin' 
          OR 'tasks_manage' = ANY(employees.permissions)
        )
      )
    )
  )
  WITH CHECK (
    (is_private = true AND owner_id = auth.uid())
    OR 
    (
      is_private = false 
      AND EXISTS (
        SELECT 1 FROM employees 
        WHERE employees.id = auth.uid() 
        AND (
          employees.role = 'admin' 
          OR 'tasks_manage' = ANY(employees.permissions)
        )
      )
    )
  );

-- DELETE: Możesz usuwać swoje prywatne lub globalne (jeśli masz uprawnienia)
CREATE POLICY "Users can delete their tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    (is_private = true AND owner_id = auth.uid())
    OR 
    (
      is_private = false 
      AND EXISTS (
        SELECT 1 FROM employees 
        WHERE employees.id = auth.uid() 
        AND (
          employees.role = 'admin' 
          OR 'tasks_manage' = ANY(employees.permissions)
        )
      )
    )
  );

COMMENT ON COLUMN tasks.is_private IS 'Określa czy zadanie jest prywatne (true) czy globalne (false)';
COMMENT ON COLUMN tasks.owner_id IS 'Właściciel prywatnego zadania - tylko dla is_private = true';
