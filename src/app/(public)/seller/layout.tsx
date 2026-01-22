'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Calendar,
  Users,
  Package,
  LogOut,
  Menu,
  X,
  CircleUser,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
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
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

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
    <div className="min-h-screen bg-[#0f1119]">
      <div className="flex h-screen overflow-hidden">
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } fixed inset-y-0 left-0 z-50 w-64 border-r border-[#d3bb73]/10 bg-[#1c1f33] transition-transform duration-300 lg:static lg:translate-x-0`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-6 py-6">
              <Link href="/seller" className="flex items-center gap-3">
                <img src="/logo mavinci-simple.svg" alt="Mavinci" className="h-8 w-auto" />
                <span className="text-sm text-[#e5e4e2]">Sprzedawca</span>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="text-[#e5e4e2] lg:hidden">
                <X className="h-6 w-6" />
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
                        className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-light transition-all duration-200 ${
                          isActive
                            ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                            : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
                        }`}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="border-t border-[#d3bb73]/10 p-4">
              <div className="mb-2 flex items-center gap-3 rounded-lg bg-[#d3bb73]/10 px-4 py-3">
                <CircleUser className="h-8 w-8 text-[#d3bb73]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#e5e4e2]">
                    {user?.email?.split('@')[0] || 'Sprzedawca'}
                  </p>
                  <p className="truncate text-xs text-[#e5e4e2]/60">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-light text-[#e5e4e2]/70 transition-all duration-200 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              >
                <LogOut className="h-5 w-5" />
                Wyloguj się
              </button>
              <Link
                href="/crm"
                className="mt-2 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-light text-[#e5e4e2]/70 transition-all duration-200 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              >
                🔧 Panel CRM
              </Link>
            </div>
          </div>
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="border-b border-[#d3bb73]/10 bg-[#1c1f33] px-6 py-4">
            <div className="flex items-center justify-between">
              <button onClick={() => setSidebarOpen(true)} className="text-[#e5e4e2] lg:hidden">
                <Menu className="h-6 w-6" />
              </button>
              <div className="flex-1 lg:ml-0">
                <h1 className="text-xl font-light text-[#e5e4e2]">
                  {navigation.find((item) => item.href === pathname)?.name || 'Panel Sprzedawcy'}
                </h1>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
