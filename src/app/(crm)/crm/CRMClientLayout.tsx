'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, ChevronsLeft, ChevronsRight } from 'lucide-react';

import NotificationCenter from '@/components/crm/NotificationCenter';
import UserMenu from '@/components/crm/UserMenu';
import NavigationManager from '@/components/crm/NavigationManager';
import { useActivityHeartbeat } from '@/hooks/useActivityHeartbeat';
import { IEmployee } from './employees/type';
import { TaskAccessWrapper } from './(providers)/TaskAccessWrapper';
import { supabase } from '@/lib/supabase/browser';
import { Notification } from '@/components/crm/NotificationCenter';
import { NavigationItem } from './mock/navigation';

export default function CRMClientLayout({
  employee,
  children,
  initialUnreadMessagesCount,
  initialNotifications,
  initialNavigation,
}: {
  employee: IEmployee | null;
  children: React.ReactNode;
  initialUnreadMessagesCount: number;
  initialNotifications: Notification[];
  initialNavigation: NavigationItem[];
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);

  // ✅ jeśli serwer dał employee, to nie pokazuj loadera
  const [loading, setLoading] = useState(() => !employee?.id);

  // ✅ NAWIGACJA: startujemy z serwera i NIE przeliczamy jej na kliencie
  const [navigation, setNavigation] = useState<NavigationItem[]>(() => initialNavigation ?? []);

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
      const isPublicPage = pathname === '/login' || isPublicInvitationPage;

      // brak sesji i nie publiczna strona => login
      if (!session && !isPublicPage) {
        router.push('/login');
        return;
      }

      // public invitation => nie blokujemy
      if (isPublicInvitationPage) {
        setLoading(false);
        return;
      }

      // ✅ ustaw user tylko dla UI (UserMenu), ale nie ruszamy navigation
      setUser(session?.user || null);

      // ✅ jeżeli initialNavigation jest puste (np. edge case), możesz ewentualnie zrobić fallback:
      // ALE bez filtrowania po stronie klienta — tylko pobrać "gotowe" z serwera przez endpoint/action.
      // Tu na razie NIE robimy nic, żeby nie migało.

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

  if (!employee?.id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-lg text-[#d3bb73]">Nie znaleziono pracownika</div>
        <button onClick={() => router.push('/login')} className="text-[#d3bb73]">
          Przejdź do strony logowania
        </button>
      </div>
    );
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
              <Image
                src="/logo mavinci-simple.svg"
                alt="Mavinci"
                width={160}
                height={60}
                className="h-auto w-40"
              />
            </Link>
            <div className="hidden h-6 w-px bg-[#d3bb73]/20 lg:block"></div>
            <h1 className="hidden text-xl font-light text-[#e5e4e2] lg:block">
              {navigation.find((item) => item.href === pathname)?.name || 'CRM'}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <NotificationCenter initialNotifications={initialNotifications} />
            <UserMenu initialEmployee={employee} />
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
              initialUnreadMessagesCount={initialUnreadMessagesCount}
              navigation={navigation}
              pathname={pathname}
              sidebarCollapsed={sidebarCollapsed}
              employeeId={employee?.id || null}
              onClose={() => setSidebarOpen(false)}
              onOrderChange={(newOrder: NavigationItem[]) => setNavigation(newOrder)}
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
          className={`flex-1 overflow-y-auto p-2 sm:p-4 md:p-6 ${
            sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'
          } transition-all duration-300`}
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