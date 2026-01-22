'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Settings,
  LogOut,
  Shield,
  Bell,
  ChevronDown,
  Key,
  FileText,
  HelpCircle,
  Globe,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface EmployeeData {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  email: string;
  role: string;
  access_level: string;
  avatar_url: string | null;
  avatar_metadata?: {
    desktop?: {
      position?: {
        posX: number;
        posY: number;
        scale: number;
      };
      objectFit?: string;
    };
  };
}

export default function UserMenu() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchUserData();

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchUserData = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      setUser(session.user);

      const { data: employeeData, error } = await supabase
        .from('employees')
        .select(
          'id, name, surname, nickname, email, role, access_level, avatar_url, avatar_metadata',
        )
        .eq('email', session.user.email)
        .maybeSingle();

      if (!error && employeeData) {
        setEmployee(employeeData);
      } else {
        // Fallback - jeśli nie ma danych w tabeli employees, utwórz domyślny obiekt admina
        const emailParts = session.user.email?.split('@') || [];
        const name = emailParts[0] || 'Administrator';
        setEmployee({
          id: session.user.id,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          surname: 'Systemu',
          email: session.user.email || '',
          role: 'admin',
          access_level: 'admin',
          avatar_url: null,
        });
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching user data:', error);
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const getInitials = () => {
    if (employee) {
      return `${employee.name.charAt(0)}${employee.surname.charAt(0)}`.toUpperCase();
    }
    if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return 'U';
  };

  const getDisplayName = () => {
    if (employee) {
      return employee.nickname || employee.name;
    }
    if (user?.email) {
      return user.email.split('@')[0];
    }
    return 'Użytkownik';
  };

  const getRoleName = (role: string) => {
    const roleNames: Record<string, string> = {
      admin: 'Administrator',
      manager: 'Manager',
      employee: 'Pracownik',
      technician: 'Technik',
      salesperson: 'Handlowiec',
    };
    return roleNames[role] || role;
  };

  const getAccessLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      admin: 'text-green-400',
      manager: 'text-green-400',
      full: 'text-green-400',
      limited: 'text-yellow-400',
      read_only: 'text-blue-400',
    };
    return colors[level] || 'text-[#e5e4e2]/60';
  };

  const getAvatarStyle = () => {
    if (!employee?.avatar_metadata?.desktop?.position) {
      return {};
    }
    const { posX, posY, scale } = employee.avatar_metadata.desktop.position;
    const objectFit = employee.avatar_metadata.desktop.objectFit || 'cover';
    return {
      objectFit: objectFit as any,
      transform: `translate(${posX}%, ${posY}%) scale(${scale})`,
    };
  };

  if (loading) {
    return <div className="h-10 w-10 animate-pulse rounded-full bg-[#1c1f33]" />;
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#1c1f33]"
      >
        <div className="flex items-center gap-3">
          {employee?.avatar_url ? (
            <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-[#d3bb73]/30">
              <img
                src={employee.avatar_url}
                alt={getDisplayName()}
                className="h-full w-full"
                style={getAvatarStyle()}
              />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60">
              <span className="text-sm font-bold text-[#1c1f33]">{getInitials()}</span>
            </div>
          )}

          <div className="hidden text-left md:block">
            <p className="text-sm font-medium leading-tight text-[#e5e4e2]">{getDisplayName()}</p>
            {employee?.role && (
              <p className="text-xs text-[#e5e4e2]/60">{getRoleName(employee.role)}</p>
            )}
          </div>
        </div>

        <ChevronDown
          className={`h-4 w-4 text-[#e5e4e2]/60 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <>
          <div className="absolute right-0 top-14 z-50 w-80 overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
            <div className="border-b border-[#d3bb73]/20 bg-gradient-to-br from-[#d3bb73]/10 to-transparent p-4">
              <div className="mb-3 flex items-center gap-3">
                {employee?.avatar_url ? (
                  <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-[#d3bb73]/30">
                    <img
                      src={employee.avatar_url}
                      alt={getDisplayName()}
                      className="h-full w-full"
                      style={getAvatarStyle()}
                    />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60">
                    <span className="font-bold text-[#1c1f33]">{getInitials()}</span>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-[#e5e4e2]">
                    {getDisplayName()}
                  </p>
                  <p className="truncate text-sm text-[#e5e4e2]/60">{user?.email}</p>
                </div>
              </div>

              {employee && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-[#d3bb73]/20 px-2 py-1 text-[#d3bb73]">
                    {getRoleName(employee.role)}
                  </span>
                  {employee.access_level &&
                    employee.role !== 'admin' &&
                    employee.access_level !== 'admin' && (
                      <span
                        className={`rounded-full bg-[#0f1119] px-2 py-1 ${getAccessLevelColor(
                          employee.access_level,
                        )}`}
                      >
                        {employee.access_level === 'full' || employee.access_level === 'admin'
                          ? 'Pełny dostęp'
                          : employee.access_level === 'limited'
                            ? 'Ograniczony'
                            : employee.access_level === 'manager'
                              ? 'Manager'
                              : 'Tylko odczyt'}
                      </span>
                    )}
                </div>
              )}
            </div>

            <div className="p-2">
              <button
                onClick={() => {
                  if (employee?.id) {
                    router.push(`/crm/employees/${employee.id}`);
                  }
                  setIsOpen(false);
                }}
                className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <User className="h-4 w-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">Mój profil</p>
                  <p className="text-xs text-[#e5e4e2]/60">Edytuj dane osobowe</p>
                </div>
              </button>

              <button
                onClick={() => {
                  router.push('/crm/settings');
                  setIsOpen(false);
                }}
                className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <Settings className="h-4 w-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">Ustawienia</p>
                  <p className="text-xs text-[#e5e4e2]/60">Hasło, preferencje i powiadomienia</p>
                </div>
              </button>

              {employee?.role === 'admin' && (
                <>
                  <div className="my-2 h-px bg-[#d3bb73]/20" />

                  <button
                    onClick={() => {
                      router.push('/crm/admin/security');
                      setIsOpen(false);
                    }}
                    className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 transition-colors group-hover:bg-red-500/20">
                      <Shield className="h-4 w-4 text-red-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#e5e4e2]">Bezpieczeństwo</p>
                      <p className="text-xs text-[#e5e4e2]/60">Uprawnienia i dostęp</p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      router.push('/crm/admin/logs');
                      setIsOpen(false);
                    }}
                    className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 transition-colors group-hover:bg-blue-500/20">
                      <FileText className="h-4 w-4 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#e5e4e2]">Logi aktywności</p>
                      <p className="text-xs text-[#e5e4e2]/60">Historia zmian</p>
                    </div>
                  </button>
                </>
              )}

              <div className="my-2 h-px bg-[#d3bb73]/20" />

              <button
                onClick={() => {
                  router.push('/crm/help');
                  setIsOpen(false);
                }}
                className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <HelpCircle className="h-4 w-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">Pomoc i wsparcie</p>
                  <p className="text-xs text-[#e5e4e2]/60">Dokumentacja i FAQ</p>
                </div>
              </button>

              <div className="my-2 h-px bg-[#d3bb73]/20" />

              <button
                onClick={() => {
                  router.push('/');
                  setIsOpen(false);
                }}
                className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <Globe className="h-4 w-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">Powrót do strony</p>
                  <p className="text-xs text-[#e5e4e2]/60">Strona główna Mavinci</p>
                </div>
              </button>

              <div className="my-2 h-px bg-[#d3bb73]/20" />

              <button
                onClick={handleLogout}
                className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-red-500/10"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 transition-colors group-hover:bg-red-500/20">
                  <LogOut className="h-4 w-4 text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-400">Wyloguj się</p>
                  <p className="text-xs text-[#e5e4e2]/60">Zakończ sesję</p>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
