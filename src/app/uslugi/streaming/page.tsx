'use client';

import { Video, Wifi, Camera, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';

export default function StreamingPage() {
  const features = [
    'Transmisje Full HD i 4K',
    'Streaming na platformy: YouTube, Facebook, LinkedIn',
    'Wielokamerowe rejestracje',
    'Grafika i niższe trzecie na żywo',
    'Profesjonalna realizacja obrazu',
    'Backup i archiwizacja materiału',
    'Interaktywne Q&A podczas streamu',
    'Statystyki widzów i analityka',
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="streaming"
          defaultImage="https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link href="/#uslugi" className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8">
              <ArrowLeft className="w-4 h-4" />
              Powrót do usług
            </Link>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                  <Video className="w-5 h-5 text-[#d3bb73]" />
                  <span className="text-[#d3bb73] text-sm font-medium">Transmisje Online</span>
                </div>

                <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                  Streaming <span className="text-[#d3bb73]">Eventów</span>
                </h1>

                <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                  Realizujemy profesjonalne transmisje online Twoich wydarzeń. Dotrzyjmy razem do szerszej publiczności dzięki wysokiej jakości streamingowi na żywo.
                </p>

                <div className="flex flex-wrap gap-4">
                  <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
                    Zapytaj o wycenę
                  </a>
                  <Link href="/#uslugi" className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors">
                    Zobacz inne usługi
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                  <Wifi className="w-24 h-24 text-[#d3bb73] mb-6" />
                  <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Profesjonalna Realizacja</h3>
                  <p className="text-[#e5e4e2]/70 font-light">
                    Wielokamerowa realizacja, grafika na żywo, stabilna transmisja i pełna obsługa techniczna.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Co Oferujemy</h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300">
                  <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                  <span className="text-[#e5e4e2]/90 font-light">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Camera className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Potrzebujesz Profesjonalnego Streamingu?
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby omówić szczegóły transmisji. Zapewnimy profesjonalną realizację i stabilny streaming Twojego wydarzenia.
            </p>
            <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
              Skontaktuj się z nami
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
