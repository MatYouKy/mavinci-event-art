/*
  # Allow databases_view to create their own databases

  1. Changes
    - Update INSERT policy for custom_databases
    - Users with databases_view can now create databases
    - They will only see their own databases (already handled in SELECT policy)
    - Admin can share these databases with others using database_shares table

  2. Security
    - databases_view can create databases (set created_by to their own user_id)
    - databases_view can only see their own databases + shared ones
    - databases_manage can see all databases
    - Admin can share any database with anyone
*/

-- Drop old INSERT policy
DROP POLICY IF EXISTS "Users can create databases if they have permission" ON custom_databases;

-- Create new INSERT policy allowing databases_view to create
CREATE POLICY "Users with view or manage permission can create databases"
  ON custom_databases FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'databases_view' = ANY(employees.permissions)
        OR 'databases_manage' = ANY(employees.permissions)
      )
    )
  );

-- Ensure created_by is always set to the current user
-- This prevents users from creating databases "on behalf" of others
CREATE OR REPLACE FUNCTION set_database_created_by()
RETURNS TRIGGER AS $$
BEGIN
  NEW.created_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS ensure_database_created_by ON custom_databases;

-- Create trigger to auto-set created_by
CREATE TRIGGER ensure_database_created_by
  BEFORE INSERT ON custom_databases
  FOR EACH ROW
  EXECUTE FUNCTION set_database_created_by();