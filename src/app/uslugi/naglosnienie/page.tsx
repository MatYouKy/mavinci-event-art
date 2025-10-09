import { Metadata } from 'next';
import { Music, Volume2, Radio, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableImageSection } from '@/components/EditableImageSection';
import { EditableContent } from '@/components/EditableContent';
import { NaglosnieniaContent } from './NaglosnieniaContent';

export const metadata: Metadata = {
  title: 'Nagłośnienie Eventów | Mavinci',
  description: 'Profesjonalne systemy nagłośnieniowe na eventy, koncerty i imprezy. Sprzęt najwyższej klasy z obsługą techniczną.',
  keywords: 'nagłośnienie, systemy audio, sprzęt nagłaśniający, obsługa dźwięku, eventy',
};

export default function NaglosnieniaPage() {

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="naglosnienie-hero"
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
                <Music className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Profesjonalne Nagłośnienie</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Nagłośnienie <span className="text-[#d3bb73]">Eventów</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                Dostarczamy profesjonalne systemy nagłośnieniowe najwyższej klasy. Nasz sprzęt i doświadczony zespół techniczny gwarantują krystalicznie czysty dźwięk na każdym evencie.
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
                <Volume2 className="w-24 h-24 text-[#d3bb73] mb-6" />
                <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Sprzęt Najwyższej Klasy</h3>
                <p className="text-[#e5e4e2]/70 font-light">
                  Wykorzystujemy systemy audio renomowanych marek, zapewniając doskonałą jakość dźwięku dla każdego typu wydarzenia.
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageHeroImage>

      <NaglosnieniaContent />

      {/* Editable Content Section - Why Us */}
      <section className="py-24 bg-[#0f1119]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <EditableContent
            section="naglosnienie-intro"
            tableName="naglosnienie_content"
            defaultTitle="Dlaczego my?"
            defaultContent="Posiadamy wieloletnie doświadczenie w zapewnianiu profesjonalnego nagłośnienia dla największych wydarzeń w Polsce. Nasz zespół techników audio gwarantuje najwyższą jakość dźwięku i bezawaryjną obsługę."
            className="text-center max-w-4xl mx-auto"
            titleClassName="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6"
            contentClassName="text-[#e5e4e2]/70 text-lg font-light leading-relaxed"
          />
        </div>
      </section>

      {/* Gallery Section with Visual Effects */}
      <section className="py-24 bg-[#1c1f33] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4 animate-fade-in">
              Nasza Technologia
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className="group relative h-96 rounded-2xl overflow-hidden border border-[#d3bb73]/20 hover:border-[#d3bb73]/60 transition-all duration-500 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/20"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 via-transparent to-[#800020]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/50 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-500"></div>

                <EditableImageSection
                  section={`naglosnienie-gallery-${index}`}
                  tableName="naglosnienie_gallery_images"
                  defaultImage={`https://images.pexels.com/photos/${index === 1 ? '164936' : index === 2 ? '1763075' : '1679618'}/pexels-photo-${index === 1 ? '164936' : index === 2 ? '1763075' : '1679618'}.jpeg?auto=compress&cs=tinysrgb&w=1920`}
                  alt={`Audio equipment ${index}`}
                  className="absolute inset-0 transition-transform duration-700 group-hover:scale-110"
                  imageClassName="w-full h-full object-cover"
                />

                <div className="absolute bottom-0 left-0 right-0 p-6 transform translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 z-20">
                  <div className="h-1 w-16 bg-[#d3bb73] mb-4"></div>
                  <h3 className="text-xl font-light text-[#e5e4e2] mb-2">Profesjonalny Sprzęt</h3>
                  <p className="text-[#e5e4e2]/70 text-sm">Najwyższa jakość audio</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Editable Content Section - Technology */}
      <section className="py-24 bg-[#0f1119]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <EditableContent
            section="naglosnienie-tech"
            tableName="naglosnienie_content"
            defaultTitle="Technologia"
            defaultContent="Wykorzystujemy najnowsze systemy audio line array od renomowanych producentów takich jak L-Acoustics, d&b audiotechnik i Meyer Sound. Każdy event poprzedzamy dokładnymi pomiarami akustycznymi i konfiguracją systemu."
            className="text-center max-w-4xl mx-auto"
            titleClassName="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6"
            contentClassName="text-[#e5e4e2]/70 text-lg font-light leading-relaxed"
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Radio className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
            Potrzebujesz Profesjonalnego Nagłośnienia?
          </h2>
          <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
            Skontaktuj się z nami, aby omówić szczegóły Twojego eventu. Dobierzemy optymalne rozwiązanie audio dla Twojego wydarzenia.
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
