'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MapPin, Search } from 'lucide-react';

type City = { id: string; locality: string; name: string; region: string };
function searchText(value: string) {
  return value.trim().toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

/** The complete initial list comes from the server; only filtering needs JavaScript. */
export default function CasinoLocationsClient({ cities }: { cities: City[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const regions = useMemo(() => Array.from(new Set(cities.map(city => city.region))).sort((a, b) => a.localeCompare(b, 'pl')), [cities]);
  const filteredCities = useMemo(() => {
    const query = searchText(searchQuery);
    return cities.filter(city => (!selectedRegion || city.region === selectedRegion)
      && (!query || searchText(city.name).includes(query) || city.locality.includes(query)));
  }, [cities, searchQuery, selectedRegion]);
  const grouped = useMemo(() => filteredCities.reduce<Record<string, City[]>>((groups, city) => {
    (groups[city.region] ||= []).push(city);
    return groups;
  }, {}), [filteredCities]);

  return <>
    <section aria-label="Wybierz miasto" className="border-y border-white/10 bg-white/[0.02] px-5 py-8 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Szukaj miasta</span>
            <Search aria-hidden="true" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
            <input type="search" placeholder="Szukaj miasta…" value={searchQuery} onChange={event => setSearchQuery(event.target.value)}
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#190f1b] py-3 pl-12 pr-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/50" />
          </label>
          <label>
            <span className="sr-only">Województwo</span>
            <select value={selectedRegion} onChange={event => setSelectedRegion(event.target.value)}
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#190f1b] px-4 py-3 text-base sm:w-auto">
              <option value="">Wszystkie województwa</option>
              {regions.map(region => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
        </div>
        <p aria-live="polite" className="mt-4 text-sm text-white/60">Liczba lokalizacji: <span className="text-[#d3bb73]">{filteredCities.length}</span></p>
      </div>
    </section>
    <section aria-label="Lokalizacje kasyna eventowego" className="px-5 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-12">
        {filteredCities.length === 0 && <p className="text-white/70">Nie znaleziono miasta. Zmień wyszukiwanie lub skontaktuj się z nami.</p>}
        {Object.entries(grouped).map(([region, regionCities]) => <div key={region}>
          <h2 className="mb-5 text-2xl font-light uppercase">{region}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {regionCities.map(city => <Link key={city.id} href={`/oferta/kasyno/${city.locality}`}
              className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]">
              <MapPin className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-lg uppercase group-hover:text-[#d3bb73]">{city.name}</h3>
                <p className="mt-2 text-sm text-white/65">Kasyno na eventy firmowe i integracje</p>
              </div>
            </Link>)}
          </div>
        </div>)}
      </div>
    </section>
  </>;
}
