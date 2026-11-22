import { Employee } from '../lib/supabase';

type PermissionEmployee = Pick<Employee, 'access_level' | 'role' | 'permissions' | 'has_realizations'> | null | undefined;

// Jak w CRM (src/lib/permissions.ts): administrator to rola/poziom „admin” albo uprawnienie „admin”.
export const isAdmin = (employee: PermissionEmployee): boolean => {
  if (!employee) return false;
  return employee.access_level === 'admin' || employee.role === 'admin' || employee.permissions?.includes('admin') === true;
};

export const isManagerOrAdmin = (employee: PermissionEmployee): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;

  return (
    employee.access_level === 'manager' ||
    employee.role === 'manager' ||
    employee.permissions?.includes('events_manage') === true
  );
};

export const hasPermission = (employee: PermissionEmployee, scope: string): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  return employee.permissions?.includes(scope) || false;
};

export const canView = (employee: PermissionEmployee, module: string): boolean => {
  if (!employee) return false;
  if (isAdmin(employee)) return true;
  if (['events', 'calendar'].includes(module) && employee.has_realizations) return true;
  return hasPermission(employee, `${module}_view`) || hasPermission(employee, `${module}_manage`)
    || (['events', 'calendar'].includes(module) && hasPermission(employee, 'equipment_manage'))
    || module === 'time_tracking';
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

// Match CRM inquiry creation scopes, while requiring access to the inquiry module.
export const canCreateInquiry = (employee: PermissionEmployee): boolean =>
  canView(employee, 'inquiries') && (
    hasPermission(employee, 'inquiries_manage') ||
    hasPermission(employee, 'inquiries_manage_all') ||
    hasPermission(employee, 'tasks_create')
  );

export type ModuleName =
  | 'equipment'
  | 'employees'
  | 'clients'
  | 'contacts'
  | 'events'
  | 'calendar'
  | 'tasks'
  | 'inquiries'
  | 'offers'
  | 'contracts'
  | 'messages'
  | 'chat'
  | 'finances'
  | 'fleet'
  | 'page'
  | 'locations'
  | 'time_tracking'
  | 'databases'
  | 'invoices'
  | 'tenders';

export interface MenuItem {
  icon: string;
  label: string;
  screen: string;
  module?: ModuleName;
  /** Pozycja widoczna dla administratora albo przy dowolnym z uprawnień (jak `anyPermissions` w nawigacji CRM). */
  anyPermissions?: string[];
}

/** Social media (Marketing) — te same klucze co w CRM; zakres marek i akcji sprawdza serwer. */
export const SOCIAL_MEDIA_PERMISSIONS = ['marketing_social_view', 'marketing_social_create', 'marketing_social_approve', 'marketing_social_publish'];
/** Realizacje (Marketing → portfolio strony) — jak w CRM: edycja strony (`website_edit` albo `page_manage`). */
export const PORTFOLIO_PERMISSIONS = ['website_edit', 'page_manage'];
/** Strefa sprzedawcy → Prezentacje — jak w CRM: podgląd z dostępem do ofert albo „Prezentacje — podgląd”, przygotowanie — „Prezentacje — przygotowanie”. */
export const PRESENTATIONS_PERMISSIONS = ['presentations_view', 'presentations_manage', 'offers_view', 'offers_create', 'offers_manage'];
/** Materiały (baza plików firmy) — jak w CRM: „Materiały — podgląd” albo „Materiały — zarządzanie”; zakres marek sprawdza serwer. */
export const MATERIALS_PERMISSIONS = ['materials_view', 'materials_manage'];
/**
 * Dysk — jak pozycja „Dysk” w nawigacji CRM: dostęp do któregokolwiek działu (Eventy, Materiały, Oferty, Kalkulacje, Umowy,
 * Magazyn, Pracownicy); które działy widać — decyduje serwer (`/bridge/native/v1/drive?op=root`).
 */
export const DRIVE_PERMISSIONS = [
  ...MATERIALS_PERMISSIONS, 'events_view', 'events_view_planning', 'events_view_operational', 'events_manage', 'events_create', 'calendar_view',
  'offers_view', 'offers_create', 'offers_manage', 'contracts_view', 'contracts_manage', 'contracts_create', 'equipment_view', 'equipment_manage',
  'equipment_create', 'inquiries_view', 'inquiries_manage', 'inquiries_view_pool', 'inquiries_view_own', 'inquiries_manage_own', 'inquiries_view_team',
  'inquiries_manage_team', 'inquiries_view_all', 'inquiries_manage_all', 'employees_view', 'employees_manage', 'personnel_view', 'personnel_manage',
];

export const MENU_ITEMS: MenuItem[] = [
  { icon: 'home', label: 'Dashboard', screen: 'Dashboard' },
  { icon: 'calendar', label: 'Kalendarz', screen: 'Calendar', module: 'calendar' },
  { icon: 'coffee', label: 'Spotkania', screen: 'Meetings', module: 'calendar' },
  { icon: 'message-circle', label: 'Komunikator', screen: 'Messages', module: 'chat' },
  { icon: 'inbox', label: 'Wiadomości', screen: 'Inbox', module: 'messages' },
  { icon: 'book-open', label: 'Kontakty', screen: 'Clients', module: 'contacts' },
  { icon: 'star', label: 'Eventy', screen: 'Events', module: 'events' },
  { icon: 'hard-drive', label: 'Dysk', screen: 'Drive', anyPermissions: DRIVE_PERMISSIONS },
  { icon: 'check-square', label: 'Zadania', screen: 'Tasks', module: 'tasks' },
  { icon: 'phone-call', label: 'Zapytania', screen: 'Inquiries', module: 'inquiries' },
  { icon: 'tablet', label: 'Prezentacje', screen: 'Presentations', anyPermissions: PRESENTATIONS_PERMISSIONS },
  { icon: 'briefcase', label: 'Przetargi', screen: 'Tenders', module: 'tenders' },
  { icon: 'clock', label: 'Czas pracy', screen: 'TimeTracking', module: 'time_tracking' },
  { icon: 'users', label: 'Pracownicy', screen: 'Employees', module: 'employees' },
  { icon: 'truck', label: 'Flota', screen: 'Fleet', module: 'fleet' },
  { icon: 'package', label: 'Sprzęt', screen: 'Equipment', module: 'equipment' },
  { icon: 'image', label: 'Social media', screen: 'SocialMedia', anyPermissions: SOCIAL_MEDIA_PERMISSIONS },
  { icon: 'award', label: 'Realizacje', screen: 'Portfolio', anyPermissions: PORTFOLIO_PERMISSIONS },
  { icon: 'user', label: 'Profil', screen: 'Profile' },
  { icon: 'settings', label: 'Ustawienia', screen: 'Settings' },
];

export const getVisibleMenuItems = (employee: PermissionEmployee): MenuItem[] => {
  return MENU_ITEMS.filter((item) => {
    if (item.anyPermissions) return item.anyPermissions.some((scope) => hasPermission(employee, scope));
    if (!item.module) return true;
    return canView(employee, item.module);
  });
};

// Wartości finansowe wydarzeń: decyzja per wydarzenie w bazie (can_view_event_commercials) —
// patrz useEventCommercialsAccess w lib/eventCommercialsAccess.ts. Dawna reguła oparta na uprawnieniach
// (offers_*, invoices_*) pokazywała więcej niż CRM, więc została usunięta.
