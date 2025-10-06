'use client';

import { ShieldCheck, LogOut, Settings, User, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppSelector } from '../store/hooks';

interface NavbarProps {
  onAdminClick?: () => void;
}

export default function Navbar({ onAdminClick }: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isServicesOpen, setIsServicesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const { signOut, user } = useAuth();
  const router = useRouter();
  const authUser = useAppSelector((state) => state.auth.user);

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
      if (servicesRef.current && !servicesRef.current.contains(event.target as Node)) {
        setIsServicesOpen(false);
      }
    }

    if (isDropdownOpen || isServicesOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, isServicesOpen]);

  const handleLogout = async () => {
    await signOut();
    setIsDropdownOpen(false);
    router.push('/');
  };

  const handleLoginClick = () => {
    router.push('/admin/login');
  };

  const handleDashboardClick = () => {
    router.push('/admin/dashboard');
    setIsDropdownOpen(false);
  };

  const isAuthenticated = !!user || !!authUser;
  const displayName = authUser?.user_name || 'Admin';
  const avatarUrl = authUser?.user_avatar?.image_metadata?.desktop?.src || authUser?.user_avatar;

  return (
    <nav className="absolute top-4 left-0 right-0 z-50 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto bg-[#1c1f33]/90 backdrop-blur-md rounded-full px-6 md:px-8 border border-[#d3bb73]/20">
        <div className="flex items-center justify-between h-14 md:h-16">
          <Link href="/" className="flex items-center">
            <img
              src="/logo mavinci.svg"
              alt="MAVINCI event & art"
              className="h-8 md:h-10 w-auto"
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
                Usługi
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
            {isAuthenticated ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-2 bg-[#800020]/20 text-[#e5e4e2] px-4 py-2 rounded-full text-sm font-medium hover:bg-[#800020]/30 transition-colors duration-200"
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="w-6 h-6 rounded-full object-cover"
                    />
                  ) : (
                    <User className="w-4 h-4 text-[#d3bb73]" />
                  )}
                  <span className="text-[#d3bb73]">{displayName}</span>
                  <ChevronDown className={`w-4 h-4 text-[#d3bb73] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#d3bb73]/20">
                      <p className="text-sm text-[#e5e4e2] font-medium">{displayName}</p>
                      <p className="text-xs text-[#e5e4e2]/60">{authUser?.user_email?.address}</p>
                    </div>
                    <div className="py-2">
                      <button
                        onClick={handleDashboardClick}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors"
                      >
                        <Settings className="w-4 h-4 text-[#d3bb73]" />
                        Panel Admina
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4 text-[#d3bb73]" />
                        Wyloguj się
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
            <Link href="/#kontakt" className="bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors duration-200">
              Skontaktuj się
            </Link>
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
        <div className="md:hidden bg-[#1c1f33]/95 backdrop-blur-lg rounded-b-3xl mt-2">
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
                Usługi
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
                      className="block text-white/70 hover:text-white text-xs font-light py-1"
                    >
                      {service.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {isAuthenticated ? (
              <>
                <button
                  onClick={handleDashboardClick}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4 text-[#d3bb73]" />
                  Panel Admina
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4 text-[#d3bb73]" />
                  Wyloguj się
                </button>
              </>
            ) : (
              <button
                onClick={handleLoginClick}
                className="w-full bg-[#800020]/20 text-[#d3bb73] px-6 py-2 rounded-full text-sm font-medium mt-4"
              >
                Zaloguj się
              </button>
            )}
            <Link href="/#kontakt" onClick={() => setIsMenuOpen(false)} className="block w-full bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-full text-sm font-medium mt-4 text-center">
              Skontaktuj się
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
