'use client';

import { Volume2, Video, Gamepad2, Dices, Users, Glasses, Lightbulb, Presentation, PartyPopper, Wine, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const services = [
  {
    icon: Lightbulb,
    title: 'Technika Sceniczna',
    description: 'Oświetlenie, ekrany LED, efekty specjalne i pełna obsługa techniczna',
    href: '/uslugi/technika-sceniczna'
  },
  {
    icon: Volume2,
    title: 'Nagłośnienie',
    description: 'Profesjonalne systemy nagłośnieniowe najwyższej klasy',
    href: '/uslugi/naglosnienie'
  },
  {
    icon: Video,
    title: 'Streaming',
    description: 'Transmisje online eventów w Full HD i 4K',
    href: '/uslugi/streaming'
  },
  {
    icon: Presentation,
    title: 'Konferencje',
    description: 'Kompleksowa organizacja konferencji i eventów biznesowych',
    href: '/uslugi/konferencje'
  },
  {
    icon: Gamepad2,
    title: 'Quizy & Teleturnieje',
    description: 'Interaktywne quizy i konkursy integracyjne',
    href: '/uslugi/quizy-teleturnieje'
  },
  {
    icon: Users,
    title: 'Teambuildingi',
    description: 'Kreatywne scenariusze team buildingowe',
    href: '/uslugi#teambuilding'
  },
  {
    icon: PartyPopper,
    title: 'Integracje',
    description: 'Imprezy integracyjne dla firm i organizacji',
    href: '/uslugi#integracje'
  },
  {
    icon: Wine,
    title: 'Wieczory Tematyczne',
    description: 'Stylizowane eventy - gatsby, las vegas, hollywood',
    href: '/uslugi#wieczory-tematyczne'
  },
  {
    icon: Dices,
    title: 'Kasyno',
    description: 'Kasyno eventowe z profesjonalnymi stołami i krupierami',
    href: '/uslugi/kasyno'
  },
  {
    icon: Glasses,
    title: 'Symulatory i VR',
    description: 'Symulatory wyścigowe, lotnicze i gogle VR',
    href: '/uslugi/symulatory-vr'
  }
];

export default function Services() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const itemsPerSlide = 6;
  const totalSlides = Math.ceil(services.length / itemsPerSlide);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % totalSlides);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + totalSlides) % totalSlides);
  };

  const visibleServices = services.slice(
    currentSlide * itemsPerSlide,
    (currentSlide + 1) * itemsPerSlide
  );

  return (
    <section id="uslugi" className="relative py-24 md:py-32 bg-[#0f1119] overflow-hidden" aria-labelledby="services-heading">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="services-grid" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#d3bb73" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#services-grid)" />
        </svg>
      </div>

      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-[#800020] rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16 md:mb-20">
          <div className="inline-block">
            <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block">
              Nasze Usługi
            </span>
            <h2 id="services-heading" className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6">
              Kompleksowa Obsługa Eventowa
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light max-w-2xl mx-auto">
              Obsługujemy eventy w województwach: warmińsko-mazurskim, kujawsko-pomorskim, pomorskim i mazowieckim
            </p>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto mt-6"></div>
          </div>
        </div>

        <div className="relative">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 mb-8">
            {visibleServices.map((service, index) => {
              const Icon = service.icon;
              return (
                <Link href={service.href} key={index}>
                  <article
                    className="group relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300 hover:transform hover:-translate-y-2 hover:shadow-2xl hover:shadow-[#d3bb73]/10 cursor-pointer h-full"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"></div>

                    <div className="relative z-10">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Icon className="w-7 h-7 text-[#d3bb73]" />
                      </div>

                      <h3 className="text-[#e5e4e2] text-lg font-light mb-3 group-hover:text-[#d3bb73] transition-colors duration-300">
                        {service.title}
                      </h3>

                      <p className="text-[#e5e4e2]/60 text-sm font-light leading-relaxed mb-4">
                        {service.description}
                      </p>

                      <div className="flex items-center gap-2 text-[#d3bb73] text-sm font-medium opacity-0 group-hover:opacity-100 transition-all duration-300">
                        Zobacz więcej
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
                      </div>
                    </div>

                    <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-[#d3bb73]/5 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </article>
                </Link>
              );
            })}
          </div>

          {totalSlides > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={prevSlide}
                className="w-12 h-12 rounded-full bg-[#d3bb73]/10 border border-[#d3bb73]/30 flex items-center justify-center hover:bg-[#d3bb73]/20 transition-colors"
                aria-label="Previous slide"
              >
                <ChevronLeft className="w-6 h-6 text-[#d3bb73]" />
              </button>

              <div className="flex gap-2">
                {Array.from({ length: totalSlides }).map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlide(index)}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      index === currentSlide ? 'w-8 bg-[#d3bb73]' : 'bg-[#d3bb73]/30'
                    }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={nextSlide}
                className="w-12 h-12 rounded-full bg-[#d3bb73]/10 border border-[#d3bb73]/30 flex items-center justify-center hover:bg-[#d3bb73]/20 transition-colors"
                aria-label="Next slide"
              >
                <ChevronRight className="w-6 h-6 text-[#d3bb73]" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-16 text-center">
          <p className="text-[#e5e4e2]/80 text-lg font-light mb-6">
            Nie znalazłeś tego czego szukasz?
          </p>
          <a
            href="#kontakt"
            className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-all duration-200"
          >
            Skontaktuj się z nami
          </a>
        </div>
      </div>
    </section>
  );
}
