'use client';

import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  CalendarCheck,
  Mail,
  Inbox,
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
  Box,
  Layers,
  Cable,
  PackageOpen,
  FolderTree,
  FileType,
  Plug,
  Megaphone,
  MonitorPlay,
  BookOpen,
  BadgePercent,
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
  meetings: CalendarCheck,
  events: CalendarClock,
  mavinciLive: MonitorPlay,
  messages: Mail,
  campaigns: Megaphone,
  inquiries: Inbox,
  tasks: CheckSquare,
  employees: Users,
  salespeople: BadgePercent,
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

  // equipment submenu
  box: Box,
  layers: Layers,
  cable: Cable,
  plug: Plug,
  packageOpen: PackageOpen,
  folderTree: FolderTree,

  // offers submenu
  fileText: FileText,
  package: Package,
  fileType: FileType,
  bookOpen: BookOpen,
} as const;

export type IconKey = keyof typeof NavigationIcons;

/**
 * Typ komponentu ikony (dla TS w komponentach).
 */
export type NavIconComponent = ComponentType<LucideProps>;
