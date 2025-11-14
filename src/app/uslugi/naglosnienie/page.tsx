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
  description:
    'Profesjonalne systemy nagłośnieniowe na eventy, koncerty i imprezy. Sprzęt najwyższej klasy z obsługą techniczną.',
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
                  <Music className="h-5 w-5 text-[#d3bb73]" />
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
                  <Volume2 className="mb-6 h-24 w-24 text-[#d3bb73]" />
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

        {/* Editable Content Section - Why Us */}
        <section className="relative overflow-hidden bg-[#0f1119] py-24">
          <div className="absolute left-0 top-0 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d3bb73]/5 blur-3xl"></div>
          <div className="absolute bottom-0 right-0 h-96 w-96 translate-x-1/2 translate-y-1/2 rounded-full bg-[#800020]/5 blur-3xl"></div>
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <EditableContent
              section="naglosnienie-intro"
              tableName="naglosnienie_content"
              defaultTitle="Dlaczego my?"
              defaultContent="Posiadamy wieloletnie doświadczenie w zapewnianiu profesjonalnego nagłośnienia dla największych wydarzeń w Polsce. Nasz zespół techników audio gwarantuje najwyższą jakość dźwięku i bezawaryjną obsługę."
              className="mx-auto max-w-4xl text-center"
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
              className="h-full w-full"
              imageClassName="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0f1119] via-transparent to-[#0f1119]"></div>
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="px-4 text-center">
              <div className="inline-block rounded-2xl border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-12 py-8 backdrop-blur-md">
                <h3 className="mb-2 text-4xl font-light text-[#e5e4e2] md:text-5xl">1000+</h3>
                <p className="text-sm uppercase tracking-wider text-[#d3bb73]">
                  Zrealizowanych Eventów
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Gallery Section - Split Layout */}
        <section className="relative overflow-hidden bg-[#1c1f33] py-24">
          <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5"></div>

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="animate-fade-in mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Nasza Technologia
              </h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            {/* Large Feature Image */}
            <div className="mb-8">
              <div className="group relative h-[500px] overflow-hidden rounded-3xl border border-[#d3bb73]/30 transition-all duration-700 hover:border-[#d3bb73] hover:shadow-2xl hover:shadow-[#d3bb73]/30">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/30 via-transparent to-[#800020]/30 opacity-0 transition-opacity duration-700 group-hover:opacity-100"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/40 to-transparent"></div>

                <EditableImageSection
                  section="naglosnienie-gallery-1"
                  tableName="naglosnienie_gallery_images"
                  defaultImage="https://images.pexels.com/photos/164936/pexels-photo-164936.jpeg?auto=compress&cs=tinysrgb&w=1920"
                  alt="Professional audio system"
                  className="absolute inset-0 transition-transform duration-1000 group-hover:scale-110"
                  imageClassName="w-full h-full object-cover"
                />

                <div className="absolute inset-0 z-20 flex items-end p-12">
                  <div className="max-w-2xl transform transition-all duration-700 group-hover:translate-x-4">
                    <div className="mb-6 h-1 w-20 bg-[#d3bb73] transition-all duration-700 group-hover:w-32"></div>
                    <h3 className="mb-4 text-4xl font-light text-[#e5e4e2]">Systemy Line Array</h3>
                    <p className="text-lg text-[#e5e4e2]/80">
                      Najwyższa jakość nagłośnienia dla eventów każdej skali
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Two Column Images */}
            <div className="grid gap-8 md:grid-cols-2">
              {[2, 3].map((index) => (
                <div
                  key={index}
                  className="group relative h-96 overflow-hidden rounded-2xl border border-[#d3bb73]/20 transition-all duration-500 hover:scale-105 hover:border-[#d3bb73]/60 hover:shadow-2xl hover:shadow-[#d3bb73]/20"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 via-transparent to-[#800020]/20 opacity-0 transition-opacity duration-500 group-hover:opacity-100"></div>
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/50 to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-80"></div>

                  <EditableImageSection
                    section={`naglosnienie-gallery-${index}`}
                    tableName="naglosnienie_gallery_images"
                    defaultImage={`https://images.pexels.com/photos/${index === 2 ? '1763075' : '1679618'}/pexels-photo-${index === 2 ? '1763075' : '1679618'}.jpeg?auto=compress&cs=tinysrgb&w=1920`}
                    alt={`Audio equipment ${index}`}
                    className="absolute inset-0 transition-transform duration-700 group-hover:scale-110"
                    imageClassName="w-full h-full object-cover"
                  />

                  <div className="absolute bottom-0 left-0 right-0 z-20 translate-y-4 transform p-6 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                    <div className="mb-4 h-1 w-16 bg-[#d3bb73]"></div>
                    <h3 className="mb-2 text-xl font-light text-[#e5e4e2]">
                      {index === 2 ? 'Miksery Cyfrowe' : 'Mikrofony'}
                    </h3>
                    <p className="text-sm text-[#e5e4e2]/70">Profesjonalny sprzęt audio</p>
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
              className="h-full w-full"
              imageClassName="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33] via-[#0f1119]/80 to-[#0f1119]"></div>
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="px-4 text-center">
              <div className="space-y-6">
                <div className="mb-4 inline-block rounded-2xl border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-16 py-10 backdrop-blur-md">
                  <Music className="mx-auto mb-4 h-16 w-16 text-[#d3bb73]" />
                  <h3 className="mb-3 text-5xl font-light text-[#e5e4e2] md:text-6xl">
                    Perfekcyjny Dźwięk
                  </h3>
                  <p className="text-lg text-[#d3bb73]">Na każdym wydarzeniu</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Editable Content Section - Technology with Images */}
        <section className="relative overflow-hidden bg-[#0f1119] py-24">
          <div className="absolute right-0 top-20 h-[600px] w-[600px] rounded-full bg-[#d3bb73]/5 blur-3xl"></div>
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="group relative h-[500px] overflow-hidden rounded-2xl">
                <EditableImageSection
                  section="naglosnienie-tech-image"
                  tableName="naglosnienie_gallery_images"
                  defaultImage="https://images.pexels.com/photos/210764/pexels-photo-210764.jpeg?auto=compress&cs=tinysrgb&w=1920"
                  alt="Audio technology"
                  className="h-full w-full transition-transform duration-700 group-hover:scale-110"
                  imageClassName="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 opacity-0 transition-opacity duration-500 group-hover:opacity-100"></div>
                <div className="absolute inset-0 rounded-2xl border-4 border-[#d3bb73]/20 transition-colors duration-500 group-hover:border-[#d3bb73]/40"></div>
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
                  <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-4 text-center">
                    <Volume2 className="mx-auto mb-2 h-8 w-8 text-[#d3bb73]" />
                    <p className="text-sm text-[#e5e4e2]/80">Line Array</p>
                  </div>
                  <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-4 text-center">
                    <Radio className="mx-auto mb-2 h-8 w-8 text-[#d3bb73]" />
                    <p className="text-sm text-[#e5e4e2]/80">Wireless</p>
                  </div>
                  <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-4 text-center">
                    <Music className="mx-auto mb-2 h-8 w-8 text-[#d3bb73]" />
                    <p className="text-sm text-[#e5e4e2]/80">Digital Mix</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <Radio className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Potrzebujesz Profesjonalnego Nagłośnienia?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Skontaktuj się z nami, aby omówić szczegóły Twojego eventu. Dobierzemy optymalne
              rozwiązanie audio dla Twojego wydarzenia.
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
