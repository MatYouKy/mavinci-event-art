/*
  # Grant locations_manage to users with locations_view

  1. Changes
    - Add `locations_manage` permission to all users who have `locations_view`
    - This allows users to create, update, and delete locations

  2. Rationale
    - Users who can view locations should also be able to manage them
    - Simplifies permission management
*/

-- Add locations_manage to all employees who have locations_view
UPDATE employees
SET permissions = array_append(permissions, 'locations_manage')
WHERE 'locations_view' = ANY(permissions)
  AND NOT ('locations_manage' = ANY(permissions));
