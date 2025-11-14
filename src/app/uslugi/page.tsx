'use client';

import Link from 'next/link';
import {
  Mic,
  Presentation,
  Monitor,
  Gamepad2,
  Sparkles,
  Users,
  Video,
  Lamp,
  ArrowRight,
} from 'lucide-react';

const services = [
  {
    title: 'Nagłośnienie',
    description: 'Profesjonalne systemy audio i nagłośnienie eventów',
    href: '/uslugi/naglosnienie',
    icon: Mic,
    color: 'from-blue-500/20 to-blue-600/20',
    borderColor: 'border-blue-500/30',
  },
  {
    title: 'Konferencje',
    description: 'Kompleksowa obsługa techniczna konferencji',
    href: '/uslugi/konferencje',
    icon: Presentation,
    color: 'from-green-500/20 to-green-600/20',
    borderColor: 'border-green-500/30',
  },
  {
    title: 'Streaming',
    description: 'Transmisje live i produkcja wideo online',
    href: '/uslugi/streaming',
    icon: Video,
    color: 'from-red-500/20 to-red-600/20',
    borderColor: 'border-red-500/30',
  },
  {
    title: 'Symulatory VR',
    description: 'Wirtualna rzeczywistość i symulatory na eventy',
    href: '/uslugi/symulatory-vr',
    icon: Gamepad2,
    color: 'from-purple-500/20 to-purple-600/20',
    borderColor: 'border-purple-500/30',
  },
  {
    title: 'Quizy & Teleturnieje',
    description: 'Interaktywne quizy i gry dla gości',
    href: '/uslugi/quizy-teleturnieje',
    icon: Sparkles,
    color: 'from-yellow-500/20 to-yellow-600/20',
    borderColor: 'border-yellow-500/30',
  },
  {
    title: 'Integracje',
    description: 'Eventy integracyjne i team building',
    href: '/uslugi/integracje',
    icon: Users,
    color: 'from-pink-500/20 to-pink-600/20',
    borderColor: 'border-pink-500/30',
  },
  {
    title: 'Kasyno',
    description: 'Profesjonalne stoły do gier kasynowych',
    href: '/uslugi/kasyno',
    icon: Sparkles,
    color: 'from-orange-500/20 to-orange-600/20',
    borderColor: 'border-orange-500/30',
  },
  {
    title: 'Wieczory Tematyczne',
    description: 'Organizacja eventów tematycznych',
    href: '/uslugi/wieczory-tematyczne',
    icon: Lamp,
    color: 'from-cyan-500/20 to-cyan-600/20',
    borderColor: 'border-cyan-500/30',
  },
  {
    title: 'Technika Sceniczna',
    description: 'Oświetlenie, sceny i efekty specjalne',
    href: '/uslugi/technika-sceniczna',
    icon: Monitor,
    color: 'from-indigo-500/20 to-indigo-600/20',
    borderColor: 'border-indigo-500/30',
  },
];

export default function UslugiPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0f1119] to-[#1c1f33] pb-20 pt-32">
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-5xl lg:text-6xl">
            Nasze <span className="font-normal text-[#d3bb73]">Usługi</span>
          </h1>
          <p className="mx-auto max-w-3xl text-lg text-[#e5e4e2]/70">
            Oferujemy kompleksową obsługę techniczną i organizację eventów. Wybierz usługę, która
            Cię interesuje i poznaj szczegóły.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <Link
                key={service.href}
                href={service.href}
                className="group relative rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-8 backdrop-blur-sm transition-all duration-500 hover:scale-[1.02] hover:border-[#d3bb73]/50 hover:shadow-2xl hover:shadow-[#d3bb73]/10"
                style={{
                  animationDelay: `${index * 0.1}s`,
                  animation: 'fadeInUp 0.6s ease-out forwards',
                  opacity: 0,
                }}
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${service.color} rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
                />

                <div className="relative z-10">
                  <div
                    className={`inline-flex rounded-xl bg-gradient-to-br p-4 ${service.color} border ${service.borderColor} mb-6 transition-transform duration-500 group-hover:scale-110`}
                  >
                    <Icon className="h-8 w-8 text-[#e5e4e2]" />
                  </div>

                  <h3 className="mb-3 text-2xl font-light text-[#e5e4e2] transition-colors duration-300 group-hover:text-[#d3bb73]">
                    {service.title}
                  </h3>

                  <p className="mb-6 text-sm leading-relaxed text-[#e5e4e2]/70">
                    {service.description}
                  </p>

                  <div className="flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
                    <span>Zobacz szczegóły</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-2" />
                  </div>
                </div>

                <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-[#d3bb73]/5 blur-3xl transition-all duration-500 group-hover:bg-[#d3bb73]/10" />
              </Link>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <Link
            href="/#contact"
            className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-4 font-medium text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:bg-[#d3bb73]/90 hover:shadow-lg hover:shadow-[#d3bb73]/40"
          >
            Skontaktuj się z nami
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
