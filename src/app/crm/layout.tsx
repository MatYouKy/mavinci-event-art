// src/app/crm/CRMLayout.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Calendar,
  Users,
  Package,
  FileText,
  CheckSquare,
  Mail,
  LayoutDashboard,
  Menu,
  ChevronsLeft,
  ChevronsRight,
  Car,
  BookUser,
} from 'lucide-react';

import NotificationCenter from '@/components/crm/NotificationCenter';
import UserMenu from '@/components/crm/UserMenu';
import NavigationManager from '@/components/crm/NavigationManager';
import { SnackbarProvider } from '@/contexts/SnackbarContext';

// 🔐 Redux (JWT)
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { logout as authLogout, logout } from '@/features/auth/authSlice';

// Twoje helpery uprawnień – dalej działają, ale zamiast Supabase Employee
// używamy danych z usera z backendu (role / access_level / permissions)
import { canView as canViewModule, isAdmin as isAdminRole } from '@/lib/permissions';
import { useAuth } from '@/features/auth/hooks/useAuth';

interface NavigationItem {
  name: string;
  href: string;
  icon: any;
  module?: string;
  key: string;
}

const LOGIN_PATH = '/crm/login';

const allNavigation: NavigationItem[] = [
  { key: 'dashboard', name: 'Dashboard', href: '/crm', icon: LayoutDashboard },
  { key: 'calendar', name: 'Kalendarz', href: '/crm/calendar', icon: Calendar, module: 'calendar' },
  { key: 'messages', name: 'Wiadomości', href: '/crm/messages', icon: Mail, module: 'messages' },
  { key: 'contacts', name: 'Kontakty', href: '/crm/contacts', icon: BookUser, module: 'clients' },
  { key: 'events', name: 'Eventy', href: '/crm/events', icon: Calendar, module: 'events' },
  { key: 'offers', name: 'Oferty', href: '/crm/offers', icon: FileText, module: 'offers' },
  { key: 'contracts', name: 'Umowy', href: '/crm/contracts', icon: FileText, module: 'contracts' },
  {
    key: 'attractions',
    name: 'Atrakcje',
    href: '/crm/attractions',
    icon: FileText,
    module: 'attractions',
  },
  {
    key: 'employees',
    name: 'Pracownicy',
    href: '/crm/employees',
    icon: Users,
    module: 'employees',
  },
  { key: 'equipment', name: 'Magazyn', href: '/crm/equipment', icon: Package, module: 'equipment' },
  { key: 'fleet', name: 'Flota', href: '/crm/fleet', icon: Car, module: 'fleet' },
  { key: 'tasks', name: 'Zadania', href: '/crm/tasks', icon: CheckSquare, module: 'tasks' },
  { key: 'time-tracking', name: 'Czas pracy', href: '/crm/time-tracking', icon: Calendar },
];

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const { user, token, isAdmin } = useAuth();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [navigation, setNavigation] = useState<NavigationItem[]>(allNavigation);

  // Przywrócenie stanu z localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) setSidebarCollapsed(saved === 'true');
  }, []);

  // 🔐 Guard na podstawie JWT: jeśli brak tokenu i nie jesteśmy na stronie logowania → redirect
  useEffect(() => {
    // Nie blokuj samej strony logowania
    if (pathname === LOGIN_PATH) {
      setLoading(false);
      return;
    }

    if (!token) {
      router.replace(LOGIN_PATH);
      return;
    }

    setLoading(false);
  }, [token, pathname, router]);

  // Budowanie nawigacji na podstawie ról/uprawnień użytkownika (z backendu)
  useEffect(() => {
    // Jeśli nie ma jeszcze usera (np. chwilka między logowaniem a rehydratacją) – wstrzymaj
    if (!user) return;

    let userNav: NavigationItem[];

    // if (isAdmin) {
    //   userNav = allNavigation;
    // } else {
    //   userNav = allNavigation.filter((item) => {
    //     // Kalendarz & Zadania dla wszystkich
    //     if (item.key === 'calendar' || item.key === 'tasks') return true;
    //     if (!item.module) return true;

    //     // canViewModule powinien umieć przyjąć obiekt user (role/permissions)
    //     return canViewModule(user, item.module);
    //   });
    // }

    // Jeśli kiedyś będziesz zapisywać preferowaną kolejność nawigacji w userze:
    // const order = user.navigation_order as string[] | undefined;
    // jeżeli istnieje – ułóż według niej:
    // if (order && Array.isArray(order)) { ... }

    // setNavigation(userNav);
  }, [user]);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('sidebarCollapsed', String(next));
  };

  const handleLogout = () => {
    // wyczyść Redux + ewentualne localStorage (w zależności jak trzymasz)
    dispatch(logout());
    router.replace(LOGIN_PATH);
  };

  // Nie opakowujemy strony logowania layoutem
  if (pathname === LOGIN_PATH) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-lg text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  // Jeśli brak usera (np. token wygasł) – nic nie renderuj (redirect w guardzie)
  if (!user) return null;

  const currentTitle =
    navigation?.find((item) => item.href === pathname)?.name ||
    navigation?.find((item) => pathname.startsWith(item.href) && item.href !== '/crm')?.name ||
    'CRM';

  return (
    <SnackbarProvider>
      <div className="flex min-h-screen flex-col bg-[#0f1119]">
        {/* Header */}
        <header className="fixed left-0 right-0 top-0 z-50 border-b border-[#d3bb73]/10 bg-[#1c1f33] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(true)} className="text-[#e5e4e2] lg:hidden">
                <Menu className="h-6 w-6" />
              </button>
              <Link href="/crm" className="flex items-center gap-3">
                <img src="/logo mavinci-simple.svg" alt="Mavinci CRM" className="h-8 w-auto" />
              </Link>
              <div className="hidden h-6 w-px bg-[#d3bb73]/20 lg:block" />
              <h1 className="hidden text-xl font-light text-[#e5e4e2] lg:block">{currentTitle}</h1>
            </div>
            <div className="flex items-center gap-4">
              <NotificationCenter />
              <UserMenu onLogout={handleLogout} />
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden pt-[73px]">
          {/* Sidebar */}
          <aside
            className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${
              sidebarCollapsed ? 'w-20' : 'w-64'
            } fixed bottom-0 left-0 top-[73px] z-40 border-r border-[#d3bb73]/10 bg-[#1c1f33] transition-all duration-300 lg:translate-x-0`}
          >
            <div className="relative flex h-full flex-col">
              <NavigationManager
                navigation={navigation}
                pathname={pathname}
                sidebarCollapsed={sidebarCollapsed}
                // employeeId – jeśli chcesz zapisywać kolejność nav per user:
                employeeId={user?._id ?? null}
                onClose={() => setSidebarOpen(false)}
                onOrderChange={(newOrder) => setNavigation(newOrder)}
              />

              <button
                onClick={toggleSidebar}
                className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center text-[#e5e4e2]/40 transition-colors hover:text-[#d3bb73] lg:flex"
                title={sidebarCollapsed ? 'Rozwiń menu' : 'Zwiń menu'}
              >
                {sidebarCollapsed ? (
                  <ChevronsRight className="h-5 w-5" />
                ) : (
                  <ChevronsLeft className="h-5 w-5" />
                )}
              </button>

              <div className="mt-auto border-t border-[#d3bb73]/10 p-4">
                {!sidebarCollapsed && (
                  <div className="text-center text-xs text-[#e5e4e2]/40">
                    <p>Mavinci CRM v1.0</p>
                    <p className="mt-1">© 2025 Mavinci</p>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Content */}
          <main
            className={`flex-1 overflow-y-auto p-6 transition-all duration-300 ${
              sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'
            }`}
          >
            {(() => {
              if (pathname === '/crm') return children;

              const currentNav = allNavigation.find(
                (nav) => pathname.startsWith(nav.href) && nav.href !== '/crm',
              );

              if (currentNav?.module) {
                const allowed = isAdmin || user?.user_access_level === 'admin';

                if (!allowed) {
                  return (
                    <div className="flex min-h-[400px] flex-col items-center justify-center px-6">
                      <div className="mb-4 text-6xl">🔒</div>
                      <h2 className="mb-2 text-2xl font-light text-[#e5e4e2]">Brak uprawnień</h2>
                      <p className="mb-6 max-w-md text-center text-[#e5e4e2]/60">
                        Nie masz uprawnień do przeglądania tej strony.
                      </p>
                      <button
                        onClick={() => router.push('/crm')}
                        className="rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                      >
                        Wróć do Dashboard
                      </button>
                    </div>
                  );
                }
              }

              return children;
            })()}
          </main>
        </div>

        {/* Backdrop na mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </div>
    </SnackbarProvider>
  );
}
