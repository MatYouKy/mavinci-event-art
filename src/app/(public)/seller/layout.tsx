'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BadgePercent,
  CalendarDays,
  CircleUser,
  FileText,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  PlusCircle,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSellerPortalContext } from '@/lib/seller/portal';
import { sellerInboxCounts, useSellerInbox } from '@/lib/seller/inbox';
import { SellerCountBadge } from '@/components/seller/SellerInboxPanel';

const navigation = [
  { name: 'Dashboard', href: '/seller', icon: LayoutDashboard },
  { name: 'Nowa oferta', href: '/seller/offers/new', icon: PlusCircle },
  { name: 'Moje oferty', href: '/seller/offers', icon: FileText },
  { name: 'Realizacje', href: '/seller/realizations', icon: CalendarDays },
  { name: 'Rozmowy z opiekunem', href: '/seller/messages', icon: MessageSquare },
  { name: 'Moje wynagrodzenie', href: '/seller/commissions', icon: BadgePercent },
  { name: 'Ustawienia', href: '/seller/profile', icon: Settings },
];

const validatePassword = (password: string) => {
  if (password.length < 8) return 'Hasło musi mieć minimum 8 znaków.';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Hasło musi zawierać wielką literę, małą literę i cyfrę.';
  }
  return null;
};

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const { context: sellerContext } = useSellerPortalContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const isPasswordSetup = pathname === '/seller/set-password';
  const inbox = useSellerInbox(Boolean(user) && !isPasswordSetup);
  const inboxCounts = sellerInboxCounts(inbox.items);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (isPasswordSetup) {
          setLoading(false);
          return;
        }
        router.replace('/login');
        return;
      }
      setUser(session.user);
      setLoading(false);
    };

    void checkAuth();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && !isPasswordSetup) router.replace('/login');
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, [isPasswordSetup, router]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const displayName = useMemo(
    () => user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Sprzedawca',
    [user],
  );
  const initials = useMemo(
    () => displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase(),
    [displayName],
  );
  const hasCommissionHistoryAccess = Boolean(sellerContext);

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    router.replace('/login');
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage(null);
    const validationMessage = validatePassword(newPassword);
    if (validationMessage) {
      setPasswordMessage({ type: 'error', text: validationMessage });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Podane hasła nie są identyczne.' });
      return;
    }

    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (error) {
      setPasswordMessage({ type: 'error', text: error.message });
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMessage({ type: 'success', text: 'Hasło zostało zmienione.' });
  };

  if (isPasswordSetup) return <>{children}</>;
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#0f1119] text-[#d3bb73]">Ładowanie...</div>;
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#0f1119]">
      <div className="flex h-screen overflow-hidden">
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 border-r border-[#d3bb73]/10 bg-[#1c1f33] transition-transform duration-300 lg:static lg:translate-x-0`}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-6 py-6">
              <Link href="/seller" className="flex items-center gap-3">
                <Image src="/logo.png" alt="Mavinci" priority width={160} height={60} className="h-8 w-auto" />
              </Link>
              <button type="button" onClick={() => setSidebarOpen(false)} className="text-[#e5e4e2] lg:hidden" aria-label="Zamknij menu">
                <X className="h-6 w-6" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-4 py-6">
              <ul className="space-y-1">
                {navigation.filter((item) => item.href !== '/seller/commissions' || hasCommissionHistoryAccess).map((item) => {
                  const active = pathname === item.href || (item.href !== '/seller' && pathname.startsWith(`${item.href}/`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-light transition ${active ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'}`}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.name}
                        {item.href === '/seller/messages' && <span className="ml-auto"><SellerCountBadge count={inboxCounts.messages} label="Nowe wiadomości" /></span>}
                        {item.href === '/seller/offers' && <span className="ml-auto"><SellerCountBadge count={inboxCounts.notices - inboxCounts.realizations} label="Nowe decyzje opiekuna" /></span>}
                        {item.href === '/seller/realizations' && <span className="ml-auto"><SellerCountBadge count={inboxCounts.realizations} label="Nowe potwierdzenia realizacji" /></span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="border-t border-[#d3bb73]/10 p-4">
              <button type="button" onClick={() => setDrawerOpen(true)} className="mb-2 flex w-full items-center gap-3 rounded-lg bg-[#d3bb73]/10 px-4 py-3 text-left transition hover:bg-[#d3bb73]/15">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-[#d3bb73]">
                  {initials || <CircleUser className="h-8 w-8" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#e5e4e2]">{displayName}</span>
                  <span className="block truncate text-xs text-[#e5e4e2]/60">{user.email}</span>
                </span>
              </button>
              <button type="button" onClick={handleLogout} className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-light text-[#e5e4e2]/70 transition hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]">
                <LogOut className="h-5 w-5" /> Wyloguj się
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-4 md:px-6">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSidebarOpen(true)} className="text-[#e5e4e2] lg:hidden" aria-label="Otwórz menu">
                <Menu className="h-6 w-6" />
              </button>
              <h1 className="text-xl font-light text-[#e5e4e2]">
                {navigation.find((item) => item.href === pathname)?.name || 'Panel sprzedawcy'}
              </h1>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      {sidebarOpen && <button type="button" aria-label="Zamknij menu" className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <button type="button" aria-label="Zamknij menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-[#d3bb73]/15 bg-[#171a29] text-[#e5e4e2] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#d3bb73]">Panel sprzedawcy</p>
                <p className="mt-1 text-sm text-white/40">Profil i najważniejsze działania</p>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg p-2 text-white/45 hover:bg-white/5 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-white/5 p-5">
              <div className="flex items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10 text-sm font-medium text-[#d3bb73]">{initials}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="mt-1 truncate text-xs text-white/40">{user.email}</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <Link href="/seller/profile" className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-white/65 hover:bg-white/5 hover:text-white">
                <Settings className="h-5 w-5" />
                <span>Ustawienia</span>
              </Link>

              <div className="mt-3 border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => { setChangePasswordOpen((open) => !open); setPasswordMessage(null); }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-white/65 hover:bg-white/5 hover:text-white"
                >
                  <LockKeyhole className="h-5 w-5" />
                  <span className="flex-1 text-left">Zmień hasło</span>
                </button>

                {changePasswordOpen && (
                  <form onSubmit={changePassword} className="mx-2 mt-2 space-y-3 rounded-xl border border-white/5 bg-[#0f1119] p-4">
                    <label className="block text-xs text-white/45">Nowe hasło<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#171a29] px-3 py-2.5 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
                    <label className="block text-xs text-white/45">Powtórz hasło<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#171a29] px-3 py-2.5 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
                    {passwordMessage && <p className={`text-xs ${passwordMessage.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>{passwordMessage.text}</p>}
                    <button type="submit" disabled={passwordSaving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2.5 text-sm font-medium text-[#111522] disabled:opacity-50">
                      {passwordSaving && <Loader2 className="h-4 w-4 animate-spin" />} Zapisz nowe hasło
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="border-t border-white/5 p-4">
              <button type="button" onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-red-200/75 hover:bg-red-400/10 hover:text-red-200">
                <LogOut className="h-5 w-5" /> Wyloguj się
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
