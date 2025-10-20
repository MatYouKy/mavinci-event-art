'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Calendar, Users, Package, FileText, CheckSquare, Mail, Settings, LayoutDashboard, Menu, X, LogOut, Building2, CircleUser as UserCircle, Ligature as FileSignature, FileType, Sparkles, ChevronsLeft, ChevronsRight, GripVertical, RotateCcw, UserCheck, Clock, Car, BookUser } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import NotificationCenter from '@/components/crm/NotificationCenter';
import UserMenu from '@/components/crm/UserMenu';
import NavigationManager from '@/components/crm/NavigationManager';
import { SnackbarProvider } from '@/contexts/SnackbarContext';
import { canView, isAdmin, type Employee } from '@/lib/permissions';

interface NavigationItem {
  name: string;
  href: string;
  icon: any;
  module?: string;
  key: string;
}

const allNavigation: NavigationItem[] = [
  { key: 'dashboard', name: 'Dashboard', href: '/crm', icon: LayoutDashboard },
  { key: 'calendar', name: 'Kalendarz', href: '/crm/calendar', icon: Calendar, module: 'calendar' },
  { key: 'messages', name: 'Wiadomości', href: '/crm/messages', icon: Mail, module: 'messages' },
  { key: 'contacts', name: 'Kontakty', href: '/crm/contacts', icon: BookUser, module: 'clients' },
  { key: 'events', name: 'Eventy', href: '/crm/events', icon: Calendar, module: 'events' },
  { key: 'offers', name: 'Oferty', href: '/crm/offers', icon: FileText, module: 'offers' },
  { key: 'contracts', name: 'Umowy', href: '/crm/contracts', icon: FileSignature, module: 'contracts' },
  { key: 'attractions', name: 'Atrakcje', href: '/crm/attractions', icon: Sparkles, module: 'attractions' },
  { key: 'employees', name: 'Pracownicy', href: '/crm/employees', icon: Users, module: 'employees' },
  { key: 'equipment', name: 'Magazyn', href: '/crm/equipment', icon: Package, module: 'equipment' },
  { key: 'fleet', name: 'Flota', href: '/crm/fleet', icon: Car, module: 'fleet' },
  { key: 'tasks', name: 'Zadania', href: '/crm/tasks', icon: CheckSquare, module: 'tasks' },
  { key: 'time-tracking', name: 'Czas pracy', href: '/crm/time-tracking', icon: Clock },
];

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [navigation, setNavigation] = useState<NavigationItem[]>(allNavigation);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      setSidebarCollapsed(savedState === 'true');
    }
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session && pathname !== '/crm/login') {
        router.push('/crm/login');
        return;
      }

      if (session?.user) {
        const { data: employeeData } = await supabase
          .from('employees')
          .select('id, role, access_level, permissions, navigation_order')
          .eq('email', session.user.email)
          .maybeSingle();

        if (employeeData) {
          setEmployee(employeeData);

          let userNav: NavigationItem[];
          if (isAdmin(employeeData)) {
            userNav = allNavigation;
          } else {
            userNav = allNavigation.filter(item => {
              // Kalendarz i zadania są dostępne dla wszystkich
              if (item.key === 'calendar' || item.key === 'tasks') return true;
              if (!item.module) return true;
              return canView(employeeData, item.module);
            });
          }

          if (employeeData.navigation_order && Array.isArray(employeeData.navigation_order)) {
            const orderedNav: NavigationItem[] = [];
            const navMap = new Map(userNav.map(item => [item.key, item]));

            employeeData.navigation_order.forEach((key: string) => {
              const item = navMap.get(key);
              if (item) {
                orderedNav.push(item);
                navMap.delete(key);
              }
            });

            navMap.forEach(item => orderedNav.push(item));
            setNavigation(orderedNav);
          } else {
            setNavigation(userNav);
          }
        }
      }

      setUser(session?.user || null);
      setLoading(false);
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.push('/crm/login');
      }
      setUser(session?.user || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/crm/login');
  };

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', String(newState));
  };

  if (pathname === '/crm/login') {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-[#d3bb73] text-lg">Ładowanie...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <SnackbarProvider>
      <div className="min-h-screen bg-[#0f1119] flex flex-col">
        <header className="bg-[#1c1f33] border-b border-[#d3bb73]/10 px-6 py-4 fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-[#e5e4e2]"
            >
              <Menu className="w-6 h-6" />
            </button>
            <Link href="/crm" className="flex items-center gap-3">
              <img src="/logo mavinci-simple.svg" alt="Mavinci CRM" className="h-8 w-auto" />
            </Link>
            <div className="hidden lg:block h-6 w-px bg-[#d3bb73]/20"></div>
            <h1 className="text-xl font-light text-[#e5e4e2] hidden lg:block">
              {navigation.find((item) => item.href === pathname)?.name || 'CRM'}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <NotificationCenter />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="flex flex-1 pt-[73px] overflow-hidden">
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } ${
            sidebarCollapsed ? 'w-20' : 'w-64'
          } fixed top-[73px] bottom-0 left-0 z-40 bg-[#1c1f33] border-r border-[#d3bb73]/10 transition-all duration-300 lg:translate-x-0`}
        >
          <div className="flex h-full flex-col relative">
            <NavigationManager
              navigation={navigation}
              pathname={pathname}
              sidebarCollapsed={sidebarCollapsed}
              employeeId={employee?.id || null}
              onClose={() => setSidebarOpen(false)}
              onOrderChange={(newOrder) => setNavigation(newOrder)}
            />

            <button
              onClick={toggleSidebar}
              className="hidden lg:flex absolute top-1/2 -translate-y-1/2 -right-3 items-center justify-center text-[#e5e4e2]/40 hover:text-[#d3bb73] transition-colors z-10"
              title={sidebarCollapsed ? 'Rozwiń menu' : 'Zwiń menu'}
            >
              {sidebarCollapsed ? (
                <ChevronsRight className="w-5 h-5" />
              ) : (
                <ChevronsLeft className="w-5 h-5" />
              )}
            </button>

            <div className="border-t border-[#d3bb73]/10 p-4">
              {!sidebarCollapsed && (
                <div className="text-center text-xs text-[#e5e4e2]/40">
                  <p>Mavinci CRM v1.0</p>
                  <p className="mt-1">© 2025 Mavinci</p>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className={`flex-1 overflow-y-auto p-6 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'} transition-all duration-300`}>
          {(() => {
            if (pathname === '/crm') return children;

            const currentNav = allNavigation.find(nav => pathname.startsWith(nav.href) && nav.href !== '/crm');

            if (currentNav?.module) {
              const hasPermission = employee && (isAdmin(employee) || canView(employee, currentNav.module));

              if (!hasPermission) {
                return (
                  <div className="flex flex-col items-center justify-center min-h-[400px] px-6">
                    <div className="text-6xl mb-4">🔒</div>
                    <h2 className="text-2xl font-light text-[#e5e4e2] mb-2">Brak uprawnień</h2>
                    <p className="text-[#e5e4e2]/60 text-center max-w-md mb-6">
                      Nie masz uprawnień do przeglądania tej strony.
                    </p>
                    <button
                      onClick={() => router.push('/crm')}
                      className="px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
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

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      </div>
    </SnackbarProvider>
  );
}
