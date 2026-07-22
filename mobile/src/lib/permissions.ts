import { Employee } from '../lib/supabase';

type PermissionEmployee = Pick<Employee, 'access_level' | 'role' | 'permissions'> | null | undefined;

export const isAdmin = (employee: PermissionEmployee): boolean => {
  if (!employee) return false;
  return employee.access_level === 'admin' || employee.role === 'admin';
};

export const hasPermission = (employee: PermissionEmployee, scope: string): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return employee.permissions?.includes(scope) || false;
};

export const canView = (employee: PermissionEmployee, module: string): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return hasPermission(employee, `${module}_view`) || hasPermission(employee, `${module}_manage`);
};

export const canManage = (employee: PermissionEmployee, module: string): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return hasPermission(employee, `${module}_manage`);
};

export const canCreate = (employee: PermissionEmployee, module: string): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return hasPermission(employee, `${module}_create`) || hasPermission(employee, `${module}_manage`);
};

export type ModuleName =
  | 'equipment'
  | 'employees'
  | 'clients'
  | 'contacts'
  | 'events'
  | 'calendar'
  | 'tasks'
  | 'offers'
  | 'contracts'
  | 'messages'
  | 'finances'
  | 'fleet'
  | 'page'
  | 'locations'
  | 'time_tracking'
  | 'databases'
  | 'invoices';

export interface MenuItem {
  icon: string;
  label: string;
  screen: string;
  module?: ModuleName;
}

export const MENU_ITEMS: MenuItem[] = [
  { icon: 'home', label: 'Dashboard', screen: 'Dashboard' },
  { icon: 'calendar', label: 'Kalendarz', screen: 'Calendar', module: 'calendar' },
  { icon: 'message-circle', label: 'Komunikator', screen: 'Messages', module: 'messages' },
  { icon: 'star', label: 'Wydarzenia', screen: 'Events', module: 'events' },
  { icon: 'check-square', label: 'Zadania', screen: 'Tasks', module: 'tasks' },
  { icon: 'clock', label: 'Czas pracy', screen: 'TimeTracking', module: 'time_tracking' },
  { icon: 'users', label: 'Pracownicy', screen: 'Employees', module: 'employees' },
  { icon: 'package', label: 'Sprzęt', screen: 'Equipment', module: 'equipment' },
  { icon: 'user', label: 'Profil', screen: 'Profile' },
  { icon: 'settings', label: 'Ustawienia', screen: 'Settings' },
];

export const getVisibleMenuItems = (employee: PermissionEmployee): MenuItem[] => {
  return MENU_ITEMS.filter((item) => {
    if (!item.module) return true;
    return canView(employee, item.module);
  });
};
