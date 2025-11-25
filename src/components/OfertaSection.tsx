'use client';

import { ArrowRight, Mic, Presentation, Monitor, Gamepad2, Sparkles, Users, Video, Lamp, Dices } from 'lucide-react';
import Link from 'next/link';

const ofertaItems = [
  {
    title: 'Technika Sceniczna',
    description: 'Profesjonalne oświetlenie, nagłośnienie i sceny',
    href: '/oferta/technika-sceniczna',
    icon: Monitor,
    gradient: 'from-blue-500/20 to-blue-600/10'
  },
  {
    title: 'Konferencje',
    description: 'Kompleksowa obsługa techniczna konferencji',
    href: '/oferta/konferencje',
    icon: Presentation,
    gradient: 'from-green-500/20 to-green-600/10'
  },
  {
    title: 'Streaming',
    description: 'Transmisje live i produkcja wideo online',
    href: '/oferta/streaming',
    icon: Video,
    gradient: 'from-red-500/20 to-red-600/10'
  },
  {
    title: 'Kasyno',
    description: 'Profesjonalne stoły do gier kasynowych',
    href: '/oferta/kasyno',
    icon: Dices,
    gradient: 'from-orange-500/20 to-orange-600/10'
  },
  {
    title: 'Quizy & Teleturnieje',
    description: 'Interaktywne quizy i gry dla gości',
    href: '/oferta/quizy-teleturnieje',
    icon: Sparkles,
    gradient: 'from-yellow-500/20 to-yellow-600/10'
  },
  {
    title: 'Symulatory VR',
    description: 'Wirtualna rzeczywistość i symulatory na eventy',
    href: '/oferta/symulatory-vr',
    icon: Gamepad2,
    gradient: 'from-purple-500/20 to-purple-600/10'
  },
  {
    title: 'Integracje',
    description: 'Eventy integracyjne i team building',
    href: '/oferta/integracje',
    icon: Users,
    gradient: 'from-pink-500/20 to-pink-600/10'
  },
  {
    title: 'Wieczory Tematyczne',
    description: 'Organizacja eventów tematycznych',
    href: '/oferta/wieczory-tematyczne',
    icon: Lamp,
    gradient: 'from-cyan-500/20 to-cyan-600/10'
  }
];

export default function OfertaSection() {
  return (
    <section id="oferta" className="relative py-24 md:py-32 bg-gradient-to-b from-[#1c1f33] to-[#0f1119] overflow-hidden">
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-[#800020] rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block">
            Nasza Oferta
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6">
            Specjalizacje i Rozwiązania
          </h2>
          <p className="text-[#e5e4e2]/70 text-lg font-light max-w-2xl mx-auto">
            Dedykowane strony z pełną informacją o naszych kluczowych usługach
          </p>
          <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto mt-6"></div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {ofertaItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link href={item.href} key={item.href}>
                <article className="group relative bg-[#1c1f33]/50 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#d3bb73]/5 h-full">
                  <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl`}></div>

                  <div className="relative z-10">
                    <div className="w-12 h-12 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-[#d3bb73]/20 transition-all duration-300">
                      <Icon className="w-6 h-6 text-[#d3bb73]" />
                    </div>

                    <h3 className="text-[#e5e4e2] text-lg font-light mb-2 group-hover:text-[#d3bb73] transition-colors">
                      {item.title}
                    </h3>

                    <p className="text-[#e5e4e2]/60 text-sm font-light leading-relaxed mb-4">
                      {item.description}
                    </p>

                    <div className="flex items-center gap-2 text-[#d3bb73] text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      Dowiedz się więcej
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </article>
              </Link>
            );
          })}
        </div>

        <div className="text-center">
          <Link
            href="/oferta"
            className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-all duration-200"
          >
            Zobacz pełną ofertę
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
