'use client';

import {
  Volume2,
  Video,
  Gamepad2,
  Dices,
  Users,
  Glasses,
  Lightbulb,
  Presentation,
  PartyPopper,
  Wine,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const services = [
  {
    icon: Lightbulb,
    title: 'Technika Sceniczna',
    description: 'Oświetlenie, ekrany LED, efekty specjalne i pełna obsługa techniczna',
    href: '/uslugi/technika-sceniczna',
  },
  {
    icon: Volume2,
    title: 'Nagłośnienie',
    description: 'Profesjonalne systemy nagłośnieniowe najwyższej klasy',
    href: '/uslugi/naglosnienie',
  },
  {
    icon: Video,
    title: 'Streaming',
    description: 'Transmisje online eventów w Full HD i 4K',
    href: '/uslugi/streaming',
  },
  {
    icon: Presentation,
    title: 'Konferencje',
    description: 'Kompleksowa organizacja konferencji i eventów biznesowych',
    href: '/uslugi/konferencje',
  },
  {
    icon: Gamepad2,
    title: 'Quizy & Teleturnieje',
    description: 'Interaktywne quizy i konkursy integracyjne',
    href: '/uslugi/quizy-teleturnieje',
  },
  {
    icon: Users,
    title: 'Teambuildingi',
    description: 'Kreatywne scenariusze team buildingowe',
    href: '/uslugi#teambuilding',
  },
  {
    icon: PartyPopper,
    title: 'Integracje',
    description: 'Imprezy integracyjne dla firm i organizacji',
    href: '/uslugi#integracje',
  },
  {
    icon: Wine,
    title: 'Wieczory Tematyczne',
    description: 'Stylizowane eventy - gatsby, las vegas, hollywood',
    href: '/uslugi#wieczory-tematyczne',
  },
  {
    icon: Dices,
    title: 'Kasyno',
    description: 'Kasyno eventowe z profesjonalnymi stołami i krupierami',
    href: '/uslugi/kasyno',
  },
  {
    icon: Glasses,
    title: 'Symulatory i VR',
    description: 'Symulatory wyścigowe, lotnicze i gogle VR',
    href: '/uslugi/symulatory-vr',
  },
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
    (currentSlide + 1) * itemsPerSlide,
  );

  return (
    <section
      id="uslugi"
      className="relative overflow-hidden bg-[#0f1119] py-24 md:py-32"
      aria-labelledby="services-heading"
    >
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="services-grid"
              x="0"
              y="0"
              width="50"
              height="50"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="#d3bb73" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#services-grid)" />
        </svg>
      </div>

      <div className="absolute inset-0 opacity-5">
        <div className="absolute right-1/4 top-1/4 h-96 w-96 rounded-full bg-[#d3bb73] blur-3xl"></div>
        <div className="absolute bottom-1/4 left-1/4 h-96 w-96 rounded-full bg-[#800020] blur-3xl"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center md:mb-20">
          <div className="inline-block">
            <span className="mb-4 block text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
              Nasze Usługi
            </span>
            <h2
              id="services-heading"
              className="mb-6 text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl"
            >
              Kompleksowa Obsługa Eventowa
            </h2>
            <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Obsługujemy eventy w województwach: warmińsko-mazurskim, kujawsko-pomorskim, pomorskim
              i mazowieckim
            </p>
            <div className="mx-auto mt-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
          </div>
        </div>

        <div className="relative">
          <div className="mb-8 grid gap-6 sm:grid-cols-2 md:gap-8 lg:grid-cols-3">
            {visibleServices.map((service, index) => {
              const Icon = service.icon;
              return (
                <Link href={service.href} key={index}>
                  <article className="group relative h-full cursor-pointer rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:transform hover:border-[#d3bb73]/30 hover:shadow-2xl hover:shadow-[#d3bb73]/10">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>

                    <div className="relative z-10">
                      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 transition-transform duration-300 group-hover:scale-110">
                        <Icon className="h-7 w-7 text-[#d3bb73]" />
                      </div>

                      <h3 className="mb-3 text-lg font-light text-[#e5e4e2] transition-colors duration-300 group-hover:text-[#d3bb73]">
                        {service.title}
                      </h3>

                      <p className="mb-4 text-sm font-light leading-relaxed text-[#e5e4e2]/60">
                        {service.description}
                      </p>

                      <div className="flex items-center gap-2 text-sm font-medium text-[#d3bb73] opacity-0 transition-all duration-300 group-hover:opacity-100">
                        Zobacz więcej
                        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                      </div>
                    </div>

                    <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-full bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
                  </article>
                </Link>
              );
            })}
          </div>

          {totalSlides > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={prevSlide}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 transition-colors hover:bg-[#d3bb73]/20"
                aria-label="Previous slide"
              >
                <ChevronLeft className="h-6 w-6 text-[#d3bb73]" />
              </button>

              <div className="flex gap-2">
                {Array.from({ length: totalSlides }).map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlide(index)}
                    className={`h-2 w-2 rounded-full transition-all duration-300 ${
                      index === currentSlide ? 'w-8 bg-[#d3bb73]' : 'bg-[#d3bb73]/30'
                    }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={nextSlide}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 transition-colors hover:bg-[#d3bb73]/20"
                aria-label="Next slide"
              >
                <ChevronRight className="h-6 w-6 text-[#d3bb73]" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-16 text-center">
          <p className="mb-6 text-lg font-light text-[#e5e4e2]/80">
            Nie znalazłeś tego czego szukasz?
          </p>
          <a
            href="#kontakt"
            className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-all duration-200 hover:bg-[#d3bb73]/20"
          >
            Skontaktuj się z nami
          </a>
        </div>
      </div>
    </section>
  );
}
