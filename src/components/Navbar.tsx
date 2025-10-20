'use client';

import { ShieldCheck, LogOut, Settings, User, ChevronDown, LayoutDashboard, Globe, CreditCard as Edit3, Eye, Bell } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEditMode } from '../contexts/EditModeContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppSelector } from '../store/hooks';
import { supabase } from '@/lib/supabase';
import NotificationCenter from './crm/NotificationCenter';
import { canEditWebsite, isAdmin } from '@/lib/permissions';

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
  const { isEditMode, toggleEditMode } = useEditMode();
  const router = useRouter();
  const authUser = useAppSelector((state) => state.auth.user);
  const [crmUser, setCrmUser] = useState<any>(null);
  const [employee, setEmployee] = useState<any>(null);

  useEffect(() => {
    const checkCrmAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setCrmUser(session.user);
        const { data: employeeData } = await supabase
          .from('employees')
          .select('id, name, surname, nickname, email, avatar_url, avatar_metadata, access_level, permissions, role')
          .eq('email', session.user.email)
          .maybeSingle();
        if (employeeData) {
          setEmployee(employeeData);
        }
      }
    };
    checkCrmAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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

  const navLinks = [
    { label: 'O Nas', href: '/o-nas' },
    { label: 'Portfolio', href: '/portfolio' },
    { label: 'Zespół', href: '/zespol' },
    { label: 'Kontakt', href: '/#kontakt' }
  ];

  const servicesLinks = [
    { label: 'Wszystkie usługi', href: '/uslugi' },
    { label: 'Konferencje', href: '/uslugi/konferencje' },
    { label: 'Integracje firmowe', href: '/uslugi/integracje' },
    { label: 'Wieczory tematyczne', href: '/uslugi/wieczory-tematyczne' },
    { label: 'Quizy i teleturnieje', href: '/uslugi/quizy-teleturnieje' },
    { label: 'Kasyno', href: '/uslugi/kasyno' },
    { label: 'Symulatory VR', href: '/uslugi/symulatory-vr' },
    { label: 'Technika sceniczna', href: '/uslugi/technika-sceniczna' },
    { label: 'Nagłośnienie', href: '/uslugi/naglosnienie' },
    { label: 'Streaming', href: '/uslugi/streaming' },
  ];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (servicesRef.current && !servicesRef.current.contains(event.target as Node) && !isMenuOpen) {
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
  const avatarUrl = employee?.avatar_url || authUser?.user_avatar?.image_metadata?.desktop?.src || authUser?.user_avatar;
  const userEmail = crmUser?.email || authUser?.user_email?.address;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 h-20 z-40"
        onMouseEnter={() => setIsHovered(true)}
        style={{ pointerEvents: isVisible ? 'none' : 'auto' }}
      />
      <nav
        ref={navRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 lg:px-8 pt-4 transition-transform duration-300"
        style={{
          transform: isVisible || isHovered ? 'translateY(0)' : 'translateY(-100%)'
        }}
      >
      <div className="max-w-7xl mx-auto bg-[#1c1f33]/95 backdrop-blur-md rounded-full px-4 md:px-8 border border-[#d3bb73]/20 shadow-lg">
        <div className="flex items-center justify-between h-14 md:h-16 gap-2 md:gap-4">
          <Link href="/" className="flex items-center flex-shrink-0">
            <img
              src="/logo mavinci.svg"
              alt="MAVINCI event & art"
              className="h-8 w-auto"
              style={{ minWidth: '120px' }}
            />
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[#e5e4e2]/90 hover:text-[#d3bb73] text-sm font-light transition-colors duration-200"
              >
                {link.label}
              </Link>
            ))}
            <div className="relative" ref={servicesRef}>
              <button
                onClick={() => setIsServicesOpen(!isServicesOpen)}
                className="flex items-center gap-1 text-[#e5e4e2]/90 hover:text-[#d3bb73] text-sm font-light transition-colors duration-200"
              >
                Oferta
                <ChevronDown className={`w-4 h-4 transition-transform ${isServicesOpen ? 'rotate-180' : ''}`} />
              </button>

              {isServicesOpen && (
                <div className="absolute left-0 mt-2 w-64 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-xl overflow-hidden">
                  <div className="py-2">
                    {servicesLinks.map((service) => (
                      <Link
                        key={service.href}
                        href={service.href}
                        onClick={() => setIsServicesOpen(false)}
                        className="block px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors"
                      >
                        {service.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            {isAuthenticated && (
              <NotificationCenter />
            )}
            {isAuthenticated ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-2 bg-[#800020]/20 text-[#e5e4e2] px-3 py-2 rounded-full text-sm font-medium hover:bg-[#800020]/30 transition-colors duration-200"
                >
                  {avatarUrl ? (
                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-[#d3bb73]/30">
                      <img
                        src={avatarUrl}
                        alt={displayName}
                        className="w-full h-full"
                        style={getAvatarStyle()}
                      />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60 flex items-center justify-center border-2 border-[#d3bb73]/30">
                      <span className="text-[#1c1f33] font-bold text-xs">
                        {getInitials()}
                      </span>
                    </div>
                  )}
                  <span className="hidden lg:block text-[#d3bb73] truncate max-w-[120px]">{displayName}</span>
                  <ChevronDown className={`w-4 h-4 text-[#d3bb73] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-72 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-xl overflow-hidden">
                    <div className="p-4 border-b border-[#d3bb73]/20 bg-gradient-to-br from-[#d3bb73]/10 to-transparent">
                      <div className="flex items-center gap-3 mb-2">
                        {avatarUrl ? (
                          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#d3bb73]/30">
                            <img
                              src={avatarUrl}
                              alt={displayName}
                              className="w-full h-full"
                              style={getAvatarStyle()}
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60 flex items-center justify-center border-2 border-[#d3bb73]/30">
                            <span className="text-[#1c1f33] font-bold text-base">
                              {getInitials()}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-semibold text-[#e5e4e2] truncate">{displayName}</p>
                          <p className="text-sm text-[#e5e4e2]/60 truncate">{userEmail}</p>
                        </div>
                      </div>
                      {employee?.role && (
                        <span className="inline-block px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-full text-xs">
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
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors text-left group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors">
                            <LayoutDashboard className="w-4 h-4 text-[#d3bb73]" />
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
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors text-left group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors">
                            <Settings className="w-4 h-4 text-[#d3bb73]" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-[#e5e4e2]">Panel Admina</p>
                            <p className="text-xs text-[#e5e4e2]/60">Zarządzanie stroną</p>
                          </div>
                        </button>
                      )}
                      {(authUser || canEditWebsite(employee)) && (
                        <>
                          <div className="h-px bg-[#d3bb73]/20 my-2" />
                          <button
                            onClick={() => {
                              toggleEditMode();
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors text-left group ${isEditMode ? 'bg-[#d3bb73]/10' : ''}`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-colors ${isEditMode ? 'bg-[#d3bb73]/20' : 'bg-[#d3bb73]/10'}`}>
                              {isEditMode ? (
                                <Eye className="w-4 h-4 text-[#d3bb73]" />
                              ) : (
                                <Edit3 className="w-4 h-4 text-[#d3bb73]" />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[#e5e4e2]">
                                {isEditMode ? 'Wyłącz tryb edycji' : 'Włącz tryb edycji'}
                              </p>
                              <p className="text-xs text-[#e5e4e2]/60">
                                {isEditMode ? 'Wróć do trybu przeglądania' : 'Edytuj treści i obrazy na stronie'}
                              </p>
                            </div>
                          </button>
                        </>
                      )}
                      <div className="h-px bg-[#d3bb73]/20 my-2" />
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-red-500/10 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                          <LogOut className="w-4 h-4 text-red-400" />
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
                  className="flex items-center gap-2 bg-[#800020]/20 text-[#d3bb73] px-4 py-2 rounded-full text-sm font-medium hover:bg-[#800020]/30 transition-colors duration-200"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Zaloguj się
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden text-white"
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden bg-[#1c1f33]/95 backdrop-blur-lg rounded-b-3xl mt-2 max-h-[80vh] overflow-y-auto">
          <div className="px-4 py-4 space-y-3">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="block text-white/90 hover:text-white text-sm font-light py-2"
              >
                {link.label}
              </Link>
            ))}
            <div>
              <button
                onClick={() => setIsServicesOpen(!isServicesOpen)}
                className="flex items-center justify-between w-full text-white/90 hover:text-white text-sm font-light py-2"
              >
                Oferta
                <ChevronDown className={`w-4 h-4 transition-transform ${isServicesOpen ? 'rotate-180' : ''}`} />
              </button>
              {isServicesOpen && (
                <div className="mt-2 ml-4 space-y-2">
                  {servicesLinks.map((service) => (
                    <Link
                      key={service.href}
                      href={service.href}
                      onClick={() => {
                        setIsServicesOpen(false);
                        setIsMenuOpen(false);
                      }}
                      className="block text-white/70 active:text-white text-xs font-light py-3 px-3 rounded active:bg-[#d3bb73]/20 transition-colors touch-manipulation"
                    >
                      {service.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {isAuthenticated ? (
              <div className="space-y-2 mt-4">
                <div className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 rounded-lg">
                  {avatarUrl ? (
                    <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-[#d3bb73]/30 flex-shrink-0">
                      <img
                        src={avatarUrl}
                        alt={displayName}
                        className="w-full h-full"
                        style={getAvatarStyle()}
                      />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#d3bb73] to-[#d3bb73]/60 flex items-center justify-center border-2 border-[#d3bb73]/30 flex-shrink-0">
                      <span className="text-[#1c1f33] font-bold text-sm">
                        {getInitials()}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#e5e4e2] truncate">{displayName}</p>
                    <p className="text-[10px] text-[#e5e4e2]/60 truncate">{userEmail}</p>
                  </div>
                  <NotificationCenter />
                </div>
                {crmUser && (
                  <button
                    onClick={() => {
                      router.push('/crm');
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                  >
                    <LayoutDashboard className="w-4 h-4 text-[#d3bb73]" />
                    Panel CRM
                  </button>
                )}
                {authUser && (
                  <button
                    onClick={() => {
                      handleDashboardClick();
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                  >
                    <Settings className="w-4 h-4 text-[#d3bb73]" />
                    Panel Admina
                  </button>
                )}
                {(authUser || canEditWebsite(employee)) && (
                  <button
                    onClick={() => {
                      toggleEditMode();
                      setIsMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors ${isEditMode ? 'bg-[#d3bb73]/10' : ''}`}
                  >
                    {isEditMode ? (
                      <Eye className="w-4 h-4 text-[#d3bb73]" />
                    ) : (
                      <Edit3 className="w-4 h-4 text-[#d3bb73]" />
                    )}
                    {isEditMode ? 'Wyłącz tryb edycji' : 'Włącz tryb edycji'}
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4 text-red-400" />
                  Wyloguj się
                </button>
              </div>
            ) : (
              <button
                onClick={handleLoginClick}
                className="w-full bg-[#800020]/20 text-[#d3bb73] px-6 py-2 rounded-full text-sm font-medium mt-4"
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
