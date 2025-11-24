'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { MapPin, ArrowRight, Settings } from 'lucide-react';
import SchemaLayout from '@/components/SchemaLayout';
import { ProblemAndSolution } from '../sections/ProblemAndSolution';
import { useEditMode } from '@/contexts/EditModeContext';
import CityPageSEOModal from '@/components/CityPageSEOModal';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

export default function CityConferencePage() {
  const params = useParams();
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const [city, setCity] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [isSEOModalOpen, setIsSEOModalOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, [params.miasto]);

  const loadData = async () => {
    try {
      const slug =
        typeof params.miasto === 'string'
          ? params.miasto
          : Array.isArray(params.miasto)
            ? params.miasto[0]
            : '';

      const { data, error } = await supabase
        .from('schema_org_places')
        .select('*')
        .eq('locality', slug)
        .eq('is_global', true)
        .eq('is_active', true)
        .maybeSingle();

      if (!data || error) {
        notFound(); // if no data, not found
        return;
      }

      setCity(data);
    } catch (error) {
      console.error('Error loading city data:', error);
      notFound();
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
          <div className="text-lg text-[#d3bb73]">Ładowanie...</div>
        </div>
      </>
    );
  }

  if (!city) {
    notFound();
    return null;
  }

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.locality}`;
  const cityName = city.name;
  const defaultTitle = `Obsługa Konferencji ${cityName} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;
  const defaultDescription = `Profesjonalna obsługa konferencji w ${cityName}: nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych w ${cityName} i okolicach.`;

  return (
    <>
      {/* SEO Metadata Button */}
      {isEditMode && (
        <button
          onClick={() => setIsSEOModalOpen(true)}
          className="fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1c1f33] shadow-lg transition-all hover:scale-105 hover:bg-[#d3bb73]/90"
        >
          <Settings className="h-4 w-4" />
          Metadane SEO
        </button>
      )}

      {/* SEO Modal */}
      <CityPageSEOModal
        isOpen={isSEOModalOpen}
        onClose={() => setIsSEOModalOpen(false)}
        pageType="konferencje"
        citySlug={city.locality}
        cityName={cityName}
        defaultTitle={defaultTitle}
        defaultDescription={defaultDescription}
      />

      <SchemaLayout
        pageSlug={`konferencje-${city.locality}`}
        defaultTitle={defaultTitle}
        defaultDescription={defaultDescription}
        cityPageType="konferencje"
        citySlug={city.locality}
        breadcrumb={[
          { name: 'Start', url: 'https://mavinci.pl/' },
          { name: 'Oferta', url: 'https://mavinci.pl/oferta' },
          { name: 'Konferencje', url: 'https://mavinci.pl/oferta/konferencje' },
          { name: `Konferencje ${cityName}`, url: canonicalUrl },
        ]}
        customSchemaData={{
          '@type': 'Service',
          name: `Obsługa Konferencji ${cityName}`,
          description: `Kompleksowa obsługa techniczna konferencji w ${cityName}. Nagłośnienie, multimedia, streaming live, realizacja wideo.`,
          provider: {
            '@type': 'Organization',
            name: 'MAVINCI Event & ART',
            url: 'https://mavinci.pl',
            logo: 'https://mavinci.pl/logo-mavinci-crm.png',
          },
          areaServed: {
            '@type': 'Place',
            name: cityName,
            address: {
              '@type': 'PostalAddress',
              addressLocality: city.locality,
              postalCode: city.postal_code,
              addressRegion: city.region,
              addressCountry: 'PL',
            },
          },
          serviceType: 'Obsługa Techniczna Konferencji',
          offers: {
            '@type': 'Offer',
            availability: 'https://schema.org/InStock',
            priceRange: '$$-$$$',
          },
          keywords: `obsługa konferencji ${cityName}, nagłośnienie konferencyjne ${cityName}, technika av ${cityName}, streaming konferencji ${cityName}, realizacja live ${cityName}, multimedia konferencje ${cityName}, wynajem sprzętu eventowego ${cityName}, profesjonalna obsługa eventów ${cityName}, konferencje biznesowe ${cityName}, eventy firmowe ${cityName}`,
        }}
      >
        <div className="flex min-h-screen items-center justify-center bg-[#0f1119] px-6 py-20 pt-28">
          <div className="w-full max-w-4xl">
            {/* Main Content */}
            <div className="mb-12 text-center">
              <h1 className="mb-6 text-4xl font-light leading-tight text-[#e5e4e2] md:text-6xl">
                Obsługa Konferencji
                <br />
                <span className="text-[#d3bb73]">{cityName}</span>
              </h1>

              <p className="mx-auto mb-8 max-w-2xl text-sm leading-relaxed text-[#e5e4e2]/70 md:text-base">
                Profesjonalna obsługa techniczna konferencji w {cityName}. Nagłośnienie, multimedia,
                streaming live i realizacja wideo.
              </p>

              <div className="mx-auto mb-12 grid max-w-3xl gap-6 md:grid-cols-3">
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                  <div className="mb-2 text-3xl font-light text-[#d3bb73]">50-5000+</div>
                  <div className="text-sm text-[#e5e4e2]/60">uczestników</div>
                </div>
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                  <div className="mb-2 text-3xl font-light text-[#d3bb73]">15+</div>
                  <div className="text-sm text-[#e5e4e2]/60">lat doświadczenia</div>
                </div>
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                  <div className="mb-2 text-3xl font-light text-[#d3bb73]">3700+</div>
                  <div className="text-sm text-[#e5e4e2]/60">zrealizowanych eventów</div>
                </div>
              </div>
            </div>

            <section className="min-h-[50px] px-6 pt-6">
              <div className="mx-auto min-h-[50px] max-w-7xl">
                <CategoryBreadcrumb
                  pageSlug={`oferta/konferencje/${city.locality}`}
                  productName={`Obsługa Konferencji ${cityName}`}
                  hideMetadataButton={true}
                />
              </div>
            </section>

            {/* Services Grid */}
            <div className="mb-12 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Nagłośnienie i Audio</h3>
                <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
                  <li>• Systemy line-array premium</li>
                  <li>• Mikrofony wieloczęstotliwościowe</li>
                  <li>• Monitory sceniczne</li>
                  <li>• Realizacja dźwięku 5.1</li>
                </ul>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">
                  Multimedia i Wizualizacje
                </h3>
                <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
                  <li>• Ekrany LED indoor/outdoor</li>
                  <li>• Projekcje HD/4K</li>
                  <li>• Kamery wielokamerowe</li>
                  <li>• Streaming FullHD/4K</li>
                </ul>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Oświetlenie</h3>
                <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
                  <li>• Oświetlenie konferencyjne</li>
                  <li>• Oświetlenie sceniczne LED</li>
                  <li>• Sterowanie DMX</li>
                  <li>• Efekty specjalne</li>
                </ul>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Scena i Konstrukcje</h3>
                <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
                  <li>• Sceny modułowe</li>
                  <li>• Konstrukcje kratowe</li>
                  <li>• Blackbox i kurtyny</li>
                  <li>• Bramy wejściowe</li>
                </ul>
              </div>
            </div>

            {/* CTA Section */}
            <div className="relative overflow-hidden rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73]/10 via-[#d3bb73]/5 to-transparent p-2 text-center md:p-8 lg:p-12">
              {/* Decorative elements */}
              <div className="absolute right-0 top-0 -z-10 h-64 w-64 rounded-full bg-[#d3bb73]/5 blur-3xl" />
              <div className="absolute bottom-0 left-0 -z-10 h-48 w-48 rounded-full bg-[#d3bb73]/5 blur-3xl" />

              <h2 className="mb-4 p-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Gotowy na profesjonalną obsługę?
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">
                Zobacz pełną ofertę obsługi konferencji, pakiety usług i nasze realizacje
              </p>

              <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                {/* Button 1 */}
                <button
                  onClick={() => router.push('/oferta/konferencje')}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-base font-medium text-[#1c1f33] shadow-md transition-all hover:scale-105 hover:bg-[#d3bb73]/90 hover:shadow-xl sm:w-auto sm:gap-3 sm:px-8 sm:py-4 sm:text-lg sm:shadow-lg"
                >
                  Zobacz pełną ofertę
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 sm:h-5 sm:w-5" />
                </button>

                {/* Button 2 */}
                <button
                  onClick={() => {
                    const contactSection = document.getElementById('contact');
                    if (contactSection) {
                      contactSection.scrollIntoView({ behavior: 'smooth' });
                    } else {
                      router.push('/oferta/konferencje#contact');
                    }
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-[#d3bb73] bg-transparent px-6 py-3 text-base font-medium text-[#d3bb73] transition-all hover:bg-[#d3bb73]/10 sm:w-auto sm:px-8 sm:py-4 sm:text-lg"
                >
                  Skontaktuj się
                </button>
              </div>

              {/* Trust indicators */}
              <div className="mt-12 border-t border-[#d3bb73]/20 pb-4 pt-8">
                <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-[#e5e4e2]/60">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    Bezpłatna wycena
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    Profesjonalny sprzęt
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    Doświadczony zespół
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    Realizacje w całej Polsce
                  </div>
                </div>
              </div>
            </div>

            {/* SEO Content (hidden, for crawlers) */}
            <div className="mt-12 space-y-1 text-center text-xs text-[#e5e4e2]/40">
              <p>
                Obsługa konferencji {cityName} | Nagłośnienie konferencyjne {cityName} | Technika AV{' '}
                {cityName} | Streaming konferencji {cityName}
              </p>
              <p>
                Realizacja live {cityName} | Multimedia konferencje {cityName} | Wynajem sprzętu
                eventowego {cityName}
              </p>
              <p>
                Profesjonalna obsługa eventów {cityName} | Konferencje biznesowe {cityName} | Eventy
                firmowe {cityName}
              </p>
            </div>
          </div>
        </div>
      </SchemaLayout>
    </>
  );
}
