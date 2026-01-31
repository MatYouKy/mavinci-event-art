'use client';

import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Mail,
  CheckSquare,
  Users,
  FileText,
  UserRound,
  ScrollText,
  Package,
  Truck,
  Globe,
  Receipt,
  MapPin,
  Clock,
  Database,
  Home,
} from 'lucide-react';

/**
 * Klucze ikon MUSZĄ być stringami, które dostajesz z serwera jako iconKey.
 * Tu mapujesz string -> komponent React.
 */
export const NavigationIcons = {
  // core
  dashboard: LayoutDashboard,
  home: Home,

  // modules
  calendar: CalendarDays,
  events: CalendarClock,
  messages: Mail,
  tasks: CheckSquare,
  employees: Users,
  offers: FileText,
  contacts: UserRound,
  contracts: ScrollText,
  equipment: Package,
  fleet: Truck,
  page: Globe,
  invoices: Receipt,
  locations: MapPin,
  time: Clock,
  databases: Database,
} as const;

export type IconKey = keyof typeof NavigationIcons;

/**
 * Typ komponentu ikony (dla TS w komponentach).
 */
export type NavIconComponent = ComponentType<LucideProps>;