export interface NavigationItem {
  key: string;
  name: string;
  href: string;
  iconKey: string; // 👈 string, NIE komponent
  module?: string;
}

export const allNavigation: NavigationItem[] = [
  { key: 'dashboard', name: 'Dashboard', href: '/crm', iconKey: 'dashboard' },

  { key: 'calendar', name: 'Kalendarz', href: '/crm/calendar', iconKey: 'calendar', module: 'calendar' },
  { key: 'messages', name: 'Wiadomości', href: '/crm/messages', iconKey: 'messages', module: 'messages' },
  { key: 'contacts', name: 'Kontakty', href: '/crm/contacts', iconKey: 'contacts', module: 'clients' },
  { key: 'events', name: 'Eventy', href: '/crm/events', iconKey: 'events', module: 'events' },
  { key: 'offers', name: 'Oferty', href: '/crm/offers', iconKey: 'offers', module: 'offers' },
  { key: 'contracts', name: 'Umowy', href: '/crm/contracts', iconKey: 'contracts', module: 'contracts' },
  { key: 'invoices', name: 'Faktury', href: '/crm/invoices', iconKey: 'invoices', module: 'finances' },
  { key: 'employees', name: 'Pracownicy', href: '/crm/employees', iconKey: 'employees', module: 'employees' },
  { key: 'equipment', name: 'Magazyn', href: '/crm/equipment', iconKey: 'equipment', module: 'equipment' },
  { key: 'fleet', name: 'Flota', href: '/crm/fleet', iconKey: 'fleet', module: 'fleet' },
  { key: 'tasks', name: 'Zadania', href: '/crm/tasks', iconKey: 'tasks', module: 'tasks' },
  { key: 'time-tracking', name: 'Czas pracy', href: '/crm/time-tracking', iconKey: 'time', module: 'time_tracking' },
  { key: 'page', name: 'Strona', href: '/crm/page', iconKey: 'page', module: 'page' },
  { key: 'locations', name: 'Lokalizacje', href: '/crm/locations', iconKey: 'locations', module: 'locations' },
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