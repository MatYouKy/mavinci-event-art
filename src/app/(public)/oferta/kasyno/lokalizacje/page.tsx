'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import Link from 'next/link';
import { MapPin, Search, Dice1 } from 'lucide-react';
import Footer from '@/components/Footer';
import SchemaLayout from '@/components/SchemaLayout';

export default function CasinoLokalizacjePage() {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (!acc[city.region]) acc[city.region] = [];
      acc[city.region].push(city);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  return (
    <SchemaLayout
      pageSlug="kasyno-lokalizacje"
      defaultTitle="Kasyno Rozrywkowe w Calej Polsce - Lokalizacje | MAVINCI"
      defaultDescription="Profesjonalne kasyno rozrywkowe na eventy w ponad 60 miastach Polski. Stoły do ruletki, blackjacka, pokera, krupierzy, kompletna oprawa Las Vegas."
      breadcrumb={[
        { name: 'Start', url: 'https://mavinci.pl/' },
        { name: 'Oferta', url: 'https://mavinci.pl/oferta' },
        { name: 'Kasyno', url: 'https://mavinci.pl/oferta/kasyno' },
        { name: 'Lokalizacje', url: 'https://mavinci.pl/oferta/kasyno/lokalizacje' },
      ]}
    >
      <div className="min-h-screen bg-[#0f1119] pt-20">
        <section className="border-b border-[#d3bb73]/20 px-6 py-16">
          <div className="mx-auto max-w-7xl">
            <div className="mt-12 text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10">
                  <Dice1 className="h-8 w-8 text-[#d3bb73]" />
                </div>
              </div>
              <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-5xl">
                Kasyno Rozrywkowe <span className="text-[#d3bb73]">w Calej Polsce</span>
              </h1>
              <p className="mx-auto max-w-3xl text-xl text-[#e5e4e2]/70">
                Profesjonalne kasyno rozrywkowe na eventy firmowe w ponad{' '}
                {cities.length} miastach. Ruletka, blackjack, poker i krupierzy.
              </p>
            </div>
          </div>
        </section>

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
                <option value="all">Wszystkie wojewodztwa</option>
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

        <section className="px-6 py-16">
          <div className="mx-auto max-w-7xl">
            {loading ? (
              <div className="text-center text-[#e5e4e2]/60">Ladowanie...</div>
            ) : filteredCities.length === 0 ? (
              <div className="text-center text-[#e5e4e2]/60">
                Nie znaleziono miast spelniajacych kryteria
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
                      {(regionCities as any[]).map((city) => (
                        <Link
                          key={city.id}
                          href={`/oferta/kasyno/${city.locality}`}
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
                                Kasyno rozrywkowe w {city.locality}
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="border-t border-[#d3bb73]/20 bg-[#1c1f33]/20 px-6 py-16">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2]">
              Nie widzisz swojej lokalizacji?
            </h2>
            <p className="mb-8 text-lg text-[#e5e4e2]/70">
              Organizujemy kasyno rozrywkowe w calej Polsce - skontaktuj sie, a przygotujemy indywidualna oferte
            </p>
            <Link
              href="/#kontakt"
              className="inline-block rounded bg-[#d3bb73] px-8 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Skontaktuj sie
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </SchemaLayout>
  );
}
