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
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface EmployeeData {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  email: string;
  role: string;
  access_level: string;
  avatar_url: string | null;
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
        .select('*')
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
    router.push('/crm/login');
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

  if (loading) {
    return (
      <div className="w-10 h-10 bg-[#1c1f33] rounded-full animate-pulse" />
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1c1f33] transition-colors group"
      >
        <div className="flex items-center gap-3">
          {employee?.avatar_url ? (
            <img
              src={employee.avatar_url}
              alt={getDisplayName()}
              className="w-10 h-10 rounded-full border-2 border-[#d3bb73]/30 object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60 flex items-center justify-center border-2 border-[#d3bb73]/30">
              <span className="text-[#1c1f33] font-bold text-sm">
                {getInitials()}
              </span>
            </div>
          )}

          <div className="hidden md:block text-left">
            <p className="text-sm font-medium text-[#e5e4e2] leading-tight">
              {getDisplayName()}
            </p>
            {employee?.role && (
              <p className="text-xs text-[#e5e4e2]/60">
                {getRoleName(employee.role)}
              </p>
            )}
          </div>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-[#e5e4e2]/60 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <>
          <div className="absolute right-0 top-14 w-80 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-2xl z-50 overflow-hidden">
            <div className="p-4 border-b border-[#d3bb73]/20 bg-gradient-to-br from-[#d3bb73]/10 to-transparent">
              <div className="flex items-center gap-3 mb-3">
                {employee?.avatar_url ? (
                  <img
                    src={employee.avatar_url}
                    alt={getDisplayName()}
                    className="w-12 h-12 rounded-full border-2 border-[#d3bb73]/30 object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60 flex items-center justify-center border-2 border-[#d3bb73]/30">
                    <span className="text-[#1c1f33] font-bold">
                      {getInitials()}
                    </span>
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-[#e5e4e2] truncate">
                    {getDisplayName()}
                  </p>
                  <p className="text-sm text-[#e5e4e2]/60 truncate">
                    {user?.email}
                  </p>
                </div>
              </div>

              {employee && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-full">
                    {getRoleName(employee.role)}
                  </span>
                  {employee.access_level && employee.role !== 'admin' && employee.access_level !== 'admin' && (
                    <span
                      className={`px-2 py-1 bg-[#0f1119] rounded-full ${getAccessLevelColor(
                        employee.access_level
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
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors">
                  <User className="w-4 h-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    Mój profil
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Edytuj dane osobowe
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  router.push('/crm/settings');
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors">
                  <Settings className="w-4 h-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    Ustawienia
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Hasło, preferencje i powiadomienia
                  </p>
                </div>
              </button>

              {employee?.role === 'admin' && (
                <>
                  <div className="h-px bg-[#d3bb73]/20 my-2" />

                  <button
                    onClick={() => {
                      router.push('/crm/admin/security');
                      setIsOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                      <Shield className="w-4 h-4 text-red-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#e5e4e2]">
                        Bezpieczeństwo
                      </p>
                      <p className="text-xs text-[#e5e4e2]/60">
                        Uprawnienia i dostęp
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      router.push('/crm/admin/logs');
                      setIsOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                      <FileText className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#e5e4e2]">
                        Logi aktywności
                      </p>
                      <p className="text-xs text-[#e5e4e2]/60">
                        Historia zmian
                      </p>
                    </div>
                  </button>
                </>
              )}

              <div className="h-px bg-[#d3bb73]/20 my-2" />

              <button
                onClick={() => {
                  router.push('/crm/help');
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors">
                  <HelpCircle className="w-4 h-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    Pomoc i wsparcie
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Dokumentacja i FAQ
                  </p>
                </div>
              </button>

              <div className="h-px bg-[#d3bb73]/20 my-2" />

              <button
                onClick={() => {
                  router.push('/');
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors">
                  <Globe className="w-4 h-4 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#e5e4e2]">
                    Powrót do strony
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Strona główna Mavinci
                  </p>
                </div>
              </button>

              <div className="h-px bg-[#d3bb73]/20 my-2" />

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-red-500/10 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                  <LogOut className="w-4 h-4 text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-400">
                    Wyloguj się
                  </p>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Zakończ sesję
                  </p>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
