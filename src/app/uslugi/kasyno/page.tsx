'use client';

import { Dices, Spade, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';

export default function KasynoPage() {
  const features = [
    'Profesjonalne stoły do gier',
    'Doświadczeni krupierzy',
    'Żetony i karty do gier',
    'Ruletka, blackjack, poker',
    'Dekoracje w stylu Las Vegas',
    'System punktacji i ranking',
    'Nagrody dla zwycięzców',
    'Pełna obsługa eventu',
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="kasyno"
          defaultImage="https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920"
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
                  <Dices className="h-5 w-5 text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#d3bb73]">Wieczory w Kasynie</span>
                </div>

                <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                  Kasyno <span className="text-[#d3bb73]">Eventowe</span>
                </h1>

                <p className="mb-8 text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                  Przenieś swoich gości do świata Las Vegas! Profesjonalne kasyno eventowe z
                  prawdziwymi stołami do gier, doświadczonymi krupierami i pełną oprawą wieczoru w
                  stylu Monte Carlo.
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
                  <Spade className="mb-6 h-24 w-24 text-[#d3bb73]" />
                  <h3 className="mb-4 text-2xl font-light text-[#e5e4e2]">Elegancja i Emocje</h3>
                  <p className="font-light text-[#e5e4e2]/70">
                    Klimat prawdziwego kasyna, profesjonalni krupierzy i niezapomniana atmosfera
                    gier hazardowych w bezpiecznym środowisku eventowym.
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

        <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <Dices className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Zorganizujmy Wieczór w Kasynie!
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Skontaktuj się z nami, aby przygotować niezapomniane kasyno eventowe. Zapewnimy
              profesjonalną obsługę i klimat prawdziwego Las Vegas.
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
