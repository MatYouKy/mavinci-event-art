/*
  # Remove Admin Permissions from All Users Except Mateusz

  1. Changes
    - Remove 'admin' permission from all users except Mateusz (mateusz@mavinci.pl)
    - Set role to 'employee' for non-admin users
    - Keep only minimal permissions: calendar_view, events_view, tasks_view

  2. Security
    - Only Mateusz (8f2b21d2-13c1-4d87-a783-95f524c6a01a) will have admin access
    - All other users will have limited view-only access by default
*/

-- Update all employees except Mateusz
UPDATE employees
SET 
  role = 'employee',
  permissions = ARRAY['calendar_view', 'events_view', 'tasks_view']::text[]
WHERE id != '8f2b21d2-13c1-4d87-a783-95f524c6a01a'
AND is_active = true;

-- Make sure Mateusz keeps admin role and permissions
UPDATE employees
SET 
  role = 'admin',
  permissions = array_remove(
    CASE 
      WHEN 'admin' = ANY(permissions) THEN permissions
      ELSE array_append(permissions, 'admin')
    END,
    NULL
  )
WHERE id = '8f2b21d2-13c1-4d87-a783-95f524c6a01a';

-- Verify changes
SELECT 
  id,
  name || ' ' || surname as full_name,
  email,
  role,
  permissions,
  CASE 
    WHEN role = 'admin' OR 'admin' = ANY(permissions) THEN 'ADMIN - widzi wszystko'
    WHEN 'events_manage' = ANY(permissions) OR 'calendar_manage' = ANY(permissions) THEN 'MANAGER - widzi wszystko'
    WHEN 'events_view' = ANY(permissions) OR 'calendar_view' = ANY(permissions) THEN 'EMPLOYEE - widzi tylko przypisane'
    ELSE 'NO ACCESS'
  END as access_level
FROM employees
WHERE is_active = true
ORDER BY 
  CASE 
    WHEN role = 'admin' THEN 1
    ELSE 2
  END,
  name;
