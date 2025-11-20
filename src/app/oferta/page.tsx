'use client';

import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { ServiceCard } from '@/components/ServiceCard';
import { supabase } from '@/lib/supabase';

interface Service {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_name: string;
  color_from: string;
  color_to: string;
  border_color: string;
  hero_image_url: string | null;
  hero_opacity: number;
  order_index: number;
}

export default function UslugiPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServices();
  }, []);

  async function loadServices() {
    try {
      const { data, error } = await supabase
        .from('services_catalog')
        .select('*')
        .eq('is_active', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  }

  const canonicalUrl = 'https://mavinci.pl/oferta';

  const itemListJsonLd = {
    '@type': 'ItemList',
    name: 'Główne kategorie usług MAVINCI',
    description: 'Przegląd kluczowych usług eventowych MAVINCI',
    numberOfItems: services.length,
    itemListElement: services.map((service, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Service',
        name: service.title,
        description: service.description,
        url: `https://mavinci.pl/oferta/${service.slug}`,
        provider: {
          '@type': 'Organization',
          name: 'MAVINCI Event & ART'
        }
      }
    }))
  };

  const breadcrumbJsonLd = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Strona główna',
        item: 'https://mavinci.pl/'
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Oferta',
        item: canonicalUrl
      }
    ]
  };

  const combinedJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [itemListJsonLd, breadcrumbJsonLd]
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-gradient-to-b from-[#0f1119] to-[#1c1f33] pt-28 pb-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="animate-pulse text-[#d3bb73]">Ładowanie usług...</div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Usługi Eventowe – MAVINCI Event & ART</title>
        <meta
          name="description"
          content="Przegląd kluczowych usług MAVINCI: nagłośnienie, konferencje, streaming, symulatory VR, quizy i teleturnieje, integracje, kasyno, wieczory tematyczne oraz technika sceniczna."
        />
        <meta
          name="keywords"
          content="usługi eventowe, nagłośnienie, konferencje, streaming, symulatory VR, quizy, teleturnieje, integracje, kasyno eventowe, technika sceniczna, wieczory tematyczne"
        />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="Usługi Eventowe – MAVINCI Event & ART" />
        <meta
          property="og:description"
          content="Poznaj najważniejsze usługi eventowe MAVINCI – od techniki scenicznej po interaktywne atrakcje."
        />
        <meta property="og:url" content={canonicalUrl} />
        <meta
          property="og:image"
          content="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop"
        />
        <meta property="og:site_name" content="MAVINCI Event & ART" />
        <meta property="og:locale" content="pl_PL" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Usługi Eventowe – MAVINCI Event & ART" />
        <meta
          name="twitter:description"
          content="Przegląd głównych usług eventowych MAVINCI dla konferencji, gal i wydarzeń firmowych."
        />
        <meta
          name="twitter:image"
          content="https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop"
        />

        <link rel="canonical" href={canonicalUrl} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(combinedJsonLd)
          }}
        />
      </Head>

      <Navbar />

      <main className="min-h-screen bg-gradient-to-b from-[#0f1119] to-[#1c1f33] pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <CategoryBreadcrumb />
          </div>

          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-light text-[#e5e4e2] mb-6">
              Nasze <span className="text-[#d3bb73] font-normal">Usługi</span>
            </h1>
            <p className="text-lg text-[#e5e4e2]/70 max-w-3xl mx-auto">
              Oferujemy kompleksową obsługę techniczną i organizację eventów.
              Wybierz usługę, która Cię interesuje i poznaj szczegóły.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {services.map((service, index) => (
              <ServiceCard
                key={service.id}
                slug={service.slug}
                title={service.title}
                description={service.description}
                iconName={service.icon_name}
                colorFrom={service.color_from}
                colorTo={service.color_to}
                borderColor={service.border_color}
                heroImageUrl={service.hero_image_url || undefined}
                heroOpacity={service.hero_opacity}
                index={index}
              />
            ))}
          </div>

          <div className="mt-16 text-center">
            <Link
              href="/#kontakt"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/40"
            >
              Skontaktuj się z nami
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <style jsx>{`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </main>

      <Footer />
    </>
  );
}
