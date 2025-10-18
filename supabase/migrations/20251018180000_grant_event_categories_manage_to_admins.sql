/*
  # Grant event_categories_manage permission to admins

  1. Changes
    - Add event_categories_manage to all employees with is_admin = true
    - Ensure the permission exists in the permissions array
*/

-- Add event_categories_manage permission to all admin users
UPDATE employees
SET permissions = array_append(permissions, 'event_categories_manage')
WHERE is_admin = true
AND NOT ('event_categories_manage' = ANY(permissions));
