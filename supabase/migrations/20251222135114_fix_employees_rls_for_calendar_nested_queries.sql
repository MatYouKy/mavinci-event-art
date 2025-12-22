/*
  # Fix employees RLS for calendar nested queries
  
  Problem: When fetching meetings with nested participants and employees,
  the employees table RLS may block access to employee details.
  
  Solution: Allow all authenticated users to view basic employee info
  (needed for calendar, tasks, assignments, etc.)
*/

DROP POLICY IF EXISTS "Allow authenticated users to view employees" ON employees;

CREATE POLICY "Allow authenticated users to view employees"
  ON employees
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY "Allow authenticated users to view employees" ON employees IS 
'All authenticated users can view employee data (needed for calendar, tasks, assignments)';
