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
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useScreenMode } from '@/hooks/useScreenMode';
import { Avatar } from '@mui/material';

export default function UserMenu({ onLogout }: { onLogout: () => void }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { screenMode } = useScreenMode();
  const user_avatar_src = user?.user_avatar.image_metadata?.[screenMode]?.src;

  const user_avatar = `${process.env.NEXT_PUBLIC_SERVER_URL}/${user_avatar_src}`;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    onLogout();
    await supabase.auth.signOut();
    router.push('/crm/login');
  };

  const getInitials = () => {
    if (user) {
      return `${user.user_name.charAt(0)}${user.user_surname.charAt(0)}`.toUpperCase();
    }
    if (user?.user_email.address) {
      return user.user_email.address.charAt(0).toUpperCase();
    }
    return 'U';
  };

  const getDisplayName = () => {
    if (user) {
      return user.user_nick || user.user_name;
    }
    if (user?.user_email.address) {
      return user.user_email.address.split('@')[0];
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
    // Fix: Use optional chaining and correct property access according to likely data structure
    const avatarMeta = user.user_avatar.metadata?.[screenMode];

    if (!avatarMeta?.position) {
      return {};
    }
    const { posX = 0, posY = 0, scale = 1 } = avatarMeta.position;
    const objectFit = avatarMeta.objectFit || 'contain';
    return {
      objectFit: objectFit as any,
      transform: `translate(${posX}%, ${posY}%) scale(${scale})`,
    };
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#1c1f33]"
      >
        <div className="flex items-center gap-3">
          <Avatar
            src={user_avatar}
            alt={getDisplayName()}
            className="h-full w-full rounded-full border-2 border-[#d3bb73]/30"
            style={getAvatarStyle()}
          />

          <div className="hidden text-left md:block">
            <p className="text-sm font-medium leading-tight text-[#e5e4e2]">{getDisplayName()}</p>
            {user?.user_role && (
              <p className="text-xs text-[#e5e4e2]/60">{getRoleName(user.user_role)}</p>
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
                {user_avatar ? (
                  <Avatar
                    src={user_avatar}
                    alt={getDisplayName()}
                    className="h-full w-full rounded-full border-2 border-[#d3bb73]/30"
                    style={getAvatarStyle()}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60">
                    <span className="font-bold text-[#1c1f33]">{getInitials()}</span>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-[#e5e4e2]">
                    {getDisplayName()}
                  </p>
                  <p className="truncate text-sm text-[#e5e4e2]/60">{user?.user_email.address}</p>
                </div>
              </div>

              {user && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-[#d3bb73]/20 px-2 py-1 text-[#d3bb73]">
                    {getRoleName(user.user_role)}
                  </span>
                  {user.user_access_level &&
                    user.user_role !== 'admin' &&
                    user.user_access_level !== 'admin' && (
                      <span
                        className={`rounded-full bg-[#0f1119] px-2 py-1 ${getAccessLevelColor(
                          user.user_access_level,
                        )}`}
                      >
                        {user.user_access_level === 'external' ||
                        user.user_access_level === 'manager'
                          ? 'Pełny dostęp'
                          : user.user_access_level === 'lead'
                            ? 'Ograniczony'
                            : user.user_access_level === 'instructor'
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
                  if (user?._id) {
                    router.push(`/crm/employees/${user._id}`);
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

              {user?.user_role === 'admin' && (
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
