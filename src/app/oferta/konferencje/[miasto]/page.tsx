'use client';

import { useEffect, useState } from 'react';
import { useParams, notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { MapPin, Phone, Mail, ArrowLeft } from 'lucide-react';

export default function CityConferencePage() {
  const params = useParams();
  const [city, setCity] = useState<any>(null);
  const [ogImage, setOgImage] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.miasto]);

  const loadData = async () => {
    try {
      const slug =
        typeof params.miasto === 'string'
          ? params.miasto
          : Array.isArray(params.miasto)
          ? params.miasto[0]
          : '';

      const [cityRes, ogImageRes] = await Promise.all([
        supabase
          .from('conferences_cities')
          .select('*')
          .eq('slug', slug)
          .eq('is_active', true)
          .maybeSingle(),
        supabase
          .from('site_images')
          .select('desktop_url')
          .eq('section', 'konferencje-hero')
          .eq('is_active', true)
          .maybeSingle(),
      ]);

      if (!cityRes.data) {
        notFound();
        return;
      }

      setCity(cityRes.data);
      setOgImage(
        ogImageRes.data?.desktop_url ||
          'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop'
      );
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

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.slug}`;

  // 🔹 Schema.org: Service + BreadcrumbList w jednym @graph
  const serviceSchema = {
    '@type': 'Service',
    name: `Obsługa Konferencji ${city.city_name}`,
    description: city.seo_description,
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
    areaServed: {
      '@type': 'City',
      name: city.city_name,
      containedIn: {
        '@type': 'State',
        name: `Województwo ${city.voivodeship}`,
      },
    },
    serviceType: 'Obsługa Techniczna Konferencji',
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      priceRange: '$$',
    },
  };

  const breadcrumbSchema = {
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
        name: 'Oferta',
        item: 'https://mavinci.pl/oferta',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Konferencje',
        item: 'https://mavinci.pl/oferta/konferencje',
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: `Obsługa Konferencji ${city.city_name}`,
        item: canonicalUrl,
      },
    ],
  };

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [serviceSchema, breadcrumbSchema],
  };

  return (
    <>
      <Head>
        <title>{city.seo_title}</title>
        <meta name="description" content={city.seo_description} />
        <meta
          name="keywords"
          content={`obsługa konferencji ${city.city_name}, nagłośnienie konferencyjne ${city.city_name}, technika av ${city.city_name}, streaming konferencji ${city.city_name}, realizacja live ${city.city_name}`}
        />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={city.seo_title} />
        <meta property="og:description" content={city.seo_description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content={`MAVINCI Obsługa Konferencji ${city.city_name}`}
        />
        <meta property="og:site_name" content="MAVINCI Event & ART" />
        <meta property="og:locale" content="pl_PL" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={city.seo_title} />
        <meta name="twitter:description" content={city.seo_description} />
        <meta name="twitter:image" content={ogImage} />
        <meta
          name="twitter:image:alt"
          content={`MAVINCI Obsługa Konferencji ${city.city_name}`}
        />

        {/* Canonical */}
        <link rel="canonical" href={canonicalUrl} />

        {/* ✅ JSON-LD: Service + BreadcrumbList */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </Head>

      <Navbar />
      <div className="min-h-screen bg-[#0f1119]">
        <section className="py-20 px-6 bg-gradient-to-b from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-4xl mx-auto">
            <Link
              href="/oferta/konferencje"
              className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Powrót do strony głównej
            </Link>

            <div className="mb-8">
              <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <MapPin className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">
                  {city.voivodeship}
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6">
                Obsługa Konferencji{' '}
                <span className="text-[#d3bb73]">{city.city_name}</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                {city.seo_description}
              </p>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-8 mb-8">
              <h2 className="text-2xl font-light text-[#e5e4e2] mb-6">
                Kompleksowa Obsługa Techniczna w {city.city_name}
              </h2>

              <div className="grid md:grid-cols-2 gap-6 mb-8">
                <div>
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

                <div>
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

                <div>
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

                <div>
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

              <div className="border-t border-[#d3bb73]/10 pt-6">
                <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">
                  Dlaczego MAVINCI w {city.city_name}?
                </h3>
                <ul className="space-y-3 text-[#e5e4e2]/70">
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-[#d3bb73] rounded-full mt-2 flex-shrink-0"></div>
                    <span>
                      Doświadczenie w obsłudze konferencji od 50 do 5000+ osób
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-[#d3bb73] rounded-full mt-2 flex-shrink-0"></div>
                    <span>
                      Własny sprzęt premium - CODA Audio, Shure, Blackmagic
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-[#d3bb73] rounded-full mt-2 flex-shrink-0"></div>
                    <span>
                      Zespół doświadczonych realizatorów i techników
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-[#d3bb73] rounded-full mt-2 flex-shrink-0"></div>
                    <span>
                      Kompleksowa obsługa - od projektu po demontaż
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-4 rounded-full text-lg font-medium hover:bg-[#d3bb73]/90 transition-all hover:scale-105 transform shadow-lg"
              >
                <Mail className="w-5 h-5" />
                Zapytaj o wycenę dla {city.city_name}
              </button>
              <p className="text-[#e5e4e2]/40 text-sm mt-4">
                Odpowiedź w 24h | Bezpłatna konsultacja techniczna
              </p>
            </div>
          </div>
        </section>

        {isContactFormOpen && (
          <ContactFormWithTracking
            isOpen={isContactFormOpen}
            onClose={() => setIsContactFormOpen(false)}
            sourcePage='konferencje'
          />
        )}
      </div>
      <Footer />
    </>
  );
}