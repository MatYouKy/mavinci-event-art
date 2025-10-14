/**
 * Permission Scope System
 *
 * Format: permissions są przechowywane jako TEXT[] array z scope
 * Każdy scope ma format: [module]_[action]
 *
 * Dostępne scope:
 * - equipment_view, equipment_manage
 * - employees_view, employees_manage, employees_permissions
 * - clients_view, clients_manage
 * - events_view, events_manage
 * - calendar_view, calendar_manage
 * - tasks_view, tasks_manage
 * - offers_view, offers_manage
 * - contracts_view, contracts_manage
 * - attractions_view, attractions_manage
 * - messages_view, messages_manage
 * - financials_view, financials_manage
 */

export interface Employee {
  id: string;
  access_level?: string;
  role?: string;
  permissions?: string[];
}

/**
 * Sprawdza czy użytkownik jest adminem
 */
export const isAdmin = (employee: Employee | null | undefined): boolean => {
  if (!employee) return false;
  return (
    employee.access_level === 'admin' ||
    employee.role === 'admin'
  );
};

/**
 * Sprawdza czy użytkownik ma konkretny scope permission
 */
export const hasPermission = (
  employee: Employee | null | undefined,
  scope: string
): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return employee.permissions?.includes(scope) || false;
};

/**
 * Sprawdza czy użytkownik może przeglądać dany moduł
 * Zwraca true jeśli ma [module]_view lub [module]_manage
 */
export const canView = (
  employee: Employee | null | undefined,
  module: string
): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return (
    hasPermission(employee, `${module}_view`) ||
    hasPermission(employee, `${module}_manage`)
  );
};

/**
 * Sprawdza czy użytkownik może zarządzać danym modułem
 * Zwraca true jeśli ma [module]_manage (edycja i usuwanie)
 */
export const canManage = (
  employee: Employee | null | undefined,
  module: string
): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return hasPermission(employee, `${module}_manage`);
};

/**
 * Sprawdza czy użytkownik może zarządzać uprawnieniami pracowników
 */
export const canManagePermissions = (
  employee: Employee | null | undefined
): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return hasPermission(employee, 'employees_permissions');
};

/**
 * Zwraca listę wszystkich dostępnych scope dla danego modułu
 */
export const getModuleScopes = (module: string): string[] => {
  return [`${module}_view`, `${module}_manage`];
};

/**
 * Lista wszystkich modułów w systemie
 */
export const MODULES = [
  'equipment',
  'employees',
  'clients',
  'events',
  'calendar',
  'tasks',
  'offers',
  'contracts',
  'attractions',
  'messages',
  'financials',
] as const;

export type ModuleName = typeof MODULES[number];

/**
 * Zwraca wszystkie możliwe scope permissions
 */
export const getAllScopes = (): string[] => {
  const scopes: string[] = [];
  MODULES.forEach(module => {
    scopes.push(`${module}_view`, `${module}_manage`);
  });
  scopes.push('employees_permissions');
  return scopes;
};
