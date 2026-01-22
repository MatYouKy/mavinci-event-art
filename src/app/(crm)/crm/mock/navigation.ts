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
  Ligature as FileSignature,
} from 'lucide-react';

export interface NavigationItem {
  name: string;
  href: string;
  icon: any;
  module?: string;
  key: string;
}

export const allNavigation: NavigationItem[] = [
  { key: 'dashboard', name: 'Dashboard', href: '/crm', icon: LayoutDashboard },
  { key: 'calendar', name: 'Kalendarz', href: '/crm/calendar', icon: Calendar, module: 'calendar' },
  { key: 'messages', name: 'Wiadomości', href: '/crm/messages', icon: Mail, module: 'messages' },
  { key: 'contacts', name: 'Kontakty', href: '/crm/contacts', icon: BookUser, module: 'clients' },
  { key: 'events', name: 'Eventy', href: '/crm/events', icon: Calendar, module: 'events' },
  { key: 'offers', name: 'Oferty', href: '/crm/offers', icon: FileText, module: 'offers' },
  { key: 'contracts', name: 'Umowy', href: '/crm/contracts', icon: FileSignature, module: 'contracts' },
  { key: 'invoices', name: 'Faktury', href: '/crm/invoices', icon: Receipt, module: 'finances' },
  { key: 'employees', name: 'Pracownicy', href: '/crm/employees', icon: Users, module: 'employees' },
  { key: 'equipment', name: 'Magazyn', href: '/crm/equipment', icon: Package, module: 'equipment' },
  { key: 'fleet', name: 'Flota', href: '/crm/fleet', icon: Car, module: 'fleet' },
  { key: 'tasks', name: 'Zadania', href: '/crm/tasks', icon: CheckSquare, module: 'tasks' },
  { key: 'time-tracking', name: 'Czas pracy', href: '/crm/time-tracking', icon: Clock, module: 'time_tracking' },
  { key: 'page', name: 'Strona', href: '/crm/page', icon: Globe, module: 'page' },
  { key: 'locations', name: 'Lokalizacje', href: '/crm/locations', icon: MapPin, module: 'locations' },
];