'use client';

import {
  ShieldCheck,
  LogOut,
  Settings,
  User,
  ChevronDown,
  LayoutDashboard,
  Globe,
  CreditCard as Edit3,
  Eye,
  Bell,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEditMode } from '../contexts/EditModeContext';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAppSelector } from '../store/hooks';
import { supabase } from '@/lib/supabase';
import NotificationCenter from './crm/NotificationCenter';
import { canEditWebsite, isAdmin } from '@/lib/permissions';
import { useMobile } from '@/hooks/useMobile';

const navLinks = [
  { label: 'O Nas', href: '/o-nas' },
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'Zespół', href: '/zespol' },
  { label: 'Usługi', href: '/uslugi' },
  // { label: 'Kontakt', href: '/#kontakt' },
];

const servicesLinks = [
  { label: 'Wszystkie usługi', href: '/oferta', highlight: false },
  { label: 'Konferencje', href: '/oferta/konferencje' },
  { label: 'Kasyno', href: '/oferta/kasyno' },
  { label: 'Streaming', href: '/oferta/streaming' },
  { label: 'Integracje firmowe', href: '/oferta/integracje' },
  { label: 'DJ Eventowy', href: '/oferta/dj-eventowy' },
  { label: 'Technika sceniczna', href: '/oferta/technika-sceniczna' },
  { label: 'Quizy i teleturnieje', href: '/oferta/quizy-teleturnieje' },
  { label: 'Wieczory tematyczne', href: '/oferta/wieczory-tematyczne' },
  { label: 'Symulatory VR', href: '/oferta/symulatory-vr' },
];

const servicesCategories = [
  { label: 'Konferencje', href: '/oferta/konferencje' },
  { label: 'Kasyno', href: '/oferta/kasyno' },
  { label: 'Streaming', href: '/oferta/streaming' },
  { label: 'Quizy i teleturnieje', href: '/oferta/quizy-teleturnieje' },
  { label: 'Technika sceniczna', href: '/oferta/technika-sceniczna' },
  { label: 'DJ Eventowy', href: '/oferta/dj-eventowy' },
  { label: 'Integracje firmowe', href: '/oferta/integracje' },
  { label: 'Symulatory VR', href: '/oferta/symulatory-vr' },
  { label: 'Wieczory tematyczne', href: '/oferta/wieczory-tematyczne' },
];

export interface CategoryNode {
  label: string;
  href: string;
  children?: CategoryNode[];
}

export const categoryNavLinks: CategoryNode[] = [
  { label: 'O Nas', href: '/o-nas' },
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'Zespół', href: '/zespol' },
  { label: 'Usługi', href: '/uslugi', children: [] },
  { label: 'Oferta', href: '/oferta', children: servicesCategories },
  { label: 'Kontakt', href: '/#kontakt' },
];

interface NavbarProps {
  onAdminClick?: () => void;
}

export default function Navbar({ onAdminClick }: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isServicesOpen, setIsServicesOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);
  const { signOut, user } = useAuth();
  const isMobile = useMobile();
  const { isEditMode, toggleEditMode } = useEditMode();
  const router = useRouter();
  const pathname = usePathname();

  const isActivePath = (href: string) => {
    if (href === '/') return pathname === '/';
    // dopasowanie dokładne lub z dziećmi, np. /oferta/konferencje
    return pathname === href || pathname.startsWith(href + '/');
  };

  const isOfferActive = pathname.startsWith('/oferta');
  const authUser = useAppSelector((state) => state.auth.user);
  const [crmUser, setCrmUser] = useState<any>(null);
  const [employee, setEmployee] = useState<any>(null);

  useEffect(() => {
    const checkCrmAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setCrmUser(session.user);
        const { data: employeeData } = await supabase
          .from('employees')
          .select(
            'id, name, surname, nickname, email, avatar_url, avatar_metadata, access_level, permissions, role',
          )
          .eq('email', session.user.email)
          .maybeSingle();
        if (employeeData) {
          setEmployee(employeeData);
        }
      }
    };
    checkCrmAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setCrmUser(null);
        setEmployee(null);
      } else if (session) {
        setCrmUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY < 50) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY.current) {
        if (!isHovered) {
          setIsVisible(false);
        }
      } else {
        setIsVisible(true);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isHovered]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (
        servicesRef.current &&
        !servicesRef.current.contains(event.target as Node) &&
        !isMenuOpen
      ) {
        setIsServicesOpen(false);
      }
    }

    if (isDropdownOpen || (isServicesOpen && !isMenuOpen)) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, isServicesOpen, isMenuOpen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    await signOut();
    setIsDropdownOpen(false);
    setCrmUser(null);
    setEmployee(null);
    router.push('/');
  };

  const handleLoginClick = () => {
    router.push('/crm/login');
  };

  const handleDashboardClick = () => {
    router.push('/crm/dashboard');
    setIsDropdownOpen(false);
  };

  const isAuthenticated = !!user || !!authUser || !!crmUser;

  const getDisplayName = () => {
    if (employee) {
      return employee.nickname || employee.name;
    }
    if (crmUser?.email) {
      return crmUser.email.split('@')[0];
    }
    if (authUser?.user_name) {
      return authUser.user_name;
    }
    return 'Użytkownik';
  };

  const getInitials = () => {
    if (employee) {
      return `${employee.name.charAt(0)}${employee.surname.charAt(0)}`.toUpperCase();
    }
    if (crmUser?.email) {
      return crmUser.email.charAt(0).toUpperCase();
    }
    if (authUser?.user_name) {
      return authUser.user_name.charAt(0).toUpperCase();
    }
    return 'U';
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

  const displayName = getDisplayName();
  const avatarUrl =
    employee?.avatar_url ||
    authUser?.user_avatar?.image_metadata?.desktop?.src ||
    authUser?.user_avatar;
  const userEmail = crmUser?.email || authUser?.user_email?.address;

  return (
    <>
      <div
        className="fixed left-0 right-0 top-0 z-40 h-20"
        onMouseEnter={() => setIsHovered(true)}
        style={{ pointerEvents: isVisible ? 'none' : 'auto' }}
      />
      <nav
        ref={navRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="fixed left-0 right-0 top-0 z-50 px-4 pt-4 transition-transform duration-300 sm:px-6 lg:px-8"
        style={{
          transform: isVisible || isHovered ? 'translateY(0)' : 'translateY(-100%)',
        }}
      >
        <div className="mx-auto max-w-7xl rounded-full border border-[#d3bb73]/20 bg-[#1c1f33]/95 px-4 shadow-lg backdrop-blur-md md:px-8">
          <div className="flex h-14 items-center justify-between gap-0 md:h-16 md:gap-4">
            <Link href="/" className="flex flex-shrink-0 items-center">
              <img
                src="/logo mavinci.svg"
                alt="MAVINCI event & art"
                className="h-8 w-auto"
                style={{ minWidth: '120px' }}
              />
            </Link>
            {isMobile && <div className="flex-1" />}

            <div className="hidden items-center gap-8 md:flex">
              {navLinks.map((link) => {
                const isActive = isActivePath(link.href);

                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={`text-sm font-light transition-colors duration-200 ${
                      isActive
                        ? 'text-[#d3bb73]' // aktywny
                        : 'text-[#e5e4e2]/90 hover:text-[#d3bb73]' // normalny
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <div className="relative" ref={servicesRef}>
                <button
                  onClick={() => setIsServicesOpen(!isServicesOpen)}
                  className={`flex items-center gap-1 text-sm font-light transition-colors duration-200 ${
                    isOfferActive ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/90 hover:text-[#d3bb73]'
                  }`}
                >
                  Oferta
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isServicesOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isServicesOpen && (
                  <div className="absolute left-0 mt-2 w-64 overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
                    <div className="py-2">
                      {servicesLinks.map((service) => {
                        const isServiceActive =
                          service.href === '/oferta'
                            ? pathname === '/oferta' // tylko dokładny match
                            : isActivePath(service.href);

                        return (
                          <Link
                            key={service.href}
                            href={service.href}
                            onClick={() => setIsServicesOpen(false)}
                            className={`block px-4 py-2 text-sm transition-colors ${
                              isServiceActive && isOfferActive
                                ? 'border-l-2 border-[#d3bb73] font-medium text-[#d3bb73] hover:bg-[#d3bb73]/20'
                                : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
                            }`}
                          >
                            {service.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <Link
                href="/#kontakt"
                className="text-sm font-light text-[#e5e4e2]/90 transition-colors duration-200 hover:text-[#d3bb73]"
              >
                Kontakt
              </Link>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              {isAuthenticated && <NotificationCenter />}
              {isAuthenticated ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="flex items-center gap-2 rounded-full bg-[#800020]/20 px-3 py-2 text-sm font-medium text-[#e5e4e2] transition-colors duration-200 hover:bg-[#800020]/30"
                  >
                    {avatarUrl ? (
                      <div className="h-8 w-8 overflow-hidden rounded-full border-2 border-[#d3bb73]/30">
                        <img
                          src={avatarUrl}
                          alt={displayName}
                          className="h-full w-full"
                          style={getAvatarStyle()}
                        />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60">
                        <span className="text-xs font-bold text-[#1c1f33]">{getInitials()}</span>
                      </div>
                    )}
                    <span className="hidden max-w-[120px] truncate text-[#d3bb73] lg:block">
                      {displayName}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-[#d3bb73] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-72 overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
                      <div className="border-b border-[#d3bb73]/20 bg-gradient-to-br from-[#d3bb73]/10 to-transparent p-4">
                        <div className="mb-2 flex items-center gap-3">
                          {avatarUrl ? (
                            <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-[#d3bb73]/30">
                              <img
                                src={avatarUrl}
                                alt={displayName}
                                className="h-full w-full"
                                style={getAvatarStyle()}
                              />
                            </div>
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60">
                              <span className="text-base font-bold text-[#1c1f33]">
                                {getInitials()}
                              </span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-semibold text-[#e5e4e2]">
                              {displayName}
                            </p>
                            <p className="truncate text-sm text-[#e5e4e2]/60">{userEmail}</p>
                          </div>
                        </div>
                        {employee?.role && (
                          <span className="inline-block rounded-full bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                            {employee.role}
                          </span>
                        )}
                      </div>
                      <div className="py-2">
                        {crmUser && (
                          <button
                            onClick={() => {
                              router.push('/crm');
                              setIsDropdownOpen(false);
                            }}
                            className="group flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                              <LayoutDashboard className="h-4 w-4 text-[#d3bb73]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[#e5e4e2]">Panel CRM</p>
                              <p className="text-xs text-[#e5e4e2]/60">System zarządzania</p>
                            </div>
                          </button>
                        )}
                        {authUser && (
                          <button
                            onClick={handleDashboardClick}
                            className="group flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                              <Settings className="h-4 w-4 text-[#d3bb73]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[#e5e4e2]">Panel Admina</p>
                              <p className="text-xs text-[#e5e4e2]/60">Zarządzanie stroną</p>
                            </div>
                          </button>
                        )}
                        {(authUser || canEditWebsite(employee)) && (
                          <>
                            <div className="my-2 h-px bg-[#d3bb73]/20" />
                            <button
                              onClick={() => {
                                toggleEditMode();
                                setIsDropdownOpen(false);
                              }}
                              className={`group flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 ${isEditMode ? 'bg-[#d3bb73]/10' : ''}`}
                            >
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors group-hover:bg-[#d3bb73]/20 ${isEditMode ? 'bg-[#d3bb73]/20' : 'bg-[#d3bb73]/10'}`}
                              >
                                {isEditMode ? (
                                  <Eye className="h-4 w-4 text-[#d3bb73]" />
                                ) : (
                                  <Edit3 className="h-4 w-4 text-[#d3bb73]" />
                                )}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-[#e5e4e2]">
                                  {isEditMode ? 'Wyłącz tryb edycji' : 'Włącz tryb edycji'}
                                </p>
                                <p className="text-xs text-[#e5e4e2]/60">
                                  {isEditMode
                                    ? 'Wróć do trybu przeglądania'
                                    : 'Edytuj treści i obrazy na stronie'}
                                </p>
                              </div>
                            </button>
                          </>
                        )}
                        <div className="my-2 h-px bg-[#d3bb73]/20" />
                        <button
                          onClick={handleLogout}
                          className="group flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-red-500/10"
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
                  )}
                </div>
              ) : (
                <>
                  <button
                    onClick={handleLoginClick}
                    className="flex items-center gap-2 rounded-full bg-[#800020]/20 px-4 py-2 text-sm font-medium text-[#d3bb73] transition-colors duration-200 hover:bg-[#800020]/30"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Zaloguj się
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-white md:hidden"
              aria-label="Toggle menu"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMenuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="mt-2 max-h-[80vh] overflow-y-auto rounded-b-3xl bg-[#1c1f33]/95 backdrop-blur-lg md:hidden">
            <div className="space-y-3 px-4 py-4">
              {navLinks.map((link) => {
                const isActive = isActivePath(link.href);

                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`block py-2 text-sm font-light text-white/90 hover:text-white ${
                      isActive
                        ? 'text-[#d3bb73]' // aktywny
                        : 'text-[#e5e4e2]/90 hover:text-[#d3bb73]' // normalny
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <div>
                <button
                  onClick={() => setIsServicesOpen(!isServicesOpen)}
                  className="flex w-full items-center justify-between py-2 text-sm font-light text-white/90 hover:text-white"
                >
                  Oferta
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isServicesOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isServicesOpen && (
                  <div className="ml-4 mt-2 space-y-2">
                    {isServicesOpen && (
                      <div className="ml-4 mt-2 space-y-2">
                        {servicesLinks.map((service) => {
                          const isServiceActive =
                            service.href === '/oferta'
                              ? pathname === '/oferta' // tylko dokładny match
                              : isActivePath(service.href);

                          return (
                            <Link
                              key={service.href}
                              href={service.href}
                              onClick={() => {
                                setIsServicesOpen(false);
                                setIsMenuOpen(false);
                              }}
                              className={`block touch-manipulation rounded px-3 py-3 text-xs transition-colors ${
                                isServiceActive
                                  ? 'border-l-2 border-[#d3bb73] font-medium text-[#d3bb73] active:bg-[#d3bb73]/20'
                                  : 'font-light text-white/70 active:bg-[#d3bb73]/20 active:text-white'
                              }`}
                            >
                              {service.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <Link
                    href="/#kontakt"
                    onClick={() => setIsMenuOpen(false)}
                    className={`block py-2 text-sm font-light text-white/90 hover:text-white ${
                      'text-[#e5e4e2]/90 hover:text-[#d3bb73]' // normalny
                    }`}
                  >
                    Kontakt
                  </Link>
              {isAuthenticated ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2">
                    {avatarUrl ? (
                      <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full border-2 border-[#d3bb73]/30">
                        <img
                          src={avatarUrl}
                          alt={displayName}
                          className="h-full w-full"
                          style={getAvatarStyle()}
                        />
                      </div>
                    ) : (
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60">
                        <span className="text-sm font-bold text-[#1c1f33]">{getInitials()}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#e5e4e2]">{displayName}</p>
                      <p className="truncate text-[10px] text-[#e5e4e2]/60">{userEmail}</p>
                    </div>
                    <NotificationCenter />
                  </div>
                  {crmUser && (
                    <button
                      onClick={() => {
                        router.push('/crm');
                        setIsMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <LayoutDashboard className="h-4 w-4 text-[#d3bb73]" />
                      Panel CRM
                    </button>
                  )}
                  {authUser && (
                    <button
                      onClick={() => {
                        handleDashboardClick();
                        setIsMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <Settings className="h-4 w-4 text-[#d3bb73]" />
                      Panel Admina
                    </button>
                  )}
                  {(authUser || canEditWebsite(employee)) && (
                    <button
                      onClick={() => {
                        toggleEditMode();
                        setIsMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 ${isEditMode ? 'bg-[#d3bb73]/10' : ''}`}
                    >
                      {isEditMode ? (
                        <Eye className="h-4 w-4 text-[#d3bb73]" />
                      ) : (
                        <Edit3 className="h-4 w-4 text-[#d3bb73]" />
                      )}
                      {isEditMode ? 'Wyłącz tryb edycji' : 'Włącz tryb edycji'}
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <LogOut className="h-4 w-4 text-red-400" />
                    Wyloguj się
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLoginClick}
                  className="mt-4 w-full rounded-full bg-[#800020]/20 px-6 py-2 text-sm font-medium text-[#d3bb73]"
                >
                  Zaloguj się
                </button>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
