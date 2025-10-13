'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Calendar, Users, Package, FileText, CheckSquare, Mail, Settings, LayoutDashboard, Menu, X, LogOut, Building2, CircleUser as UserCircle, Ligature as FileSignature, FileType, Sparkles, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import NotificationCenter from '@/components/crm/NotificationCenter';
import UserMenu from '@/components/crm/UserMenu';
import { SnackbarProvider } from '@/contexts/SnackbarContext';

const navigation = [
  { name: 'Dashboard', href: '/crm', icon: LayoutDashboard },
  { name: 'Kalendarz', href: '/crm/calendar', icon: Calendar },
  { name: 'Wiadomości', href: '/crm/messages', icon: Mail },
  { name: 'Klienci', href: '/crm/clients', icon: Building2 },
  { name: 'Eventy', href: '/crm/events', icon: Calendar },
  { name: 'Oferty', href: '/crm/offers', icon: FileText },
  { name: 'Umowy', href: '/crm/contracts', icon: FileSignature },
  { name: 'Atrakcje', href: '/crm/attractions', icon: Sparkles },
  { name: 'Pracownicy', href: '/crm/employees', icon: Users },
  { name: 'Sprzęt', href: '/crm/equipment', icon: Package },
  { name: 'Zadania', href: '/crm/tasks', icon: CheckSquare },
];

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
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
            <nav className="flex-1 overflow-y-auto px-4 py-6">
              <ul className="space-y-1">
                {navigation.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-lg text-sm font-light transition-all duration-200 ${
                          isActive
                            ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                            : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
                        }`}
                        title={sidebarCollapsed ? item.name : ''}
                      >
                        <item.icon className="w-5 h-5" />
                        {!sidebarCollapsed && <span>{item.name}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

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
          {children}
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
