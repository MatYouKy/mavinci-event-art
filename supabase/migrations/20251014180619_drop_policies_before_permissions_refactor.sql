/*
  # Usunięcie polityk RLS używających kolumny permissions
  
  ## Zmiany
  - Usunięcie polityk z equipment_edit_history
  - Usunięcie polityk z employee_permissions
  - Zostaną one odtworzone po zmianie typu kolumny
*/

-- Drop policies from equipment_edit_history
DROP POLICY IF EXISTS "Authorized employees can view edit history" ON equipment_edit_history;

-- Drop policies from employee_permissions
DROP POLICY IF EXISTS "Admins and authorized users can insert permissions" ON employee_permissions;
DROP POLICY IF EXISTS "Admins and authorized users can update permissions" ON employee_permissions;
DROP POLICY IF EXISTS "Admins and authorized users can delete permissions" ON employee_permissions;