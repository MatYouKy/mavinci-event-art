/*
  # Cleanup zduplikowanych polityk RLS dla employees
  
  Problem: Są 3 duplikaty polityki SELECT dla employees
  
  Rozwiązanie:
  - Usunięcie wszystkich istniejących polityk SELECT
  - Stworzenie jednej, jasnej polityki: wszyscy authenticated mogą czytać
*/

-- Usuń wszystkie istniejące polityki SELECT dla employees
DROP POLICY IF EXISTS "Allow authenticated users to view employees" ON employees;
DROP POLICY IF EXISTS "Authenticated can view all employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can view employees" ON employees;
DROP POLICY IF EXISTS "Public can view website employees" ON employees;

-- Jedna polityka SELECT: authenticated mogą czytać wszystko
CREATE POLICY "Authenticated users can view all employees"
  ON employees
  FOR SELECT
  TO authenticated
  USING (true);

-- Public mogą zobaczyć tylko tych na stronie
CREATE POLICY "Public can view website employees"
  ON employees
  FOR SELECT
  TO anon
  USING (show_on_website = true);

COMMENT ON POLICY "Authenticated users can view all employees" ON employees IS 
'All authenticated users can view employee data (needed for calendar, tasks, assignments, events, etc.)';

COMMENT ON POLICY "Public can view website employees" ON employees IS 
'Anonymous users can only see employees marked as visible on website';
