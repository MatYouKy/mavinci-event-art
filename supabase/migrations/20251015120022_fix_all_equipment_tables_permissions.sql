/*
  # Napraw polityki RLS dla wszystkich tabel equipment

  1. Problem
    - equipment_stock - tylko admini mogą INSERT/DELETE
    - equipment_components - tylko admini mogą zarządzać
    - equipment_gallery - tylko admini mogą zarządzać
    - Nie sprawdzają uprawnień w permissions[]
    
  2. Rozwiązanie
    - Dodaj sprawdzanie 'equipment_manage' w permissions[] dla wszystkich tabel
*/

-- ============================================
-- equipment_stock
-- ============================================
DROP POLICY IF EXISTS "Admins can manage stock" ON equipment_stock;
DROP POLICY IF EXISTS "Employees can update stock" ON equipment_stock;

-- Allow INSERT for admins and users with equipment_manage
CREATE POLICY "Users with equipment_manage can insert stock"
  ON equipment_stock
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

-- Allow UPDATE for admins and users with equipment_manage
CREATE POLICY "Users with equipment_manage can update stock"
  ON equipment_stock
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

-- Allow DELETE for admins and users with equipment_manage
CREATE POLICY "Users with equipment_manage can delete stock"
  ON equipment_stock
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

-- ============================================
-- equipment_components
-- ============================================
DROP POLICY IF EXISTS "Admins can manage components" ON equipment_components;

CREATE POLICY "Users with equipment_manage can manage components"
  ON equipment_components
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

-- ============================================
-- equipment_gallery
-- ============================================
DROP POLICY IF EXISTS "Admins can manage gallery" ON equipment_gallery;

CREATE POLICY "Users with equipment_manage can manage gallery"
  ON equipment_gallery
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

-- ============================================
-- Comments
-- ============================================
COMMENT ON POLICY "Users with equipment_manage can insert stock" ON equipment_stock IS 'Admini i użytkownicy z equipment_manage mogą dodawać stan magazynowy';
COMMENT ON POLICY "Users with equipment_manage can update stock" ON equipment_stock IS 'Admini i użytkownicy z equipment_manage mogą aktualizować stan magazynowy';
COMMENT ON POLICY "Users with equipment_manage can delete stock" ON equipment_stock IS 'Admini i użytkownicy z equipment_manage mogą usuwać stan magazynowy';
COMMENT ON POLICY "Users with equipment_manage can manage components" ON equipment_components IS 'Admini i użytkownicy z equipment_manage mogą zarządzać komponentami';
COMMENT ON POLICY "Users with equipment_manage can manage gallery" ON equipment_gallery IS 'Admini i użytkownicy z equipment_manage mogą zarządzać galerią';
