'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, ChevronsLeft, ChevronsRight } from 'lucide-react';

import NotificationCenter from '@/components/crm/NotificationCenter';
import UserMenu from '@/components/crm/UserMenu';
import NavigationManager from '@/components/crm/NavigationManager';
import ChatWidget from '@/components/crm/chat/ChatWidget';
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
  const [loading, setLoading] = useState(() => !employee?.id);

  const [navigation, setNavigation] = useState<NavigationItem[]>(
    () => initialNavigation ?? [],
  );

  const pathname = usePathname();
  const router = useRouter();

  const isMessagesPage = pathname?.startsWith('/crm/messages');
  const isPublicInvitationPage = pathname?.startsWith(
    '/crm/events/invitation/',
  );
  const isPublicPage = pathname === '/login' || isPublicInvitationPage;

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

      if (!session && !isPublicPage) {
        router.push('/login');
        return;
      }

      if (isPublicInvitationPage) {
        setLoading(false);
        return;
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
  }, [isPublicInvitationPage, isPublicPage, router]);

  const toggleSidebar = () => {
    const newState = !sidebarCollapsed;

    setSidebarCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', String(newState));
  };

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#0f1119]">
        <div className="text-lg text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  if (!employee?.id) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[#0f1119]">
        <div className="text-lg text-[#d3bb73]">
          Nie znaleziono pracownika
        </div>

        <button
          onClick={() => router.push('/login')}
          className="text-[#d3bb73]"
        >
          Przejdź do strony logowania
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#0f1119]">
      <header className="fixed left-0 right-0 top-0 z-50 h-[73px] border-b border-[#d3bb73]/10 bg-[#1c1f33] px-6">
        <div className="flex h-full items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-[#e5e4e2] lg:hidden"
            >
              <Menu className="h-6 w-6" />
            </button>

            <Link href="/crm" className="flex shrink-0 items-center">
              <div className="relative h-10 w-40 shrink-0">
                <Image
                  src="/logo.png"
                  alt="Mavinci"
                  priority
                  fill
                  sizes="160px"
                  className="object-contain object-left"
                />
              </div>
            </Link>

            <div className="hidden h-6 w-px bg-[#d3bb73]/20 lg:block" />

            <h1 className="hidden text-xl font-light text-[#e5e4e2] lg:block">
              {navigation.find((item) => item.href === pathname)?.name ||
                'CRM'}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <NotificationCenter
              initialNotifications={initialNotifications}
            />

            <UserMenu
              initialEmployee={employee as unknown as IEmployee}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden pt-[73px]">
        <aside
          className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${
            sidebarCollapsed ? 'w-20' : 'w-64'
          } fixed bottom-0 left-0 top-[73px] z-40 overflow-hidden border-r border-[#d3bb73]/10 bg-[#1c1f33] transition-all duration-300 lg:translate-x-0`}
        >
          <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavigationManager
                initialUnreadMessagesCount={initialUnreadMessagesCount}
                navigation={navigation}
                pathname={pathname}
                sidebarCollapsed={sidebarCollapsed}
                employeeId={employee.id}
                onClose={() => setSidebarOpen(false)}
                onOrderChange={(newOrder: any) =>
                  setNavigation(newOrder as NavigationItem[])
                }
              />
            </div>

            <button
              onClick={toggleSidebar}
              className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center text-[#e5e4e2]/40 transition-colors hover:text-[#d3bb73] lg:flex"
              title={
                sidebarCollapsed ? 'Rozwiń menu' : 'Zwiń menu'
              }
            >
              {sidebarCollapsed ? (
                <ChevronsRight className="h-5 w-5" />
              ) : (
                <ChevronsLeft className="h-5 w-5" />
              )}
            </button>

            <div className="shrink-0 border-t border-[#d3bb73]/10 p-4">
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
          className={`min-h-0 min-w-0 flex-1 ${
            isMessagesPage
              ? 'overflow-hidden p-0'
              : 'overflow-y-auto p-2 sm:p-4 md:p-6'
          } ${
            sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'
          } transition-all duration-300`}
        >
          <TaskAccessWrapper
            pathname={pathname}
            employee={employee}
            router={router}
          >
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

      <ChatWidget employee={employee} />
    </div>
  );
}