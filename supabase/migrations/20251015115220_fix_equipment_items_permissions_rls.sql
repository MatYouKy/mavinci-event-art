/*
  # Napraw polityki RLS dla equipment_items

  1. Problem
    - Polityki sprawdzają tylko role='admin'
    - Nie sprawdzają uprawnień w kolumnie permissions (text[])
    - Employeer z uprawnieniem 'equipment_manage' nie może edytować
    
  2. Rozwiązanie
    - Zmień polityki żeby sprawdzały:
      - role='admin' LUB 
      - 'equipment_manage' w permissions[]
*/

-- Drop old restrictive policies
DROP POLICY IF EXISTS "Admins can manage equipment" ON equipment_items;
DROP POLICY IF EXISTS "Authenticated users can view equipment" ON equipment_items;

-- Allow SELECT for all authenticated users
CREATE POLICY "Authenticated users can view equipment"
  ON equipment_items
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow INSERT for admins and users with equipment_manage permission
CREATE POLICY "Users with equipment_manage can insert equipment"
  ON equipment_items
  FOR INSERT
  TO authenticated
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

-- Allow UPDATE for admins and users with equipment_manage permission
CREATE POLICY "Users with equipment_manage can update equipment"
  ON equipment_items
  FOR UPDATE
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

-- Allow DELETE for admins and users with equipment_manage permission
CREATE POLICY "Users with equipment_manage can delete equipment"
  ON equipment_items
  FOR DELETE
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
  );

COMMENT ON POLICY "Users with equipment_manage can insert equipment" ON equipment_items IS 'Admini i użytkownicy z uprawnieniem equipment_manage mogą dodawać sprzęt';
COMMENT ON POLICY "Users with equipment_manage can update equipment" ON equipment_items IS 'Admini i użytkownicy z uprawnieniem equipment_manage mogą edytować sprzęt';
COMMENT ON POLICY "Users with equipment_manage can delete equipment" ON equipment_items IS 'Admini i użytkownicy z uprawnieniem equipment_manage mogą usuwać sprzęt';
