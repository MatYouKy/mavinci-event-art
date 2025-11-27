'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MapPin, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface CityContent {
  city: string;
  region: string;
  custom_title: string;
  custom_description: string;
  custom_h1: string;
  local_features: {
    landmarks?: string[];
    venues?: string[];
    coverage?: string;
  };
}

interface MultiCitySEOProps {
  pageSlug: string;
  defaultCity?: string;
  onCityChange?: (city: string) => void;
}

export default function MultiCitySEO({
  pageSlug,
  defaultCity = '',
  onCityChange,
}: MultiCitySEOProps) {
  const searchParams = useSearchParams();
  const [selectedCity, setSelectedCity] = useState(defaultCity);
  const [cityContent, setCityContent] = useState<CityContent | null>(null);
  const [availableCities, setAvailableCities] = useState<string[]>([]);

  useEffect(() => {
    const cityParam = searchParams?.get('miasto');
    if (cityParam) {
      setSelectedCity(cityParam);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchAvailableCities();
  }, [pageSlug]);

  useEffect(() => {
    if (selectedCity) {
      fetchCityContent(selectedCity);
      if (onCityChange) {
        onCityChange(selectedCity);
      }
    }
  }, [selectedCity, pageSlug]);

  const fetchAvailableCities = async () => {
    try {
      const { data } = await supabase
        .from('seo_city_content')
        .select('city')
        .eq('page_slug', pageSlug)
        .eq('is_active', true)
        .order('city');

      if (data) {
        setAvailableCities(data.map(d => d.city));
      }
    } catch (error) {
      console.error('Error fetching cities:', error);
    }
  };

  const fetchCityContent = async (city: string) => {
    try {
      const { data } = await supabase
        .from('seo_city_content')
        .select('*')
        .eq('page_slug', pageSlug)
        .eq('city', city)
        .eq('is_active', true)
        .maybeSingle();

      if (data) {
        setCityContent(data);

        if (typeof document !== 'undefined') {
          document.title = data.custom_title;

          const metaDescription = document.querySelector('meta[name="description"]');
          if (metaDescription) {
            metaDescription.setAttribute('content', data.custom_description);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching city content:', error);
    }
  };

  if (availableCities.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#0f1119]/60 border-y border-[#d3bb73]/10 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {selectedCity && cityContent ? (
          <div className="space-y-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full mb-4">
                <MapPin className="w-4 h-4 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#d3bb73]">{cityContent.city}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                {cityContent.custom_h1}
              </h2>
              <p className="text-[#e5e4e2]/70 text-lg max-w-3xl mx-auto">
                {cityContent.custom_description}
              </p>
            </div>

            {cityContent.local_features && (
              <div className="grid md:grid-cols-3 gap-6">
                {cityContent.local_features.landmarks && (
                  <div className="bg-[#0f1119]/60 border border-[#d3bb73]/10 rounded-xl p-6">
                    <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Lokalizacje</h3>
                    <ul className="space-y-2">
                      {cityContent.local_features.landmarks.map((landmark, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-[#e5e4e2]/70 text-sm">
                          <Check className="w-4 h-4 text-[#d3bb73]" />
                          {landmark}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {cityContent.local_features.venues && (
                  <div className="bg-[#0f1119]/60 border border-[#d3bb73]/10 rounded-xl p-6">
                    <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Obiekty</h3>
                    <ul className="space-y-2">
                      {cityContent.local_features.venues.map((venue, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-[#e5e4e2]/70 text-sm">
                          <Check className="w-4 h-4 text-[#d3bb73]" />
                          {venue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {cityContent.local_features.coverage && (
                  <div className="bg-[#0f1119]/60 border border-[#d3bb73]/10 rounded-xl p-6">
                    <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Zasięg</h3>
                    <p className="text-[#e5e4e2]/70 text-sm">
                      {cityContent.local_features.coverage}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="text-center">
              <button
                onClick={() => setSelectedCity('')}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm transition-colors"
              >
                Zmień miasto
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center mb-8">
              <h2 className="text-2xl md:text-3xl font-light text-[#e5e4e2] mb-3">
                Wybierz swoje miasto
              </h2>
              <p className="text-[#e5e4e2]/60">
                Dostosujemy treści do Twojej lokalizacji
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {availableCities.map((city) => (
                <button
                  key={city}
                  onClick={() => setSelectedCity(city)}
                  className="group relative px-6 py-4 bg-[#0f1119]/60 border border-[#d3bb73]/20 rounded-xl hover:border-[#d3bb73]/60 hover:bg-[#d3bb73]/5 transition-all"
                >
                  <div className="flex flex-col items-center gap-2">
                    <MapPin className="w-5 h-5 text-[#d3bb73] group-hover:scale-110 transition-transform" />
                    <span className="text-sm font-light text-[#e5e4e2]">{city}</span>
                  </div>
                </button>
              ))}
            </div>

            <p className="text-center text-xs text-[#e5e4e2]/40 mt-6">
              Nie widzisz swojego miasta? Obsługujemy całą Polskę - skontaktuj się z nami!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
