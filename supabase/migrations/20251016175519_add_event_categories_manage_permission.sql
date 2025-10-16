/*
  # Add event_categories_manage permission

  1. Changes
    - Update RLS policies for event_categories table
    - Separate permission for managing event categories from events_manage
    - New permission: event_categories_manage
    
  2. Security
    - INSERT/UPDATE/DELETE on event_categories requires event_categories_manage permission
    - SELECT remains available to all authenticated users with events_manage
    
  3. Migration Notes
    - This allows granular control: users can manage events but not categories
    - Existing users with events_manage won't automatically get event_categories_manage
*/

-- Drop old policies
DROP POLICY IF EXISTS "Employees with events_manage can insert categories" ON event_categories;
DROP POLICY IF EXISTS "Employees with events_manage can update categories" ON event_categories;
DROP POLICY IF EXISTS "Employees with events_manage can delete categories" ON event_categories;

-- Create new policies with event_categories_manage permission
CREATE POLICY "Employees with event_categories_manage can insert categories"
  ON event_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with event_categories_manage can update categories"
  ON event_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with event_categories_manage can delete categories"
  ON event_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

-- Update SELECT policy to include event_categories_manage
DROP POLICY IF EXISTS "Authenticated employees can view event categories" ON event_categories;

CREATE POLICY "Authenticated employees can view event categories"
  ON event_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('events_manage' = ANY(employees.permissions) OR 'event_categories_manage' = ANY(employees.permissions))
    )
  );
