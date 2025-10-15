/*
  # Napraw polityki RLS dla equipment_categories

  1. Problem
    - Polityki sprawdzają tylko role='admin'
    - Nie sprawdzają uprawnień w kolumnie permissions (text[])
    
  2. Rozwiązanie
    - Zmień polityki żeby sprawdzały permissions[]
*/

-- Drop old restrictive policy
DROP POLICY IF EXISTS "Admins can manage categories" ON equipment_categories;

-- Allow INSERT/UPDATE/DELETE for admins and users with equipment_manage permission
CREATE POLICY "Users with equipment_manage can manage categories"
  ON equipment_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND (
        employees.role = 'admin' 
        OR 'equipment_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND (
        employees.role = 'admin' 
        OR 'equipment_manage' = ANY(employees.permissions)
      )
    )
  );

COMMENT ON POLICY "Users with equipment_manage can manage categories" ON equipment_categories IS 'Admini i użytkownicy z uprawnieniem equipment_manage mogą zarządzać kategoriami';
