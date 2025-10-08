'use client';

import { Presentation, Users, Mic, Globe, CheckCircle2, ArrowLeft, Award, TrendingUp, Sparkles } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableImage } from '@/components/EditableImage';

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

  const stats = [
    { value: '200+', label: 'Zorganizowanych konferencji' },
    { value: '50+', label: 'Klientów korporacyjnych' },
    { value: '10000+', label: 'Zadowolonych uczestników' },
    { value: '100%', label: 'Profesjonalizmu' },
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

            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Presentation className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Eventy Biznesowe</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Organizacja <span className="text-[#d3bb73]">Konferencji</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed max-w-3xl mx-auto">
                Kompleksowa organizacja konferencji biznesowych, szkoleń i eventów korporacyjnych. Od koncepcji przez realizację po obsługę poeventową.
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-6 mt-12">
              {stats.map((stat, index) => (
                <div
                  key={index}
                  className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-6 text-center"
                >
                  <div className="text-4xl md:text-5xl font-light text-[#d3bb73] mb-2">
                    {stat.value}
                  </div>
                  <div className="text-[#e5e4e2]/70 text-sm font-light">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </PageHeroImage>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                  Nasze <span className="text-[#d3bb73]">Doświadczenie</span>
                </h2>
                <div className="h-1 w-24 bg-gradient-to-r from-[#d3bb73] to-transparent mb-8"></div>

                <div className="space-y-6 text-[#e5e4e2]/70 font-light leading-relaxed">
                  <p>
                    Od ponad 15 lat organizujemy konferencje biznesowe najwyższej klasy. Nasze doświadczenie obejmuje eventy dla 50 do 5000 uczestników.
                  </p>
                  <p>
                    Realizujemy konferencje międzynarodowe z tłumaczeniami symultanicznymi, szkolenia wewnętrzne, kongresy branżowe i spotkania korporacyjne.
                  </p>
                  <p>
                    Zapewniamy kompleksową obsługę - od wyboru lokalizacji, przez obsługę techniczną i catering, po materiały konferencyjne i transmisje online.
                  </p>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <EditableImage
                  section="konferencje-historia"
                  defaultImage="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Nasze doświadczenie w organizacji konferencji"
                  className="relative rounded-3xl overflow-hidden border border-[#d3bb73]/20 aspect-square"
                  imageClassName="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Co <span className="text-[#d3bb73]">Oferujemy</span>
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

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="relative order-2 lg:order-1">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <EditableImage
                  section="konferencje-dlaczego"
                  defaultImage="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200"
                  alt="Nasze projekty konferencyjne"
                  className="relative rounded-3xl overflow-hidden border border-[#d3bb73]/20 aspect-square"
                  imageClassName="w-full h-full object-cover"
                />
              </div>

              <div className="order-1 lg:order-2">
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                  Dlaczego <span className="text-[#d3bb73]">Warto</span>?
                </h2>
                <div className="h-1 w-24 bg-gradient-to-r from-[#d3bb73] to-transparent mb-8"></div>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center">
                      <Globe className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-2">
                        Kompleksowa obsługa
                      </h3>
                      <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                        Od wyboru lokalizacji po obsługę poeventową - zajmiemy się wszystkim, abyś mógł skupić się na treści.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-2">
                        Nowoczesne technologie
                      </h3>
                      <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                        Transmisje online, systemy rejestracji, aplikacje eventowe - wykorzystujemy najnowsze rozwiązania technologiczne.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#d3bb73]/20 border border-[#d3bb73]/30 flex items-center justify-center">
                      <Award className="w-5 h-5 text-[#d3bb73]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-light text-[#e5e4e2] mb-2">
                        Doświadczony zespół
                      </h3>
                      <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                        Ponad 200 zrealizowanych konferencji to gwarancja profesjonalizmu i płynnej realizacji.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Presentation className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Zorganizujmy Twoją Konferencję!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby omówić szczegóły Twojej konferencji. Zapewnimy profesjonalną organizację i obsługę.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                Skontaktuj się z nami
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </a>
              <Link
                href="/#uslugi"
                className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
              >
                Zobacz inne usługi
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
