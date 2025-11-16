'use client';

import { useEffect, useState } from 'react';
import { useParams, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';

export default function CityConferencePage() {
  const params = useParams();
  const [city, setCity] = useState<any>(null);
  const [ogImage, setOgImage] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [params.miasto]);

  const loadData = async () => {
    try {
      const [cityRes, ogImageRes] = await Promise.all([
        supabase
          .from('conferences_cities')
          .select('*')
          .eq('slug', params.miasto)
          .eq('is_active', true)
          .single(),
        supabase
          .from('site_images')
          .select('desktop_url')
          .eq('section', 'konferencje-hero')
          .eq('is_active', true)
          .single()
      ]);

      if (cityRes.error || !cityRes.data) {
        redirect('/uslugi/konferencje');
        return;
      }

      setCity(cityRes.data);
      setOgImage(ogImageRes.data?.desktop_url || 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop');
    } catch (error) {
      redirect('/uslugi/konferencje');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (city) {
      redirect('/uslugi/konferencje');
    }
  }, [city]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `Obsługa Konferencji ${city?.city_name}`,
    description: city?.seo_description,
    provider: {
      '@type': 'Organization',
      name: 'MAVINCI Event & ART',
      url: 'https://mavinci.pl',
      logo: 'https://mavinci.pl/logo-mavinci-crm.png',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Bydgoszcz',
        addressRegion: 'Kujawsko-Pomorskie',
        addressCountry: 'PL'
      },
      telephone: '+48-123-456-789',
      email: 'kontakt@mavinci.pl'
    },
    areaServed: {
      '@type': 'City',
      name: city?.city_name,
      containedIn: {
        '@type': 'State',
        name: `Województwo ${city?.voivodeship}`
      }
    },
    serviceType: 'Obsługa Techniczna Konferencji',
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      priceRange: '$$'
    }
  };

  return (
    <>
      <Head>
        <title>{city?.seo_title || 'Obsługa Konferencji - MAVINCI Event & ART'}</title>
        <meta name="description" content={city?.seo_description || ''} />
        <meta
          name="keywords"
          content={`obsługa konferencji ${city?.city_name}, nagłośnienie konferencyjne ${city?.city_name}, technika av ${city?.city_name}, streaming konferencji ${city?.city_name}, realizacja live ${city?.city_name}`}
        />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={city?.seo_title} />
        <meta property="og:description" content={city?.seo_description} />
        <meta property="og:url" content={`https://mavinci.pl/uslugi/konferencje/${city?.slug}`} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={`MAVINCI Obsługa Konferencji ${city?.city_name}`} />
        <meta property="og:site_name" content="MAVINCI Event & ART" />
        <meta property="og:locale" content="pl_PL" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={city?.seo_title} />
        <meta name="twitter:description" content={city?.seo_description} />
        <meta name="twitter:image" content={ogImage} />
        <meta name="twitter:image:alt" content={`MAVINCI Obsługa Konferencji ${city?.city_name}`} />

        {/* Canonical */}
        <link rel="canonical" href={`https://mavinci.pl/uslugi/konferencje/${city?.slug}`} />

        {/* JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <div className="min-h-screen bg-[#0f1119]"></div>
    </>
  );
}
