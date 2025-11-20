'use client';

import { Mail, Phone, MapPin, Facebook, Instagram, Linkedin, ArrowUp } from 'lucide-react';
import Link from 'next/link';

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="relative bg-[#0f1120] border-t border-[#d3bb73]/10">
      <div className="absolute inset-0 opacity-5">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="footer-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#footer-dots)" />
        </svg>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          <div className="space-y-6">
            <div>
              <Link href="/" className="inline-block">
                <img
                  src="/logo mavinci.svg"
                  alt="MAVINCI event & art"
                  className="h-12 w-auto mb-4"
                />
              </Link>
              <p className="text-[#e5e4e2]/60 text-sm font-light leading-relaxed">
                Sztuka Tworzenia Eventów
              </p>
            </div>
            <div className="flex gap-3">
              {[
                { icon: Facebook, href: 'https://facebook.com', label: 'Facebook' },
                { icon: Instagram, href: 'https://instagram.com', label: 'Instagram' },
                { icon: Linkedin, href: 'https://linkedin.com', label: 'LinkedIn' },
              ].map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-[#d3bb73]/10 flex items-center justify-center hover:bg-[#d3bb73] transition-all duration-300 hover:scale-110 group"
                  aria-label={social.label}
                >
                  <social.icon className="w-5 h-5 text-[#d3bb73] group-hover:text-[#1c1f33] transition-colors duration-300" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[#e5e4e2] font-light text-lg mb-6">Usługi</h4>
            <ul className="space-y-3">
              {[
                { name: 'Wszystkie Oferty', href: '/oferta' },
                { name: 'Konferencje', href: '/oferta/konferencje' },
                { name: 'Integracje firmowe', href: '/oferta/integracje' },
                { name: 'Wieczory tematyczne', href: '/oferta/wieczory-tematyczne' },
                { name: 'Technika sceniczna', href: '/oferta/technika-sceniczna' },
                { name: 'Streaming', href: '/oferta/streaming' }
              ].map((service) => (
                <li key={service.name}>
                  <Link href={service.href} className="text-[#e5e4e2]/60 hover:text-[#d3bb73] transition-colors duration-300 text-sm font-light">
                    {service.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-[#e5e4e2] font-light text-lg mb-6">Firma</h4>
            <ul className="space-y-3">
              {[
                { name: 'O Nas', href: '/o-nas' },
                { name: 'Portfolio', href: '/portfolio' },
                { name: 'Zespół', href: '/zespol' },
                { name: 'Kontakt', href: '/#kontakt' }
              ].map((item) => (
                <li key={item.name}>
                  <Link href={item.href} className="text-[#e5e4e2]/60 hover:text-[#d3bb73] transition-colors duration-300 text-sm font-light">
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-[#e5e4e2] font-light text-lg mb-6">Kontakt</h4>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                <a href="tel:+48123456789" className="text-[#e5e4e2]/60 hover:text-[#d3bb73] transition-colors duration-300 text-sm font-light">
                  +48 698 212 279
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                <a href="mailto:kontakt@mavinci.pl" className="text-[#e5e4e2]/60 hover:text-[#d3bb73] transition-colors duration-300 text-sm font-light">
                  biuro@mavinci.pl
                </a>
              </li>
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                <span className="text-[#e5e4e2]/60 text-sm font-light">
                  ul. Hugona Kołłątaja 5, p. 320
<br />
                  11-041 Olsztyn
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-[#d3bb73]/10 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-[#e5e4e2]/40 text-sm font-light text-center sm:text-left">
            © 2024 Mavinci Events. Wszystkie prawa zastrzeżone.
          </p>
          <div className="flex gap-6">
            <a href="#" className="text-[#e5e4e2]/40 hover:text-[#d3bb73] transition-colors duration-300 text-sm font-light">
              Polityka Prywatności
            </a>
            <a href="#" className="text-[#e5e4e2]/40 hover:text-[#d3bb73] transition-colors duration-300 text-sm font-light">
              Regulamin
            </a>
          </div>
        </div>
      </div>

      <button
        onClick={scrollToTop}
        className="fixed bottom-8 right-8 w-12 h-12 bg-[#d3bb73] rounded-full flex items-center justify-center hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-110 shadow-lg shadow-[#d3bb73]/30 z-50 group"
        aria-label="Scroll to top"
      >
        <ArrowUp className="w-6 h-6 text-[#1c1f33] group-hover:-translate-y-1 transition-transform duration-300" />
      </button>
    </footer>
  );
}
