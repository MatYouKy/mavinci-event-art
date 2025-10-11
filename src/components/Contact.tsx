'use client';

import { Mail, Phone, MapPin, Facebook, Instagram, Linkedin } from 'lucide-react';
import ContactForm from './ContactForm';

export default function Contact() {

  return (
    <section id="kontakt" className="relative py-24 md:py-32 bg-[#1c1f33] overflow-hidden" aria-labelledby="contact-heading">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="contact-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern id="contact-lines" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#contact-dots)" />
          <rect width="100%" height="100%" fill="url(#contact-lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#800020] rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16 md:mb-20">
          <div className="inline-block">
            <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block animate-[fadeIn_0.6s_ease-out]">
              Rozpocznijmy współpracę
            </span>
            <h2 id="contact-heading" className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6 animate-[fadeIn_0.8s_ease-out]">
              Zorganizujmy Twój Event
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto animate-[scaleIn_1s_ease-out]"></div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 md:gap-16">
          <div className="space-y-8 animate-[fadeInLeft_0.8s_ease-out]">
            <div className="prose prose-invert max-w-none">
              <p className="text-[#e5e4e2]/80 text-lg font-light leading-relaxed mb-6">
                Skontaktuj się z nami - otrzymasz bezpłatną wycenę w 24h.
              </p>
              <div className="mb-8">
                <p className="text-[#d3bb73] text-sm font-light tracking-wider uppercase mb-3">
                  Realizujemy eventy w województwach:
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1.5 bg-[#d3bb73]/10 border border-[#d3bb73]/20 rounded-full text-[#e5e4e2]/80 text-sm">
                    Warmińsko-Mazurskie
                  </span>
                  <span className="px-3 py-1.5 bg-[#d3bb73]/10 border border-[#d3bb73]/20 rounded-full text-[#e5e4e2]/80 text-sm">
                    Kujawsko-Pomorskie
                  </span>
                  <span className="px-3 py-1.5 bg-[#d3bb73]/10 border border-[#d3bb73]/20 rounded-full text-[#e5e4e2]/80 text-sm">
                    Pomorskie
                  </span>
                  <span className="px-3 py-1.5 bg-[#d3bb73]/10 border border-[#d3bb73]/20 rounded-full text-[#e5e4e2]/80 text-sm">
                    Mazowieckie
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="group flex items-start gap-4 p-4 rounded-xl hover:bg-[#d3bb73]/5 transition-all duration-300">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-all duration-300 group-hover:scale-110">
                  <Phone className="w-6 h-6 text-[#d3bb73]" />
                </div>
                <div>
                  <h3 className="text-[#e5e4e2] font-light text-lg mb-1">Telefon</h3>
                  <a href="tel:+48123456789" className="text-[#e5e4e2]/70 hover:text-[#d3bb73] transition-colors duration-300">
                    +48 123 456 789
                  </a>
                </div>
              </div>

              <div className="group flex items-start gap-4 p-4 rounded-xl hover:bg-[#d3bb73]/5 transition-all duration-300">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-all duration-300 group-hover:scale-110">
                  <Mail className="w-6 h-6 text-[#d3bb73]" />
                </div>
                <div>
                  <h3 className="text-[#e5e4e2] font-light text-lg mb-1">Email</h3>
                  <a href="mailto:kontakt@mavinci.pl" className="text-[#e5e4e2]/70 hover:text-[#d3bb73] transition-colors duration-300">
                    kontakt@mavinci.pl
                  </a>
                </div>
              </div>

              <div className="group flex items-start gap-4 p-4 rounded-xl hover:bg-[#d3bb73]/5 transition-all duration-300">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#d3bb73]/10 flex items-center justify-center group-hover:bg-[#d3bb73]/20 transition-all duration-300 group-hover:scale-110">
                  <MapPin className="w-6 h-6 text-[#d3bb73]" />
                </div>
                <div>
                  <h3 className="text-[#e5e4e2] font-light text-lg mb-1">Adres</h3>
                  <p className="text-[#e5e4e2]/70">
                    ul. Eventowa 12<br />
                    00-001 Warszawa
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-8">
              <h3 className="text-[#e5e4e2] font-light text-lg mb-4">Znajdź nas w mediach społecznościowych</h3>
              <div className="flex gap-4">
                {[
                  { icon: Facebook, href: '#' },
                  { icon: Instagram, href: '#' },
                  { icon: Linkedin, href: '#' },
                ].map((social, index) => (
                  <a
                    key={index}
                    href={social.href}
                    className="w-12 h-12 rounded-full bg-[#d3bb73]/10 flex items-center justify-center hover:bg-[#d3bb73] transition-all duration-300 hover:scale-110 hover:rotate-12 group"
                  >
                    <social.icon className="w-6 h-6 text-[#d3bb73] group-hover:text-[#1c1f33] transition-colors duration-300" />
                  </a>
                ))}
              </div>
            </div>
          </div>

          <ContactForm category="event_inquiry" />
        </div>
      </div>


      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }

        @keyframes fadeInLeft {
          from {
            opacity: 0;
            transform: translateX(-30px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes fadeInRight {
          from {
            opacity: 0;
            transform: translateX(30px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </section>
  );
}
