/*
  # Usunięcie starej tabeli employee_permissions

  ## Zmiany
  - DROP TABLE employee_permissions - ta tabela była używana w starym systemie
  - Nowy system używa employees.permissions jako TEXT[] array
  
  ## Uzasadnienie
  - Stara tabela miała kolumny can_view_*, can_edit_*, can_delete_*
  - Nowy system używa scope: ['equipment_view', 'equipment_manage', ...]
  - Duplikacja danych - niepotrzebna
*/

-- Usuń tabelę employee_permissions
DROP TABLE IF EXISTS employee_permissions CASCADE;