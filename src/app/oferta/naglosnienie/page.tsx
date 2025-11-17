import { Metadata } from 'next';
import { Music, Volume2, Radio, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableImageSection } from '@/components/EditableImageSection';
import { EditableContent } from '@/components/EditableContent';
import { NaglosnieniaContent } from './NaglosnieniaContent';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

export const metadata: Metadata = {
  title: 'Nagłośnienie Eventów | Mavinci',
  description:
    'Profesjonalne systemy nagłośnieniowe na eventy, koncerty i imprezy. Sprzęt najwyższej klasy z obsługą techniczną.',
  keywords:
    'nagłośnienie, systemy audio, sprzęt nagłaśniający, obsługa dźwięku, eventy',
};

export default function NaglosnieniaPage() {
  const canonicalUrl = 'https://mavinci.pl/uslugi/naglosnienie';

  // 🔹 JSON-LD: Service + BreadcrumbList
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: 'Nagłośnienie Eventów',
        description:
          'Profesjonalne systemy nagłośnieniowe na eventy, koncerty i imprezy. Sprzęt najwyższej klasy z obsługą techniczną.',
        provider: {
          '@type': 'Organization',
          name: 'MAVINCI Event & ART',
          url: 'https://mavinci.pl',
          logo: 'https://mavinci.pl/logo-mavinci-crm.png',
          address: {
            '@type': 'PostalAddress',
            addressLocality: 'Bydgoszcz',
            addressRegion: 'Kujawsko-Pomorskie',
            addressCountry: 'PL',
          },
          telephone: '+48-123-456-789',
          email: 'kontakt@mavinci.pl',
        },
        // możesz tu później podmienić na dynamiczne miasta, jeśli chcesz
        areaServed: [
          { '@type': 'City', name: 'Warszawa' },
          { '@type': 'City', name: 'Gdańsk' },
          { '@type': 'City', name: 'Bydgoszcz' },
          { '@type': 'City', name: 'Toruń' },
          { '@type': 'City', name: 'Olsztyn' },
          { '@type': 'City', name: 'Łódź' },
          { '@type': 'City', name: 'Białystok' },
          { '@type': 'City', name: 'Rzeszów' },
          { '@type': 'City', name: 'Poznań' },
          { '@type': 'City', name: 'Kraków' },
        ],
        serviceType: 'Nagłośnienie Eventów',
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'PLN',
          availability: 'https://schema.org/InStock',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Strona główna',
            item: 'https://mavinci.pl/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Usługi',
            item: 'https://mavinci.pl/#uslugi',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: 'Nagłośnienie Eventów',
            item: canonicalUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      {/* ✅ JSON-LD w klienckim komponencie (app router) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

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
                  <EditableContent
                    section="naglosnienie-hero-badge"
                    tableName="naglosnienie_content"
                    defaultTitle="Profesjonalne Nagłośnienie"
                    defaultContent=""
                    className="inline"
                    titleClassName="text-[#d3bb73] text-sm font-medium"
                    contentClassName="hidden"
                    titleTag="span"
                    ariaLabel="Kategoria usługi"
                  />
                </div>

                <EditableContent
                  section="naglosnienie-hero-title"
                  tableName="naglosnienie_content"
                  defaultTitle="Nagłośnienie Eventów"
                  defaultContent=""
                  className="mb-6"
                  titleClassName="text-4xl md:text-6xl font-light text-[#e5e4e2]"
                  contentClassName="hidden"
                  titleTag="h1"
                  ariaLabel="Główny tytuł strony"
                />

                <EditableContent
                  section="naglosnienie-hero-description"
                  tableName="naglosnienie_content"
                  defaultTitle=""
                  defaultContent="Dostarczamy profesjonalne systemy nagłośnieniowe najwyższej klasy. Nasz sprzęt i doświadczony zespół techniczny gwarantują krystalicznie czysty dźwięk na każdym evencie."
                  className="mb-8"
                  titleClassName="hidden"
                  contentClassName="text-[#e5e4e2]/70 text-lg font-light leading-relaxed"
                  contentTag="p"
                  ariaLabel="Główny opis usługi"
                />

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
                  <EditableContent
                    section="naglosnienie-hero-card"
                    tableName="naglosnienie_content"
                    defaultTitle="Sprzęt Najwyższej Klasy"
                    defaultContent="Wykorzystujemy systemy audio renomowanych marek, zapewniając doskonałą jakość dźwięku dla każdego typu wydarzenia."
                    className=""
                    titleClassName="text-2xl font-light text-[#e5e4e2] mb-4"
                    contentClassName="text-[#e5e4e2]/70 font-light"
                    titleTag="h2"
                    contentTag="p"
                    ariaLabel="Informacja o sprzęcie"
                  />
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        {/* 🔗 Breadcrumbs pod hero */}
        <section className="pt-6 px-6 border-t border-b border-[#d3bb73]/20 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto">
            <CategoryBreadcrumb />
          </div>
        </section>

        {/* Editable Content Section - Why Us */}
        <section className="py-24 bg-[#0f1119] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-96 h-96 bg-[#d3bb73]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#800020]/5 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
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

        <NaglosnieniaContent />

        {/* Image Divider 1 - Parallax Effect */}
        <section className="relative h-96 overflow-hidden">
          <div className="absolute inset-0">
            <EditableImageSection
              section="naglosnienie-divider-1"
              tableName="naglosnienie_gallery_images"
              defaultImage="https://images.pexels.com/photos/976866/pexels-photo-976866.jpeg?auto=compress&cs=tinysrgb&w=1920"
              alt="Concert stage"
              className="w-full h-full"
              imageClassName="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0f1119] via-transparent to-[#0f1119]"></div>
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center px-4">
              <div className="inline-block bg-[#d3bb73]/10 backdrop-blur-md border border-[#d3bb73]/30 rounded-2xl px-12 py-8">
                <h3 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-2">
                  1000+
                </h3>
                <p className="text-[#d3bb73] text-sm uppercase tracking-wider">
                  Zrealizowanych Eventów
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Gallery Section - Split Layout */}
        <section className="py-24 bg-[#1c1f33] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4 animate-fade-in">
                Nasza Technologia
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            {/* Large Feature Image */}
            <div className="mb-8">
              <div className="group relative h-[500px] rounded-3xl overflow-hidden border border-[#d3bb73]/30 hover:border-[#d3bb73] transition-all duration-700 hover:shadow-2xl hover:shadow-[#d3bb73]/30">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/30 via-transparent to-[#800020]/30 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/40 to-transparent"></div>

                <EditableImageSection
                  section="naglosnienie-gallery-1"
                  tableName="naglosnienie_gallery_images"
                  defaultImage="https://images.pexels.com/photos/164936/pexels-photo-164936.jpeg?auto=compress&cs=tinysrgb&w=1920"
                  alt="Professional audio system"
                  className="absolute inset-0 transition-transform duration-1000 group-hover:scale-110"
                  imageClassName="w-full h-full object-cover"
                />

                <div className="absolute inset-0 flex items-end p-12 z-20">
                  <div className="max-w-2xl transform transition-all duration-700 group-hover:translate-x-4">
                    <div className="h-1 w-20 bg-[#d3bb73] mb-6 transition-all duration-700 group-hover:w-32"></div>
                    <h3 className="text-4xl font-light text-[#e5e4e2] mb-4">
                      Systemy Line Array
                    </h3>
                    <p className="text-[#e5e4e2]/80 text-lg">
                      Najwyższa jakość nagłośnienia dla eventów każdej skali
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Two Column Images */}
            <div className="grid md:grid-cols-2 gap-8">
              {[2, 3].map((index) => (
                <div
                  key={index}
                  className="group relative h-96 rounded-2xl overflow-hidden border border-[#d3bb73]/20 hover:border-[#d3bb73]/60 transition-all duration-500 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/20"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 via-transparent to-[#800020]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/50 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-500"></div>

                  <EditableImageSection
                    section={`naglosnienie-gallery-${index}`}
                    tableName="naglosnienie_gallery_images"
                    defaultImage={`https://images.pexels.com/photos/${
                      index === 2 ? '1763075' : '1679618'
                    }/pexels-photo-${
                      index === 2 ? '1763075' : '1679618'
                    }.jpeg?auto=compress&cs=tinysrgb&w=1920`}
                    alt={`Audio equipment ${index}`}
                    className="absolute inset-0 transition-transform duration-700 group-hover:scale-110"
                    imageClassName="w-full h-full object-cover"
                  />

                  <div className="absolute bottom-0 left-0 right-0 p-6 transform translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 z-20">
                    <div className="h-1 w-16 bg-[#d3bb73] mb-4"></div>
                    <h3 className="text-xl font-light text-[#e5e4e2] mb-2">
                      {index === 2 ? 'Miksery Cyfrowe' : 'Mikrofony'}
                    </h3>
                    <p className="text-[#e5e4e2]/70 text-sm">
                      Profesjonalny sprzęt audio
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Image Divider 2 - Full Width */}
        <section className="relative h-[600px] overflow-hidden">
          <div className="absolute inset-0">
            <EditableImageSection
              section="naglosnienie-divider-2"
              tableName="naglosnienie_gallery_images"
              defaultImage="https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=1920"
              alt="Live concert"
              className="w-full h-full"
              imageClassName="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33] via-[#0f1119]/80 to-[#0f1119]"></div>
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center px-4">
              <div className="space-y-6">
                <div className="inline-block bg-[#d3bb73]/10 backdrop-blur-md border border-[#d3bb73]/30 rounded-2xl px-16 py-10 mb-4">
                  <Music className="w-16 h-16 text-[#d3bb73] mx-auto mb-4" />
                  <h3 className="text-5xl md:text-6xl font-light text-[#e5e4e2] mb-3">
                    Perfekcyjny Dźwięk
                  </h3>
                  <p className="text-[#d3bb73] text-lg">Na każdym wydarzeniu</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Editable Content Section - Technology with Images */}
        <section className="py-24 bg-[#0f1119] relative overflow-hidden">
          <div className="absolute top-20 right-0 w-[600px] h-[600px] bg-[#d3bb73]/5 rounded-full blur-3xl"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="relative h-[500px] rounded-2xl overflow-hidden group">
                <EditableImageSection
                  section="naglosnienie-tech-image"
                  tableName="naglosnienie_gallery_images"
                  defaultImage="https://images.pexels.com/photos/210764/pexels-photo-210764.jpeg?auto=compress&cs=tinysrgb&w=1920"
                  alt="Audio technology"
                  className="w-full h-full transition-transform duration-700 group-hover:scale-110"
                  imageClassName="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="absolute inset-0 border-4 border-[#d3bb73]/20 group-hover:border-[#d3bb73]/40 transition-colors duration-500 rounded-2xl"></div>
              </div>

              <div>
                <EditableContent
                  section="naglosnienie-tech"
                  tableName="naglosnienie_content"
                  defaultTitle="Technologia"
                  defaultContent="Wykorzystujemy najnowsze systemy audio line array od renomowanych producentów takich jak L-Acoustics, d&b audiotechnik i Meyer Sound. Każdy event poprzedzamy dokładnymi pomiarami akustycznymi i konfiguracją systemu."
                  className=""
                  titleClassName="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6"
                  contentClassName="text-[#e5e4e2]/70 text-lg font-light leading-relaxed"
                />
                <div className="mt-8 grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-[#1c1f33]/50 rounded-xl border border-[#d3bb73]/10">
                    <Volume2 className="w-8 h-8 text-[#d3bb73] mx-auto mb-2" />
                    <p className="text-[#e5e4e2]/80 text-sm">Line Array</p>
                  </div>
                  <div className="text-center p-4 bg-[#1c1f33]/50 rounded-xl border border-[#d3bb73]/10">
                    <Radio className="w-8 h-8 text-[#d3bb73] mx-auto mb-2" />
                    <p className="text-[#e5e4e2]/80 text-sm">Wireless</p>
                  </div>
                  <div className="text-center p-4 bg-[#1c1f33]/50 rounded-xl border border-[#d3bb73]/10">
                    <Music className="w-8 h-8 text-[#d3bb73] mx-auto mb-2" />
                    <p className="text-[#e5e4e2]/80 text-sm">Digital Mix</p>
                  </div>
                </div>
              </div>
            </div>
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
              Skontaktuj się z nami, aby omówić szczegóły Twojego eventu. Dobierzemy
              optymalne rozwiązanie audio dla Twojego wydarzenia.
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