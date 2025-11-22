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

export default function CityConferencePage() {
  const params = useParams();
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const [city, setCity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState<any[]>([]);
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

      const { data: problemsData, error: problemsError } = await supabase
        .from('conferences_problems')
        .select('*')
        .eq('is_active', true)
        .order('display_order')
        .single();

      if (problemsData) {
        setProblems(problemsData);
      }

      if (!data || error) {
        notFound();
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
        <Navbar />
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie...</div>
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
          className="fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#1c1f33] shadow-lg transition-all hover:bg-[#d3bb73]/90 hover:scale-105"
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
        { name: `Konferencje ${cityName}`, url: canonicalUrl }
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

      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-6 py-20">
        <div className="max-w-4xl w-full">
          {/* Location Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-3">
              <MapPin className="w-5 h-5 text-[#d3bb73]" />
              <div className="text-center">
                <div className="text-[#d3bb73] font-medium">{cityName}</div>
                <div className="text-[#e5e4e2]/60 text-xs">{city.region}</div>
              </div>
            </div>
          </div>   
          <ProblemAndSolution problems={problems} />


          {/* Main Content */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6 leading-tight">
              Obsługa Konferencji<br />
              <span className="text-[#d3bb73]">{cityName}</span>
            </h1>

            <p className="text-xl text-[#e5e4e2]/70 max-w-2xl mx-auto mb-8 leading-relaxed">
              Profesjonalna obsługa techniczna konferencji w {cityName}.
              Nagłośnienie, multimedia, streaming live i realizacja wideo.
            </p>

            <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto mb-12">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
                <div className="text-[#d3bb73] text-3xl font-light mb-2">50-5000+</div>
                <div className="text-[#e5e4e2]/60 text-sm">uczestników</div>
              </div>
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
                <div className="text-[#d3bb73] text-3xl font-light mb-2">15+</div>
                <div className="text-[#e5e4e2]/60 text-sm">lat doświadczenia</div>
              </div>
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
                <div className="text-[#d3bb73] text-3xl font-light mb-2">1000+</div>
                <div className="text-[#e5e4e2]/60 text-sm">zrealizowanych eventów</div>
              </div>
            </div>
          </div>

          {/* Services Grid */}
          <div className="grid md:grid-cols-2 gap-4 mb-12">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
              <h3 className="text-lg font-medium text-[#d3bb73] mb-3">
                Nagłośnienie i Audio
              </h3>
              <ul className="space-y-2 text-[#e5e4e2]/70 text-sm">
                <li>• Systemy line-array premium</li>
                <li>• Mikrofony wieloczęstotliwościowe</li>
                <li>• Monitory sceniczne</li>
                <li>• Realizacja dźwięku 5.1</li>
              </ul>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
              <h3 className="text-lg font-medium text-[#d3bb73] mb-3">
                Multimedia i Wizualizacje
              </h3>
              <ul className="space-y-2 text-[#e5e4e2]/70 text-sm">
                <li>• Ekrany LED indoor/outdoor</li>
                <li>• Projekcje HD/4K</li>
                <li>• Kamery wielokamerowe</li>
                <li>• Streaming FullHD/4K</li>
              </ul>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
              <h3 className="text-lg font-medium text-[#d3bb73] mb-3">
                Oświetlenie
              </h3>
              <ul className="space-y-2 text-[#e5e4e2]/70 text-sm">
                <li>• Oświetlenie konferencyjne</li>
                <li>• Oświetlenie sceniczne LED</li>
                <li>• Sterowanie DMX</li>
                <li>• Efekty specjalne</li>
              </ul>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
              <h3 className="text-lg font-medium text-[#d3bb73] mb-3">
                Scena i Konstrukcje
              </h3>
              <ul className="space-y-2 text-[#e5e4e2]/70 text-sm">
                <li>• Sceny modułowe</li>
                <li>• Konstrukcje kratowe</li>
                <li>• Blackbox i kurtyny</li>
                <li>• Bramy wejściowe</li>
              </ul>
            </div>
          </div>

          {/* CTA Section */}
          <div className="bg-gradient-to-br from-[#d3bb73]/10 via-[#d3bb73]/5 to-transparent border border-[#d3bb73]/30 rounded-2xl p-12 text-center relative overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#d3bb73]/5 rounded-full blur-3xl -z-10" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-[#d3bb73]/5 rounded-full blur-3xl -z-10" />

            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
              Gotowy na profesjonalną obsługę?
            </h2>
            <p className="text-lg text-[#e5e4e2]/70 max-w-2xl mx-auto mb-8">
              Zobacz pełną ofertę obsługi konferencji, pakiety usług i nasze realizacje
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => router.push('/oferta/konferencje')}
                className="group inline-flex items-center gap-3 px-8 py-4 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-all font-medium text-lg shadow-lg hover:shadow-xl hover:scale-105"
              >
                Zobacz pełną ofertę
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>

              <button
                onClick={() => {
                  const contactSection = document.getElementById('contact');
                  if (contactSection) {
                    contactSection.scrollIntoView({ behavior: 'smooth' });
                  } else {
                    router.push('/oferta/konferencje#contact');
                  }
                }}
                className="inline-flex items-center gap-2 px-8 py-4 bg-transparent border-2 border-[#d3bb73] text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/10 transition-all font-medium text-lg"
              >
                Skontaktuj się
              </button>
            </div>

            {/* Trust indicators */}
            <div className="mt-12 pt-8 border-t border-[#d3bb73]/20">
              <div className="flex flex-wrap items-center justify-center gap-8 text-[#e5e4e2]/60 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#d3bb73] rounded-full" />
                  Bezpłatna wycena
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#d3bb73] rounded-full" />
                  Profesjonalny sprzęt
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#d3bb73] rounded-full" />
                  Doświadczony zespół
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#d3bb73] rounded-full" />
                  Realizacje w całej Polsce
                </div>
              </div>
            </div>
          </div>

          {/* SEO Content (hidden, for crawlers) */}
          <div className="mt-12 text-[#e5e4e2]/40 text-xs text-center space-y-1">
            <p>
              Obsługa konferencji {cityName} | Nagłośnienie konferencyjne {cityName} |
              Technika AV {cityName} | Streaming konferencji {cityName}
            </p>
            <p>
              Realizacja live {cityName} | Multimedia konferencje {cityName} |
              Wynajem sprzętu eventowego {cityName}
            </p>
            <p>
              Profesjonalna obsługa eventów {cityName} | Konferencje biznesowe {cityName} |
              Eventy firmowe {cityName}
            </p>
          </div>
        </div>
      </div>

    </SchemaLayout>
    </>
  );
}
