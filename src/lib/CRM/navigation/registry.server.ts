import 'server-only';

/**
 * To jest typ, który przechodzi z serwera na klienta.
 * Nie ma tu komponentów, tylko JSON-safe dane.
 */
export type NavKey =
  | 'dashboard'
  | 'calendar'
  | 'events'
  | 'messages'
  | 'tasks'
  | 'employees'
  | 'offers'
  | 'contacts'
  | 'contracts'
  | 'equipment'
  | 'fleet'
  | 'page'
  | 'invoices'
  | 'locations'
  | 'time-tracking'
  | 'databases';

export type NavigationItemDTO = {
  key: NavKey;
  name: string;
  href: string;
  iconKey: string; // string, bo to leci do klienta przez JSON
  module?: string;
  permissions?: string[]; // do filtrowania po uprawnieniach
};

export const allNavigation: NavigationItemDTO[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    href: '/crm',
    iconKey: 'dashboard',
    permissions: ['dashboard_view'],
  },
  {
    key: 'calendar',
    name: 'Kalendarz',
    href: '/crm/calendar',
    iconKey: 'calendar',
    module: 'calendar',
    permissions: ['calendar_view'],
  },
  {
    key: 'events',
    name: 'Eventy',
    href: '/crm/events',
    iconKey: 'events',
    module: 'events',
    permissions: ['events_view'],
  },
  {
    key: 'messages',
    name: 'Wiadomości',
    href: '/crm/messages',
    iconKey: 'messages',
    module: 'messages',
    permissions: ['messages_view'],
  },
  {
    key: 'tasks',
    name: 'Zadania',
    href: '/crm/tasks',
    iconKey: 'tasks',
    module: 'tasks',
    permissions: ['tasks_view'],
  },
  {
    key: 'employees',
    name: 'Pracownicy',
    href: '/crm/employees',
    iconKey: 'employees',
    module: 'employees',
    permissions: ['employees_view'],
  },
  {
    key: 'offers',
    name: 'Oferty',
    href: '/crm/offers',
    iconKey: 'offers',
    module: 'offers',
    permissions: ['offers_view'],
  },
  {
    key: 'contacts',
    name: 'Kontakty',
    href: '/crm/contacts',
    iconKey: 'contacts',
    module: 'clients',
    permissions: ['contacts_view'],
  },
  {
    key: 'contracts',
    name: 'Umowy',
    href: '/crm/contracts',
    iconKey: 'contracts',
    module: 'contracts',
    permissions: ['contracts_view'],
  },
  {
    key: 'equipment',
    name: 'Magazyn',
    href: '/crm/equipment',
    iconKey: 'equipment',
    module: 'equipment',
    permissions: ['equipment_view'],
  },
  {
    key: 'fleet',
    name: 'Flota',
    href: '/crm/fleet',
    iconKey: 'fleet',
    module: 'fleet',
    permissions: ['fleet_view'],
  },
  {
    key: 'page',
    name: 'Strona',
    href: '/crm/page',
    iconKey: 'page',
    module: 'page',
    permissions: ['page_view'],
  },
  {
    key: 'invoices',
    name: 'Faktury',
    href: '/crm/invoices',
    iconKey: 'invoices',
    module: 'finances',
    permissions: ['finances_view'],
  },
  {
    key: 'locations',
    name: 'Lokalizacje',
    href: '/crm/locations',
    iconKey: 'locations',
    module: 'locations',
    permissions: ['locations_view'],
  },
  {
    key: 'time-tracking',
    name: 'Czas pracy',
    href: '/crm/time-tracking',
    iconKey: 'time', // <— ważne: iconKey to klucz mapy ikon, nie musi = key
    module: 'time_tracking',
    permissions: ['time_tracking_view'],
  },
  {
    key: 'databases',
    name: 'Bazy Danych',
    href: '/crm/databases',
    iconKey: 'databases',
    module: 'databases',
    permissions: ['databases_view'],
  },
];