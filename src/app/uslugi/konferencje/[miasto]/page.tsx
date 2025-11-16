'use client';

import { useEffect, useState } from 'react';
import { useParams, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';

export default function CityConferencePage() {
  const params = useParams();
  const [city, setCity] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCity();
  }, [params.miasto]);

  const loadCity = async () => {
    try {
      const { data, error } = await supabase
        .from('conferences_cities')
        .select('*')
        .eq('slug', params.miasto)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        redirect('/uslugi/konferencje');
        return;
      }

      setCity(data);
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

  return (
    <>
      <Head>
        <title>{city?.seo_title || 'Obsługa Konferencji - MAVINCI'}</title>
        <meta name="description" content={city?.seo_description || ''} />
        <meta
          name="keywords"
          content={`obsługa konferencji ${city?.city_name}, nagłośnienie konferencyjne ${city?.city_name}, technika av ${city?.city_name}, streaming konferencji ${city?.city_name}`}
        />
        <link rel="canonical" href={`https://mavinci.pl/uslugi/konferencje/${city?.slug}`} />
      </Head>
      <div className="min-h-screen bg-[#0f1119]"></div>
    </>
  );
}
