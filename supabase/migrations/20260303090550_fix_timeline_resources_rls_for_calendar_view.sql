/*
  # Fix Timeline Resources RLS for Calendar View

  ## Problem
  Użytkownicy z uprawnieniem 'calendar_view' nie widzą zasobów (pojazdy, pracownicy, sprzęt)
  w widoku timeline, ponieważ polityki RLS wymagają 'fleet_manage', 'fleet_view', lub 'equipment_manage'.

  ## Rozwiązanie
  Dodaj uprawnienie 'calendar_view' do polityk SELECT dla:
  - vehicles (pojazdy)
  - employees (pracownicy)
  - equipment_items (sprzęt)
  - event_vehicles, event_equipment, employee_assignments

  ## Bezpieczeństwo
  - calendar_view może TYLKO czytać (SELECT)
  - Nie może modyfikować, dodawać ani usuwać
  - Dostęp tylko do podstawowych informacji potrzebnych w timeline
*/

-- ============================================================================
-- 1. VEHICLES - Dodaj calendar_view do polityk odczytu
-- ============================================================================

DROP POLICY IF EXISTS "fleet_view może przeglądać vehicles" ON vehicles;

CREATE POLICY "fleet_view i calendar_view mogą przeglądać vehicles"
  ON vehicles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        'admin' = ANY(permissions)
        OR 'fleet_manage' = ANY(permissions)
        OR 'fleet_view' = ANY(permissions)
        OR 'calendar_view' = ANY(permissions)
      )
    )
  );

-- ============================================================================
-- 2. EMPLOYEES - Upewnij się że wszyscy authenticated mają dostęp do listy
-- ============================================================================

DROP POLICY IF EXISTS "Wszyscy authenticated mogą czytać employees" ON employees;
DROP POLICY IF EXISTS "Employees can read all employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can read employees list" ON employees;

CREATE POLICY "Authenticated users can read employees list"
  ON employees FOR SELECT TO authenticated
  USING (true);

-- ============================================================================
-- 3. EQUIPMENT_ITEMS - Dodaj calendar_view do polityk odczytu
-- ============================================================================

DROP POLICY IF EXISTS "Admin i equipment_manage mogą zarządzać equipment_items" ON equipment_items;
DROP POLICY IF EXISTS "Equipment_manage can manage equipment_items" ON equipment_items;
DROP POLICY IF EXISTS "Users with equipment or calendar permissions can view equipment" ON equipment_items;

CREATE POLICY "Users with equipment or calendar permissions can view equipment"
  ON equipment_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        'admin' = ANY(permissions)
        OR 'equipment_manage' = ANY(permissions)
        OR 'equipment_view' = ANY(permissions)
        OR 'calendar_view' = ANY(permissions)
      )
    )
  );

-- ============================================================================
-- 4. EVENT_VEHICLES - Upewnij się że calendar_view ma dostęp
-- ============================================================================

DROP POLICY IF EXISTS "Users can view event_vehicles" ON event_vehicles;
DROP POLICY IF EXISTS "Users can view event vehicles" ON event_vehicles;

CREATE POLICY "Users can view event vehicles"
  ON event_vehicles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        'admin' = ANY(permissions)
        OR 'events_manage' = ANY(permissions)
        OR 'calendar_view' = ANY(permissions)
      )
    )
  );

-- ============================================================================
-- 5. EVENT_EQUIPMENT - Upewnij się że calendar_view ma dostęp
-- ============================================================================

DROP POLICY IF EXISTS "Users can view event_equipment" ON event_equipment;
DROP POLICY IF EXISTS "Users can view event equipment" ON event_equipment;

CREATE POLICY "Users can view event equipment"
  ON event_equipment FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        'admin' = ANY(permissions)
        OR 'events_manage' = ANY(permissions)
        OR 'calendar_view' = ANY(permissions)
      )
    )
  );

-- ============================================================================
-- 6. EMPLOYEE_ASSIGNMENTS - Upewnij się że calendar_view ma dostęp
-- ============================================================================

DROP POLICY IF EXISTS "Users can view employee_assignments" ON employee_assignments;
DROP POLICY IF EXISTS "Users can view employee assignments" ON employee_assignments;

CREATE POLICY "Users can view employee assignments"
  ON employee_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        'admin' = ANY(permissions)
        OR 'events_manage' = ANY(permissions)
        OR 'calendar_view' = ANY(permissions)
      )
    )
  );
