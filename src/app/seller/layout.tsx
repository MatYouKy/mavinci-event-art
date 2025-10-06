'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, Calendar, Users, Package, LogOut, Menu, X, CircleUser } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const navigation = [
  { name: 'Dashboard', href: '/seller', icon: LayoutDashboard },
  { name: 'Moje oferty', href: '/seller/offers', icon: FileText },
  { name: 'Kalendarz', href: '/seller/calendar', icon: Calendar },
  { name: 'Klienci', href: '/seller/clients', icon: Users },
  { name: 'Katalog atrakcji', href: '/seller/attractions', icon: Package },
];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
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
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

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
    <div className="min-h-screen bg-[#0f1119]">
      <div className="flex h-screen overflow-hidden">
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } fixed inset-y-0 left-0 z-50 w-64 bg-[#1c1f33] border-r border-[#d3bb73]/10 transition-transform duration-300 lg:translate-x-0 lg:static`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-6 py-6 border-b border-[#d3bb73]/10">
              <Link href="/seller" className="flex items-center gap-3">
                <img src="/logo mavinci-simple.svg" alt="Mavinci" className="h-8 w-auto" />
                <span className="text-[#e5e4e2] text-sm">Sprzedawca</span>
              </Link>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden text-[#e5e4e2]"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-4 py-6">
              <ul className="space-y-1">
                {navigation.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-light transition-all duration-200 ${
                          isActive
                            ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                            : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
                        }`}
                      >
                        <item.icon className="w-5 h-5" />
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="border-t border-[#d3bb73]/10 p-4">
              <div className="flex items-center gap-3 px-4 py-3 mb-2 bg-[#d3bb73]/10 rounded-lg">
                <CircleUser className="w-8 h-8 text-[#d3bb73]" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#e5e4e2] truncate">
                    {user?.email?.split('@')[0] || 'Sprzedawca'}
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60 truncate">
                    {user?.email}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-sm font-light text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2] transition-all duration-200"
              >
                <LogOut className="w-5 h-5" />
                Wyloguj się
              </button>
              <Link
                href="/crm"
                className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-sm font-light text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2] transition-all duration-200 mt-2"
              >
                🔧 Panel CRM
              </Link>
            </div>
          </div>
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="bg-[#1c1f33] border-b border-[#d3bb73]/10 px-6 py-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-[#e5e4e2]"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div className="flex-1 lg:ml-0">
                <h1 className="text-xl font-light text-[#e5e4e2]">
                  {navigation.find((item) => item.href === pathname)?.name || 'Panel Sprzedawcy'}
                </h1>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
