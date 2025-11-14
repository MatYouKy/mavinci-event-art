'use client';

import { useEffect, useState } from 'react';
import { Mail, Phone, MapPin, Facebook, Instagram, Linkedin } from 'lucide-react';
import ContactForm from './ContactForm';

export default function Contact() {
  const [formCategory, setFormCategory] = useState<'event_inquiry' | 'team_join'>('event_inquiry');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('career') === 'true') {
        setFormCategory('team_join');
      }
    }
  }, []);

  return (
    <section
      id="kontakt"
      className="relative overflow-hidden bg-[#1c1f33] py-24 md:py-32"
      aria-labelledby="contact-heading"
    >
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="contact-dots"
              x="0"
              y="0"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern
              id="contact-lines"
              x="0"
              y="0"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#contact-dots)" />
          <rect width="100%" height="100%" fill="url(#contact-lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-[#d3bb73] blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-[#800020] blur-3xl"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center md:mb-20">
          <div className="inline-block">
            <span className="mb-4 block animate-[fadeIn_0.6s_ease-out] text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
              Rozpocznijmy współpracę
            </span>
            <h2
              id="contact-heading"
              className="mb-6 animate-[fadeIn_0.8s_ease-out] text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl"
            >
              Zorganizujmy Twój Event
            </h2>
            <div className="mx-auto h-1 w-24 animate-[scaleIn_1s_ease-out] bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
          </div>
        </div>

        <div className="grid gap-12 md:gap-16 lg:grid-cols-2">
          <div className="animate-[fadeInLeft_0.8s_ease-out] space-y-8">
            <div className="prose prose-invert max-w-none">
              <p className="mb-6 text-lg font-light leading-relaxed text-[#e5e4e2]/80">
                Skontaktuj się z nami - otrzymasz bezpłatną wycenę w 24h.
              </p>
              <div className="mb-8">
                <p className="mb-3 text-sm font-light uppercase tracking-wider text-[#d3bb73]">
                  Realizujemy eventy w województwach:
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#e5e4e2]/80">
                    Warmińsko-Mazurskie
                  </span>
                  <span className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#e5e4e2]/80">
                    Kujawsko-Pomorskie
                  </span>
                  <span className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#e5e4e2]/80">
                    Pomorskie
                  </span>
                  <span className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#e5e4e2]/80">
                    Mazowieckie
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="group flex items-start gap-4 rounded-xl p-4 transition-all duration-300 hover:bg-[#d3bb73]/5">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-[#d3bb73]/20">
                  <Phone className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <div>
                  <h3 className="mb-1 text-lg font-light text-[#e5e4e2]">Telefon</h3>
                  <a
                    href="tel:+48123456789"
                    className="text-[#e5e4e2]/70 transition-colors duration-300 hover:text-[#d3bb73]"
                  >
                    +48 698 212 279
                  </a>
                </div>
              </div>

              <div className="group flex items-start gap-4 rounded-xl p-4 transition-all duration-300 hover:bg-[#d3bb73]/5">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-[#d3bb73]/20">
                  <Mail className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <div>
                  <h3 className="mb-1 text-lg font-light text-[#e5e4e2]">Email</h3>
                  <a
                    href="mailto:kontakt@mavinci.pl"
                    className="text-[#e5e4e2]/70 transition-colors duration-300 hover:text-[#d3bb73]"
                  >
                    biuro@mavinci.pl
                  </a>
                </div>
              </div>

              <div className="group flex items-start gap-4 rounded-xl p-4 transition-all duration-300 hover:bg-[#d3bb73]/5">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-[#d3bb73]/20">
                  <MapPin className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <div>
                  <h3 className="mb-1 text-lg font-light text-[#e5e4e2]">Adres</h3>
                  <p className="text-[#e5e4e2]/70">
                    ul. Hugona Kołłątaja 5, p. 320
                    <br />
                    11-041 Olsztyn
                  </p>
                </div>
              </div>
            </div>
          </div>

          <ContactForm category={formCategory} />
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
