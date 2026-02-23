'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import Link from 'next/link';
import { MapPin, Search } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import SchemaLayout from '@/components/SchemaLayout';

export default function KonferencjeLokalizacjePage() {
  const [cities, setCities] = useState<any[]>([]);
  const [filteredCities, setFilteredCities] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCities();
  }, []);

  useEffect(() => {
    filterCities();
  }, [searchQuery, selectedRegion, cities]);

  const loadCities = async () => {
    const { data, error } = await supabase
      .from('schema_org_places')
      .select('*')
      .eq('is_global', true)
      .eq('is_active', true)
      .order('name');

    if (data && !error) {
      setCities(data);
      setFilteredCities(data);
    }
    setLoading(false);
  };

  const filterCities = () => {
    let filtered = cities;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (city) =>
          city.name.toLowerCase().includes(query) || city.locality.toLowerCase().includes(query),
      );
    }

    if (selectedRegion !== 'all') {
      filtered = filtered.filter((city) => city.region === selectedRegion);
    }

    setFilteredCities(filtered);
  };

  const regions = Array.from(new Set(cities.map((c) => c.region))).sort();
  const groupedByRegion = filteredCities.reduce(
    (acc, city) => {
      if (!acc[city.region]) {
        acc[city.region] = [];
      }
      acc[city.region].push(city);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  return (
    <SchemaLayout
      pageSlug="konferencje-lokalizacje"
      defaultTitle="Obsługa Konferencji w Całej Polsce - Lokalizacje | MAVINCI"
      defaultDescription="Profesjonalna obsługa konferencji w ponad 60 miastach Polski. Sprawdź, gdzie świadczymy nasze usługi: Warszawa, Gdańsk, Kraków, Wrocław i wiele innych."
      breadcrumb={[
        { name: 'Start', url: 'https://mavinci.pl/' },
        { name: 'Oferta', url: 'https://mavinci.pl/oferta' },
        { name: 'Konferencje', url: 'https://mavinci.pl/oferta/konferencje' },
        { name: 'Lokalizacje', url: 'https://mavinci.pl/oferta/konferencje/lokalizacje' },
      ]}
    >
      <div className="min-h-screen bg-[#0f1119] pt-20">
        {/* Hero Section */}
        <section className="border-b border-[#d3bb73]/20 px-6 py-16">
          <div className="mx-auto max-w-7xl">
            <section className="min-h-[50px] px-6 pt-6">
              <div className="mx-auto min-h-[50px] max-w-7xl">
                <CategoryBreadcrumb pageSlug="konferencje-lokalizacje" />
              </div>
            </section>

            <div className="mt-12 text-center">
              <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-5xl">
                Obsługa Konferencji <span className="text-[#d3bb73]">w Całej Polsce</span>
              </h1>
              <p className="mx-auto max-w-3xl text-xl text-[#e5e4e2]/70">
                Profesjonalne nagłośnienie, multimedia i realizacja live dla konferencji w ponad{' '}
                {cities.length} miastach
              </p>
            </div>
          </div>
        </section>

        {/* Search & Filter */}
        <section className="border-b border-[#d3bb73]/20 bg-[#1c1f33]/20 px-6 py-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-4 md:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj miasta..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-12 pr-4 text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73]"
                />
              </div>

              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
              >
                <option value="all">Wszystkie województwa</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 text-sm text-[#e5e4e2]/60">
              Znaleziono:{' '}
              <span className="font-medium text-[#d3bb73]">{filteredCities.length}</span>{' '}
              {filteredCities.length === 1 ? 'miasto' : 'miast'}
            </div>
          </div>
        </section>

        {/* Cities List */}
        <section className="px-6 py-16">
          <div className="mx-auto max-w-7xl">
            {loading ? (
              <div className="text-center text-[#e5e4e2]/60">Ładowanie...</div>
            ) : filteredCities.length === 0 ? (
              <div className="text-center text-[#e5e4e2]/60">
                <p>Nie znaleziono miast spełniających kryteria</p>
              </div>
            ) : (
              <div className="space-y-12">
                {Object.entries(groupedByRegion).map(([region, regionCities]) => (
                  <div key={region}>
                    <h2 className="mb-6 border-b border-[#d3bb73]/20 pb-3 text-2xl font-light text-[#e5e4e2]">
                      {region}{' '}
                      <span className="text-lg text-[#d3bb73]">
                        ({(regionCities as any[]).length})
                      </span>
                    </h2>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {(
                        regionCities as Array<{
                          id: string;
                          locality: string;
                          name: string;
                          postal_code: string;
                        }>
                      ).map(
                        (city: {
                          id: string;
                          locality: string;
                          name: string;
                          postal_code: string;
                        }) => (
                          <Link
                            key={city.id}
                            href={`/oferta/konferencje/${city.locality}`}
                            className="group rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73] hover:shadow-lg hover:shadow-[#d3bb73]/10"
                          >
                            <div className="flex items-start gap-3">
                              <MapPin className="mt-1 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                              <div className="flex-1">
                                <h3 className="text-lg font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                  {city.name}
                                </h3>
                                <p className="mt-1 text-sm text-[#e5e4e2]/60">{city.postal_code}</p>
                                <p className="mt-2 text-xs text-[#d3bb73]/70">
                                  Obsługa konferencji w {city.locality}
                                </p>
                              </div>
                            </div>
                          </Link>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-[#d3bb73]/20 bg-[#1c1f33]/20 px-6 py-16">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2]">
              Nie widzisz swojej lokalizacji?
            </h2>
            <p className="mb-8 text-lg text-[#e5e4e2]/70">
              Skontaktuj się z nami - obsługujemy również inne miasta w całej Polsce
            </p>
            <Link
              href="/#kontakt"
              className="inline-block rounded bg-[#d3bb73] px-8 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Skontaktuj się
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </SchemaLayout>
  );
}
