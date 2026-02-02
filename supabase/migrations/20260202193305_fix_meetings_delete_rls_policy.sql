/*
  # Fix meetings UPDATE policy to allow soft delete

  ## Problem
  Polityka UPDATE dla meetings wymaga `deleted_at IS NULL` w `with_check`, 
  co blokuje soft delete (ustawienie deleted_at na timestamp).

  ## Rozwiązanie
  - Usuwamy warunek `deleted_at IS NULL` z `with_check`
  - Użytkownik może usunąć spotkanie jeśli:
    - Jest jego twórcą (created_by)
    - Ma uprawnienie calendar_manage
    - Jest adminem
*/

-- Drop starej polityki
DROP POLICY IF EXISTS "Users can update meetings" ON meetings;

-- Nowa polityka bez restrykcji deleted_at w with_check
CREATE POLICY "Users can update meetings"
  ON meetings
  FOR UPDATE
  TO authenticated
  USING (
    deleted_at IS NULL 
    AND (
      created_by = auth.uid() 
      OR EXISTS (
        SELECT 1 FROM employees emp
        WHERE emp.id = auth.uid()
        AND (
          emp.role = 'admin'
          OR 'calendar_manage' = ANY(emp.permissions)
        )
      )
    )
  )
  WITH CHECK (
    -- Pozwól na update jeśli użytkownik ma uprawnienia
    created_by = auth.uid() 
    OR EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
      )
    )
  );
