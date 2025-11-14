'use client';

import { Mail, Phone, MapPin, Facebook, Instagram, Linkedin, ArrowUp } from 'lucide-react';
import Link from 'next/link';

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="relative border-t border-[#d3bb73]/10 bg-[#0f1120]">
      <div className="absolute inset-0 opacity-5">
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

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-12 grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-6">
            <div>
              <Link href="/" className="inline-block">
                <img
                  src="/logo mavinci.svg"
                  alt="MAVINCI event & art"
                  className="mb-4 h-12 w-auto"
                />
              </Link>
              <p className="text-sm font-light leading-relaxed text-[#e5e4e2]/60">
                Sztuka Tworzenia Eventów
              </p>
            </div>
            <div className="flex gap-3">
              {[
                { icon: Facebook, href: 'https://facebook.com/mavinci', label: 'Facebook' },
                { icon: Instagram, href: 'https://instagram.com/mavinci', label: 'Instagram' },
                { icon: Linkedin, href: 'https://linkedin.com/company/mavinci', label: 'LinkedIn' },
              ].map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 hover:scale-110 hover:bg-[#d3bb73]"
                  aria-label={social.label}
                >
                  <social.icon className="h-5 w-5 text-[#d3bb73] transition-colors duration-300 group-hover:text-[#1c1f33]" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-6 text-lg font-light text-[#e5e4e2]">Usługi</h4>
            <ul className="space-y-3">
              {[
                { name: 'Wszystkie usługi', href: '/uslugi' },
                { name: 'Konferencje', href: '/uslugi/konferencje' },
                { name: 'Integracje firmowe', href: '/uslugi/integracje' },
                { name: 'Wieczory tematyczne', href: '/uslugi/wieczory-tematyczne' },
                { name: 'Technika sceniczna', href: '/uslugi/technika-sceniczna' },
                { name: 'Streaming', href: '/uslugi/streaming' },
              ].map((service) => (
                <li key={service.name}>
                  <Link
                    href={service.href}
                    className="text-sm font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73]"
                  >
                    {service.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-6 text-lg font-light text-[#e5e4e2]">Firma</h4>
            <ul className="space-y-3">
              {[
                { name: 'O Nas', href: '/o-nas' },
                { name: 'Portfolio', href: '/portfolio' },
                { name: 'Zespół', href: '/zespol' },
                { name: 'Kontakt', href: '/#kontakt' },
              ].map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="text-sm font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73]"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-6 text-lg font-light text-[#e5e4e2]">Kontakt</h4>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <Phone className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                <a
                  href="tel:+48123456789"
                  className="text-sm font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73]"
                >
                  +48 698 212 279
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                <a
                  href="mailto:kontakt@mavinci.pl"
                  className="text-sm font-light text-[#e5e4e2]/60 transition-colors duration-300 hover:text-[#d3bb73]"
                >
                  biuro@mavinci.pl
                </a>
              </li>
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                <span className="text-sm font-light text-[#e5e4e2]/60">
                  ul. Hugona Kołłątaja 5, p. 320
                  <br />
                  11-041 Olsztyn
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-[#d3bb73]/10 pt-8 sm:flex-row">
          <p className="text-center text-sm font-light text-[#e5e4e2]/40 sm:text-left">
            © 2024 Mavinci Events. Wszystkie prawa zastrzeżone.
          </p>
          <div className="flex gap-6">
            <a
              href="#"
              className="text-sm font-light text-[#e5e4e2]/40 transition-colors duration-300 hover:text-[#d3bb73]"
            >
              Polityka Prywatności
            </a>
            <a
              href="#"
              className="text-sm font-light text-[#e5e4e2]/40 transition-colors duration-300 hover:text-[#d3bb73]"
            >
              Regulamin
            </a>
          </div>
        </div>
      </div>

      <button
        onClick={scrollToTop}
        className="group fixed bottom-8 right-8 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73] shadow-lg shadow-[#d3bb73]/30 transition-all duration-300 hover:scale-110 hover:bg-[#d3bb73]/90"
        aria-label="Scroll to top"
      >
        <ArrowUp className="h-6 w-6 text-[#1c1f33] transition-transform duration-300 group-hover:-translate-y-1" />
      </button>
    </footer>
  );
}
