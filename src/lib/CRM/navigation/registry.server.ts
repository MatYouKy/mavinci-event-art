export type NavKey =
  | 'dashboard'
  | 'calendar'
  | 'messages'
  | 'contacts'
  | 'events'
  | 'offers'
  | 'contracts'
  | 'invoices'
  | 'employees'
  | 'equipment'
  | 'fleet'
  | 'tasks'
  | 'time-tracking'
  | 'page'
  | 'locations';

export interface NavigationItem {
  key: string;
  name: string;
  href: string;
  iconKey: string; // 👈 string, NIE komponent
  module?: string;
  permissions?: string[];
}

export const allNavigation: NavigationItem[] = [
  { key: 'dashboard', name: 'Dashboard', href: '/crm', iconKey: 'dashboard', permissions: ['dashboard_view'] },

  { key: 'calendar', name: 'Kalendarz', href: '/crm/calendar', iconKey: 'calendar', module: 'calendar', permissions: ['calendar_view'] },
  { key: 'messages', name: 'Wiadomości', href: '/crm/messages', iconKey: 'messages', module: 'messages', permissions: ['messages_view'] },
  { key: 'contacts', name: 'Kontakty', href: '/crm/contacts', iconKey: 'contacts', module: 'clients', permissions: ['clients_view'] },
  { key: 'events', name: 'Eventy', href: '/crm/events', iconKey: 'events', module: 'events', permissions: ['events_view'] },
  { key: 'offers', name: 'Oferty', href: '/crm/offers', iconKey: 'offers', module: 'offers', permissions: ['offers_view'] },
  { key: 'contracts', name: 'Umowy', href: '/crm/contracts', iconKey: 'contracts', module: 'contracts', permissions: ['contracts_view'] },
  { key: 'invoices', name: 'Faktury', href: '/crm/invoices', iconKey: 'invoices', module: 'finances', permissions: ['finances_view'] },
  { key: 'employees', name: 'Pracownicy', href: '/crm/employees', iconKey: 'employees', module: 'employees', permissions: ['employees_view'] },
  { key: 'equipment', name: 'Magazyn', href: '/crm/equipment', iconKey: 'equipment', module: 'equipment', permissions: ['equipment_view'] },
  { key: 'fleet', name: 'Flota', href: '/crm/fleet', iconKey: 'fleet', module: 'fleet', permissions: ['fleet_view'] },
  { key: 'tasks', name: 'Zadania', href: '/crm/tasks', iconKey: 'tasks', module: 'tasks', permissions: ['tasks_view'] },
  { key: 'time-tracking', name: 'Czas pracy', href: '/crm/time-tracking', iconKey: 'time', module: 'time_tracking', permissions: ['time_tracking_view'] },
  { key: 'page', name: 'Strona', href: '/crm/page', iconKey: 'page', module: 'page', permissions: ['page_view'] },
  { key: 'locations', name: 'Lokalizacje', href: '/crm/locations', iconKey: 'locations', module: 'locations', permissions: ['locations_view'] },
];

import {
  Calendar,
  Users,
  Package,
  FileText,
  CheckSquare,
  Mail,
  LayoutDashboard,
  Receipt,
  Globe,
  MapPin,
  Car,
  Clock,
  BookUser,
  FileSignature,
} from 'lucide-react';

export const NavigationIcons: Record<string, any> = {
  dashboard: LayoutDashboard,
  calendar: Calendar,
  messages: Mail,
  contacts: BookUser,
  events: Calendar,
  offers: FileText,
  contracts: FileSignature,
  invoices: Receipt,
  employees: Users,
  equipment: Package,
  fleet: Car,
  tasks: CheckSquare,
  time: Clock,
  page: Globe,
  locations: MapPin,
};