'use client';

import { useEditMode } from '@/contexts/EditModeContext';
import { Mail, Phone, MapPin, Facebook, Instagram, Linkedin, ArrowUp } from 'lucide-react';
import Link from 'next/link';

export default function Footer() {
  const { isEditMode } = useEditMode();
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="relative border-t border-[#d3bb73]/10 bg-[#0f1120]">
      {/* tło z kropkami */}
      <div className="pointer-events-none absolute inset-0 opacity-5">
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="footer-dots"
              x="0"
              y="0"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#footer-dots)" />
        </svg>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        {/* Główna siatka */}
        <div className="mb-10 grid grid-cols-1 gap-8 sm:mb-12 sm:gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-12">
          {/* Logo + social */}
          <div className="space-y-6">
            <div>
              <Link href="/" className="inline-block">
                <img
                  src="/logo mavinci.svg"
                  alt="MAVINCI event & art"
                  className="mb-3 h-10 w-auto sm:mb-4 sm:h-12"
                />
              </Link>
              <p className="text-xs font-light leading-relaxed text-[#e5e4e2]/60 sm:text-sm">
                Sztuka Tworzenia Eventów
              </p>
            </div>
            <div className="flex gap-2.5 sm:gap-3">
              {[
                {
                  icon: Facebook,
                  href: 'https://www.facebook.com/Mavincieventart',
                  label: 'Facebook',
                },
                { icon: Instagram, href: 'https://instagram.com', label: 'Instagram' },
                { icon: Linkedin, href: 'https://linkedin.com', label: 'LinkedIn' },
              ].map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-9 w-9 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 hover:scale-110 hover:bg-[#d3bb73] sm:h-10 sm:w-10"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4 text-[#d3bb73] transition-colors duration-300 group-hover:text-[#1c1f33] sm:h-5 sm:w-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Usługi */}
          <div>
            <h4 className="mb-4 text-base font-light text-[#e5e4e2] sm:mb-6 sm:text-lg">Usługi</h4>
            <ul className="space-y-2.5 sm:space-y-3">
              {[
                { name: 'Wszystkie Oferty', href: '/oferta' },
                { name: 'Konferencje', href: '/oferta/konferencje' },
                { name: 'Integracje firmowe', href: '/oferta/integracje' },
                { name: 'Wieczory tematyczne', href: '/oferta/wieczory-tematyczne' },
                { name: 'Technika sceniczna', href: '/oferta/technika-sceniczna' },
                { name: 'Streaming', href: '/oferta/streaming' },
              ].map((service) => (
                <li key={service.name}>
                  <Link
                    href={service.href}
                    className="text-xs font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73] sm:text-sm"
                  >
                    {service.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Firma */}
          <div>
            <h4 className="mb-4 text-base font-light text-[#e5e4e2] sm:mb-6 sm:text-lg">Firma</h4>
            <ul className="space-y-2.5 sm:space-y-3">
              {[
                { name: 'O Nas', href: '/o-nas' },
                { name: 'Portfolio', href: '/portfolio' },
                { name: 'Zespół', href: '/zespol' },
                { name: 'Kontakt', href: '/#kontakt' },
              ].map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="text-xs font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73] sm:text-sm"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Kontakt */}
          <div>
            <h4 className="mb-4 text-base font-light text-[#e5e4e2] sm:mb-6 sm:text-lg">Kontakt</h4>
            <ul className="space-y-3.5 sm:space-y-4">
              <li className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73] sm:h-5 sm:w-5" />
                <a
                  href="tel:+48698212279"
                  className="text-xs font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73] sm:text-sm"
                >
                  +48 698 212 279
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73] sm:h-5 sm:w-5" />
                <a
                  href="mailto:biuro@mavinci.pl"
                  className="break-all text-xs font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73] sm:text-sm"
                >
                  biuro@mavinci.pl
                </a>
              </li>
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73] sm:h-5 sm:w-5" />
                <span className="text-xs font-light leading-relaxed text-[#e5e4e2]/60 sm:text-sm">
                  ul. Hugona Kołłątaja 5, p. 320
                  <br />
                  11-041 Olsztyn
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Dolny pasek */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-[#d3bb73]/10 pt-6 sm:flex-row sm:gap-4 sm:pt-8">
          <p className="text-center text-xs font-light text-[#e5e4e2]/40 sm:text-left sm:text-sm">
            © 2024 Mavinci Events. Wszystkie prawa zastrzeżone.
          </p>
          <div className="flex flex-wrap justify-center gap-3 sm:justify-end sm:gap-6">
            <a
              href="#"
              className="text-xs font-light text-[#e5e4e2]/40 transition-colors duration-300 hover:text-[#d3bb73] sm:text-sm"
            >
              Polityka Prywatności
            </a>
            <a
              href="#"
              className="text-xs font-light text-[#e5e4e2]/40 transition-colors duration-300 hover:text-[#d3bb73] sm:text-sm"
            >
              Regulamin
            </a>
          </div>
        </div>
      </div>

      {/* Scroll to top */}
      {!isEditMode && (
        <button
          onClick={scrollToTop}
          className="group fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73] shadow-lg shadow-[#d3bb73]/30 transition-all duration-300 hover:scale-110 hover:bg-[#d3bb73]/90 sm:bottom-6 sm:right-6 sm:h-12 sm:w-12"
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-5 w-5 text-[#1c1f33] transition-transform duration-300 group-hover:-translate-y-1 sm:h-6 sm:w-6" />
        </button>
      )}
    </footer>
  );
}
