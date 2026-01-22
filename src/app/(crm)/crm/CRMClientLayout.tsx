'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, ChevronsLeft, ChevronsRight } from 'lucide-react';

import NotificationCenter from '@/components/crm/NotificationCenter';
import UserMenu from '@/components/crm/UserMenu';
import NavigationManager from '@/components/crm/NavigationManager';
import { SnackbarProvider } from '@/contexts/SnackbarContext';
import { canView, isAdmin, type Employee } from '@/lib/permissions';
import { Metadata } from 'next';
import { useActivityHeartbeat } from '@/hooks/useActivityHeartbeat';
import { IEmployee } from './employees/type';
import { TaskAccessWrapper } from './(providers)/TaskAccessWrapper';
import { allNavigation, NavigationItem } from './mock/navigation';
import { supabase } from '@/lib/supabase/browser';

export const metadata: Metadata = {
  title: 'Mavinci CRM',
  description: 'Mavinci CRM',
  robots: { index: false, follow: false },
};

export default function CRMClientLayout({
  employee,
  children,
}: {
  employee: IEmployee | null;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [navigation, setNavigation] = useState(allNavigation);
  const pathname = usePathname();
  const router = useRouter();

  useActivityHeartbeat();

  useEffect(() => {
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      setSidebarCollapsed(savedState === 'true');
    }
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const isPublicInvitationPage = pathname?.startsWith('/crm/events/invitation/');

      if (!session && pathname !== '/login' && !isPublicInvitationPage) {
        router.push('/login');
        return;
      }

      if (isPublicInvitationPage) {
        setLoading(false);
        return;
      }

      if (session?.user) {
        const { data: employeeData } = await supabase
          .from('employees')
          .select('id, role, access_level, permissions, navigation_order, last_active_at')
          .eq('email', session.user.email)
          .maybeSingle();

        if (employeeData) {
          let userNav: NavigationItem[];
          if (isAdmin(employeeData as unknown as Employee)) {
            userNav = allNavigation;
          } else {
            userNav = allNavigation.filter((item) => {
              if (item.key === 'dashboard') return true;
              if (!item.module) return false;
              return canView(employeeData as unknown as Employee, item.module);
            });
          }

          if (employeeData.navigation_order && Array.isArray(employeeData.navigation_order)) {
            const orderedNav: NavigationItem[] = [];
            const navMap = new Map(userNav.map((item) => [item.key, item]));

            employeeData.navigation_order.forEach((key: string) => {
              const item = navMap.get(key);
              if (item) {
                orderedNav.push(item);
                navMap.delete(key);
              }
            });

            navMap.forEach((item) => orderedNav.push(item));
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      }
      setUser(session?.user || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', String(newState));
  };

  const isPublicPage = pathname === '/login' || pathname?.startsWith('/crm/events/invitation/');

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-lg text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
      <div className="flex min-h-screen flex-col bg-[#0f1119]">
        <header className="fixed left-0 right-0 top-0 z-50 border-b border-[#d3bb73]/10 bg-[#1c1f33] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(true)} className="text-[#e5e4e2] lg:hidden">
                <Menu className="h-6 w-6" />
              </button>
              <Link href="/crm" className="flex items-center gap-3">
                <img src="/logo mavinci-simple.svg" alt="Mavinci CRM" className="h-8 w-auto" />
              </Link>
              <div className="hidden h-6 w-px bg-[#d3bb73]/20 lg:block"></div>
              <h1 className="hidden text-xl font-light text-[#e5e4e2] lg:block">
                {navigation.find((item) => item.href === pathname)?.name || 'CRM'}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <NotificationCenter />
              <UserMenu />
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden pt-[73px]">
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
                employeeId={employee?.id || null}
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

          <main
            className={`flex-1 overflow-y-auto p-2 sm:p-4 md:p-6 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'} transition-all duration-300`}
          >
            <TaskAccessWrapper pathname={pathname} employee={employee} router={router}>
                {children}

            </TaskAccessWrapper>
          </main>
        </div>

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </div>
  );
}
