/*
  # Grant databases permissions to admin users

  1. Updates
    - Add 'databases_view' and 'databases_manage' permissions to users with 'admin' permission
    
  2. Notes
    - This is optional - admins already have full access via RLS
    - But it's cleaner to explicitly grant these permissions for UI/UX purposes
*/

-- Update employees with admin permission to also have databases permissions
UPDATE employees
SET permissions = array_append(
  array_append(permissions, 'databases_view'),
  'databases_manage'
)
WHERE 'admin' = ANY(permissions)
  AND NOT ('databases_view' = ANY(permissions))
  AND NOT ('databases_manage' = ANY(permissions));
