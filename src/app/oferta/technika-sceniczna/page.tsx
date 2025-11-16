import { Metadata } from 'next';
import { Lightbulb, Zap, Speaker, Settings, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';

export const metadata: Metadata = {
  title: 'Technika Sceniczna | Mavinci',
  description: 'Profesjonalna technika sceniczna - oświetlenie, sprzęt audio, ekrany LED i pełna obsługa techniczna eventów.',
  keywords: 'technika sceniczna, oświetlenie, ekrany LED, sprzęt sceniczny, obsługa techniczna',
};

export default function TechnikaScenicznaPage() {
  const features = [
    'Oświetlenie LED i moving head',
    'Wielkoformatowe ekrany LED',
    'Miksery świateł i kontrolery DMX',
    'Systemy audio i nagłośnienie',
    'Efekty specjalne - dym, co2, confetti',
    'Konstrukcje sceniczne i podesty',
    'Profesjonalna obsługa techniczna',
    'Kompleksowa instalacja i transport',
  ];

  const equipment = [
    {
      title: 'Oświetlenie',
      desc: 'Moving head, LED PAR, stroboskopy i lasery',
      icon: Lightbulb,
    },
    {
      title: 'Ekrany LED',
      desc: 'Ekrany modułowe w różnych rozmiarach',
      icon: Settings,
    },
    {
      title: 'Audio',
      desc: 'Systemy nagłośnieniowe najwyższej klasy',
      icon: Speaker,
    },
    {
      title: 'Efekty',
      desc: 'Maszyny do dymu, confetti, fajerwerki sceniczne',
      icon: Zap,
    },
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="technika-sceniczna-hero"
          defaultImage="https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link
              href="/#uslugi"
              className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Powrót do usług
            </Link>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                  <Lightbulb className="w-5 h-5 text-[#d3bb73]" />
                  <span className="text-[#d3bb73] text-sm font-medium">Profesjonalny Sprzęt</span>
                </div>

                <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                  Technika <span className="text-[#d3bb73]">Sceniczna</span>
                </h1>

                <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                  Dostarczamy kompletną technikę sceniczną - od oświetlenia po systemy audio. Nasz profesjonalny sprzęt i doświadczony zespół techniczny zapewnią sukces Twojego eventu.
                </p>

                <div className="flex flex-wrap gap-4">
                  <a
                    href="/#kontakt"
                    className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    Zapytaj o wycenę
                  </a>
                  <Link
                    href="/#uslugi"
                    className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
                  >
                    Zobacz inne usługi
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                  <Zap className="w-24 h-24 text-[#d3bb73] mb-6" />
                  <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Kompleksowa Obsługa</h3>
                  <p className="text-[#e5e4e2]/70 font-light">
                    Od projektu przez instalację po obsługę techniczną - zapewniamy pełne wsparcie na każdym etapie eventu.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Co Oferujemy
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300"
                >
                  <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                  <span className="text-[#e5e4e2]/90 font-light">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-[#1c1f33]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Sprzęt Techniczny
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {equipment.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div
                    key={index}
                    className="group relative bg-gradient-to-br from-[#0f1119]/80 to-[#0f1119]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 hover:border-[#d3bb73]/30 transition-all duration-300 hover:transform hover:-translate-y-2"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"></div>

                    <div className="relative z-10">
                      <Icon className="w-8 h-8 text-[#d3bb73] mb-4" />
                      <h3 className="text-xl font-light text-[#e5e4e2] mb-3">{item.title}</h3>
                      <p className="text-[#e5e4e2]/60 text-sm font-light">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Settings className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Potrzebujesz Profesjonalnej Techniki?
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby omówić wymagania techniczne Twojego eventu. Dobierzemy optymalny sprzęt i zapewnimy pełną obsługę.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              Skontaktuj się z nami
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
