'use client';


import { Presentation, Users, Mic, Globe, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableContent } from '@/components/EditableContent';


export default function KonferencjePage() {
  const features = [
    'Pełna obsługa techniczna',
    'Systemy tłumaczeń symultanicznych',
    'Rejestracja uczestników',
    'Profesjonalna scenografia',
    'Catering i coffee breaks',
    'Materiały konferencyjne',
    'Obsługa gości VIP',
    'Transmisje online',
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="konferencje-hero"
          defaultImage="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920"
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
                  <Presentation className="w-5 h-5 text-[#d3bb73]" />
                  <EditableContent
                    section="konferencje-hero-badge"
                    tableName="konferencje_content"
                    defaultTitle="Eventy Biznesowe"
                    defaultContent=""
                    className="inline"
                    titleClassName="text-[#d3bb73] text-sm font-medium"
                    contentClassName="hidden"
                  />
                </div>

                <EditableContent
                  section="konferencje-hero-title"
                  tableName="konferencje_content"
                  defaultTitle="Organizacja Konferencji"
                  defaultContent=""
                  className="mb-6"
                  titleClassName="text-4xl md:text-6xl font-light text-[#e5e4e2]"
                  contentClassName="hidden"
                />

                <EditableContent
                  section="konferencje-hero-description"
                  tableName="konferencje_content"
                  defaultTitle=""
                  defaultContent="Kompleksowa organizacja konferencji biznesowych, szkoleń i eventów korporacyjnych. Od koncepcji przez realizację po obsługę poeventową."
                  className="mb-8"
                  titleClassName="hidden"
                  contentClassName="text-[#e5e4e2]/70 text-lg font-light leading-relaxed"
                />

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
                  <Globe className="w-24 h-24 text-[#d3bb73] mb-6" />
                  <EditableContent
                    section="konferencje-hero-card"
                    tableName="konferencje_content"
                    defaultTitle="Profesjonalna Organizacja"
                    defaultContent="Zapewniamy kompleksową obsługę konferencji - od logistyki przez technikę po catering i obsługę uczestników."
                    className=""
                    titleClassName="text-2xl font-light text-[#e5e4e2] mb-4"
                    contentClassName="text-[#e5e4e2]/70 font-light"
                  />
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
            <Presentation className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Zorganizujmy Twoją Konferencję!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby omówić szczegóły Twojej konferencji. Zapewnimy profesjonalną organizację i obsługę.
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
