import { Metadata } from 'next';
import { Lightbulb, Zap, Speaker, Settings, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';

export const metadata: Metadata = {
  title: 'Technika Sceniczna | Mavinci',
  description:
    'Profesjonalna technika sceniczna - oświetlenie, sprzęt audio, ekrany LED i pełna obsługa techniczna eventów.',
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
          className="overflow-hidden py-24 md:py-32"
        >
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Link
              href="/#uslugi"
              className="mb-8 inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
            >
              <ArrowLeft className="h-4 w-4" />
              Powrót do usług
            </Link>

            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                  <Lightbulb className="h-5 w-5 text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#d3bb73]">Profesjonalny Sprzęt</span>
                </div>

                <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                  Technika <span className="text-[#d3bb73]">Sceniczna</span>
                </h1>

                <p className="mb-8 text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                  Dostarczamy kompletną technikę sceniczną - od oświetlenia po systemy audio. Nasz
                  profesjonalny sprzęt i doświadczony zespół techniczny zapewnią sukces Twojego
                  eventu.
                </p>

                <div className="flex flex-wrap gap-4">
                  <a
                    href="/#kontakt"
                    className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Zapytaj o wycenę
                  </a>
                  <Link
                    href="/#uslugi"
                    className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                  >
                    Zobacz inne usługi
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 blur-3xl"></div>
                <div className="relative rounded-3xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
                  <Zap className="mb-6 h-24 w-24 text-[#d3bb73]" />
                  <h3 className="mb-4 text-2xl font-light text-[#e5e4e2]">Kompleksowa Obsługa</h3>
                  <p className="font-light text-[#e5e4e2]/70">
                    Od projektu przez instalację po obsługę techniczną - zapewniamy pełne wsparcie
                    na każdym etapie eventu.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        <section className="bg-[#0f1119] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">Co Oferujemy</h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-6 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                  <span className="font-light text-[#e5e4e2]/90">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#1c1f33] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Sprzęt Techniczny
              </h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {equipment.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div
                    key={index}
                    className="group relative rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#0f1119]/80 to-[#0f1119]/40 p-8 backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:transform hover:border-[#d3bb73]/30"
                  >
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>

                    <div className="relative z-10">
                      <Icon className="mb-4 h-8 w-8 text-[#d3bb73]" />
                      <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">{item.title}</h3>
                      <p className="text-sm font-light text-[#e5e4e2]/60">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <Settings className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Potrzebujesz Profesjonalnej Techniki?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Skontaktuj się z nami, aby omówić wymagania techniczne Twojego eventu. Dobierzemy
              optymalny sprzęt i zapewnimy pełną obsługę.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
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
