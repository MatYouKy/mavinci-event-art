'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
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
      filtered = filtered.filter(city =>
        city.name.toLowerCase().includes(query) ||
        city.locality.toLowerCase().includes(query)
      );
    }

    if (selectedRegion !== 'all') {
      filtered = filtered.filter(city => city.region === selectedRegion);
    }

    setFilteredCities(filtered);
  };

  const regions = Array.from(new Set(cities.map(c => c.region))).sort();
  const groupedByRegion = filteredCities.reduce((acc, city) => {
    if (!acc[city.region]) {
      acc[city.region] = [];
    }
    acc[city.region].push(city);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <SchemaLayout
      pageSlug="konferencje-lokalizacje"
      defaultTitle="Obsługa Konferencji w Całej Polsce - Lokalizacje | MAVINCI"
      defaultDescription="Profesjonalna obsługa konferencji w ponad 60 miastach Polski. Sprawdź, gdzie świadczymy nasze usługi: Warszawa, Gdańsk, Kraków, Wrocław i wiele innych."
      breadcrumb={[
        { name: 'Start', url: 'https://mavinci.pl/' },
        { name: 'Oferta', url: 'https://mavinci.pl/oferta' },
        { name: 'Konferencje', url: 'https://mavinci.pl/oferta/konferencje' },
        { name: 'Lokalizacje', url: 'https://mavinci.pl/oferta/konferencje/lokalizacje' }
      ]}
    >
      <Navbar />

      <div className="min-h-screen bg-[#0f1119] pt-20">
        {/* Hero Section */}
        <section className="py-16 px-6 border-b border-[#d3bb73]/20">
          <div className="max-w-7xl mx-auto">
            <CategoryBreadcrumb pageSlug="konferencje-lokalizacje" />

            <div className="text-center mt-12">
              <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6">
                Obsługa Konferencji <span className="text-[#d3bb73]">w Całej Polsce</span>
              </h1>
              <p className="text-xl text-[#e5e4e2]/70 max-w-3xl mx-auto">
                Profesjonalne nagłośnienie, multimedia i realizacja live dla konferencji w ponad {cities.length} miastach
              </p>
            </div>
          </div>
        </section>

        {/* Search & Filter */}
        <section className="py-8 px-6 border-b border-[#d3bb73]/20 bg-[#1c1f33]/20">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj miasta..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 outline-none focus:border-[#d3bb73]"
                />
              </div>

              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
              >
                <option value="all">Wszystkie województwa</option>
                {regions.map(region => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>

            <div className="mt-4 text-[#e5e4e2]/60 text-sm">
              Znaleziono: <span className="text-[#d3bb73] font-medium">{filteredCities.length}</span> {filteredCities.length === 1 ? 'miasto' : 'miast'}
            </div>
          </div>
        </section>

        {/* Cities List */}
        <section className="py-16 px-6">
          <div className="max-w-7xl mx-auto">
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
                    <h2 className="text-2xl font-light text-[#e5e4e2] mb-6 pb-3 border-b border-[#d3bb73]/20">
                      {region} <span className="text-[#d3bb73] text-lg">({regionCities.length})</span>
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {regionCities.map((city) => (
                        <Link
                          key={city.id}
                          href={`/oferta/konferencje/${city.locality}`}
                          className="group p-6 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg hover:border-[#d3bb73] transition-all hover:shadow-lg hover:shadow-[#d3bb73]/10"
                        >
                          <div className="flex items-start gap-3">
                            <MapPin className="w-5 h-5 text-[#d3bb73] mt-1 flex-shrink-0" />
                            <div className="flex-1">
                              <h3 className="text-lg font-medium text-[#e5e4e2] group-hover:text-[#d3bb73] transition-colors">
                                {city.name}
                              </h3>
                              <p className="text-sm text-[#e5e4e2]/60 mt-1">
                                {city.postal_code}
                              </p>
                              <p className="text-xs text-[#d3bb73]/70 mt-2">
                                Obsługa konferencji w {city.locality}
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

        {/* CTA Section */}
        <section className="py-16 px-6 border-t border-[#d3bb73]/20 bg-[#1c1f33]/20">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-light text-[#e5e4e2] mb-6">
              Nie widzisz swojej lokalizacji?
            </h2>
            <p className="text-lg text-[#e5e4e2]/70 mb-8">
              Skontaktuj się z nami - obsługujemy również inne miasta w całej Polsce
            </p>
            <Link
              href="/#kontakt"
              className="inline-block px-8 py-3 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors font-medium"
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
