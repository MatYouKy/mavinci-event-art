'use client';

import Head from 'next/head';
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
  ArrowRight
} from 'lucide-react';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import PageLayout from '@/components/Layout/PageLayout';

const services = [
  {
    title: 'Nagłośnienie',
    description: 'Profesjonalne systemy audio i nagłośnienie eventów',
    href: '/oferta/naglosnienie',
    icon: Mic,
    color: 'from-blue-500/20 to-blue-600/20',
    borderColor: 'border-blue-500/30'
  },
  {
    title: 'Konferencje',
    description: 'Kompleksowa obsługa techniczna konferencji',
    href: '/oferta/konferencje',
    icon: Presentation,
    color: 'from-green-500/20 to-green-600/20',
    borderColor: 'border-green-500/30'
  },
  {
    title: 'Streaming',
    description: 'Transmisje live i produkcja wideo online',
    href: '/oferta/streaming',
    icon: Video,
    color: 'from-red-500/20 to-red-600/20',
    borderColor: 'border-red-500/30'
  },
  {
    title: 'Symulatory VR',
    description: 'Wirtualna rzeczywistość i symulatory na eventy',
    href: '/oferta/symulatory-vr',
    icon: Gamepad2,
    color: 'from-purple-500/20 to-purple-600/20',
    borderColor: 'border-purple-500/30'
  },
  {
    title: 'Quizy & Teleturnieje',
    description: 'Interaktywne quizy i gry dla gości',
    href: '/oferta/quizy-teleturnieje',
    icon: Sparkles,
    color: 'from-yellow-500/20 to-yellow-600/20',
    borderColor: 'border-yellow-500/30'
  },
  {
    title: 'Integracje',
    description: 'Eventy integracyjne i team building',
    href: '/oferta/integracje',
    icon: Users,
    color: 'from-pink-500/20 to-pink-600/20',
    borderColor: 'border-pink-500/30'
  },
  {
    title: 'Kasyno',
    description: 'Profesjonalne stoły do gier kasynowych',
    href: '/oferta/kasyno',
    icon: Sparkles,
    color: 'from-orange-500/20 to-orange-600/20',
    borderColor: 'border-orange-500/30'
  },
  {
    title: 'Wieczory Tematyczne',
    description: 'Organizacja eventów tematycznych',
    href: '/oferta/wieczory-tematyczne',
    icon: Lamp,
    color: 'from-cyan-500/20 to-cyan-600/20',
    borderColor: 'border-cyan-500/30'
  },
  {
    title: 'Technika Sceniczna',
    description: 'Oświetlenie, sceny i efekty specjalne',
    href: '/oferta/technika-sceniczna',
    icon: Monitor,
    color: 'from-indigo-500/20 to-indigo-600/20',
    borderColor: 'border-indigo-500/30'
  }
];

export default function UslugiPage() {
  return (
    <PageLayout pageSlug="oferta">      
       
      <main className="min-h-screen bg-gradient-to-b from-[#0f1119] to-[#1c1f33] pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* ✅ Breadcrumb pod nawigacją */}
          <div className="mb-6">
            <CategoryBreadcrumb />
          </div>

          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-light text-[#e5e4e2] mb-6">
              Nasze <span className="text-[#d3bb73] font-normal">Usługi</span>
            </h1>
            <p className="text-lg text-[#e5e4e2]/70 max-w-3xl mx-auto">
              Oferujemy kompleksową obsługę techniczną i organizację eventów.
              Wybierz usługę, która Cię interesuje i poznaj szczegóły.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {services.map((service, index) => {
              const Icon = service.icon;
              return (
                <Link
                  key={service.href}
                  href={service.href}
                  className="group relative bg-[#1c1f33]/50 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8 hover:border-[#d3bb73]/50 transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-[#d3bb73]/10"
                  style={{
                    animationDelay: `${index * 0.1}s`,
                    animation: 'fadeInUp 0.6s ease-out forwards',
                    opacity: 0
                  }}
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${service.color} opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity duration-500`}
                  />

                  <div className="relative z-10">
                    <div
                      className={`inline-flex p-4 rounded-xl bg-gradient-to-br ${service.color} border ${service.borderColor} mb-6 group-hover:scale-110 transition-transform duration-500`}
                    >
                      <Icon className="w-8 h-8 text-[#e5e4e2]" />
                    </div>

                    <h3 className="text-2xl font-light text-[#e5e4e2] mb-3 group-hover:text-[#d3bb73] transition-colors duration-300">
                      {service.title}
                    </h3>

                    <p className="text-[#e5e4e2]/70 text-sm mb-6 leading-relaxed">
                      {service.description}
                    </p>

                    <div className="flex items-center gap-2 text-[#d3bb73] text-sm font-medium">
                      <span>Zobacz szczegóły</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-2 transition-transform duration-300" />
                    </div>
                  </div>

                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#d3bb73]/5 rounded-full blur-3xl group-hover:bg-[#d3bb73]/10 transition-all duration-500" />
                </Link>
              );
            })}
          </div>

          <div className="mt-16 text-center">
            <Link
              href="/#kontakt"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/40"
            >
              Skontaktuj się z nami
              <ArrowRight className="w-5 h-5" />
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
      </main>
    </PageLayout>
  );
}