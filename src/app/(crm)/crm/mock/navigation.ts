export interface NavigationItem {
  key: string;
  name: string;
  href: string;
  iconKey: string; // 👈 string, NIE komponent
  module?: string;
  children?: NavigationItem[];
}

export const allNavigation: NavigationItem[] = [
  { key: 'dashboard', name: 'Dashboard', href: '/crm', iconKey: 'dashboard' },

  { key: 'calendar', name: 'Kalendarz', href: '/crm/calendar', iconKey: 'calendar', module: 'calendar' },
  { key: 'messages', name: 'Wiadomości', href: '/crm/messages', iconKey: 'messages', module: 'messages' },
  {
    key: 'marketing-campaigns',
    name: 'Marketing',
    href: '/crm/page',
    iconKey: 'campaigns',
    module: 'marketing_campaigns',
    children: [
      { key: 'marketing-campaigns', name: 'Panel marketingowy', href: '/crm/page', iconKey: 'campaigns', module: 'marketing_campaigns' },
      { key: 'marketing-campaigns', name: 'Kampanie e-mail', href: '/crm/campaigns', iconKey: 'messages', module: 'marketing_campaigns' },
    ],
  },
  { key: 'contacts', name: 'Kontakty', href: '/crm/contacts', iconKey: 'contacts', module: 'clients' },
  { key: 'events', name: 'Eventy', href: '/crm/events', iconKey: 'events', module: 'events' },
  { key: 'mavinci-live', name: 'Mavinci LIVE', href: '/crm/mavinci-live', iconKey: 'mavinciLive', module: 'mavinci_live' },
  {
    key: 'offers',
    name: 'Oferty',
    href: '/crm/offers',
    iconKey: 'offers',
    module: 'offers',
    children: [
      { key: 'offers', name: 'Oferty', href: '/crm/offers', iconKey: 'fileText', module: 'offers' },
      { key: 'offers', name: 'Produkty', href: '/crm/offers?tab=catalog', iconKey: 'package', module: 'offers' },
      { key: 'offers', name: 'Szablony', href: '/crm/offers?tab=templates', iconKey: 'fileType', module: 'offers' },
      { key: 'offers', name: 'Broszury', href: '/crm/brochures', iconKey: 'bookOpen', module: 'offers' },
    ],
  },
  {
    key: 'contracts',
    name: 'Umowy',
    href: '/crm/contracts',
    iconKey: 'contracts',
    module: 'contracts',
    children: [
      { key: 'contracts', name: 'Umowy', href: '/crm/contracts', iconKey: 'fileText', module: 'contracts' },
      { key: 'contracts', name: 'Szablony umów', href: '/crm/contract-templates', iconKey: 'fileType', module: 'contracts' },
    ],
  },
  { key: 'invoices', name: 'Finanse', href: '/crm/invoices', iconKey: 'invoices', module: 'finances' },
  { key: 'employees', name: 'Pracownicy', href: '/crm/employees', iconKey: 'employees', module: 'employees' },
  { key: 'equipment', name: 'Magazyn', href: '/crm/equipment', iconKey: 'equipment', module: 'equipment' },
  { key: 'fleet', name: 'Flota', href: '/crm/fleet', iconKey: 'fleet', module: 'fleet' },
  { key: 'inquiries', name: 'Zapytania', href: '/crm/inquiries', iconKey: 'tasks', module: 'tasks' },
  { key: 'tasks', name: 'Zadania', href: '/crm/tasks', iconKey: 'tasks', module: 'tasks' },
  { key: 'time-tracking', name: 'Czas pracy', href: '/crm/time-tracking', iconKey: 'time', module: 'time_tracking' },
  { key: 'page', name: 'Strona', href: '/crm/page?tab=website', iconKey: 'page', module: 'page' },
  { key: 'locations', name: 'Lokalizacje', href: '/crm/locations', iconKey: 'locations', module: 'locations' },
  { key: 'tenders', name: 'Przetargi', href: '/crm/tenders', iconKey: 'tenders', module: 'tenders' },
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
  FileSearch,
  Megaphone,
  } from 'lucide-react';

export const NavigationIcons: Record<string, unknown> = {
  dashboard: LayoutDashboard,
  calendar: Calendar,
  messages: Mail,
  campaigns: Megaphone,
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
  tenders: FileSearch,
};
