'use client';

import { useState } from 'react';
import Link from 'next/link';

export type ServiceCity = { slug: string; name: string; region: string | null };
const normalize = (value: string) => value.toLocaleLowerCase('pl-PL').replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** The initial render contains every published link, even without JavaScript. */
export default function ServiceCityDirectory({ cities, basePath }: { cities: ServiceCity[]; basePath: string }) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const regionName = (city: ServiceCity) => city.region || 'Pozostałe lokalizacje';
  const regions = [...new Set(cities.map(regionName))].sort((a, b) => a.localeCompare(b, 'pl'));
  const filtered = cities.filter(city => (!region || regionName(city) === region) &&
    normalize(`${city.name} ${city.slug}`).includes(normalize(query.trim())));
  return <div className="mt-9">
    <div className="grid gap-4 rounded-2xl bg-white/[0.035] p-5 sm:grid-cols-2">
      <label className="text-sm text-white/75">Szukaj miasta<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Np. Olsztyn" className="mt-2 block min-h-12 w-full rounded-xl border border-white/10 bg-[#190f1b] px-4 text-white outline-none focus:bg-[#341624]" /></label>
      <label className="text-sm text-white/75">Województwo<select value={region} onChange={event => setRegion(event.target.value)} className="mt-2 block min-h-12 w-full rounded-xl border border-white/10 bg-[#190f1b] px-4 text-white outline-none focus:bg-[#341624]"><option value="">Wszystkie regiony</option>{regions.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>
    <p className="mt-4 text-sm text-white/60" aria-live="polite">Liczba lokalizacji: {filtered.length}</p>
    {regions.map(item => {
      const entries = filtered.filter(city => regionName(city) === item);
      if (!entries.length) return null;
      return <section key={item} className="mt-9"><h2 className="text-xl text-[#d3bb73]">{item}</h2><ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{entries.map(city => <li key={city.slug}><Link href={`${basePath}/${city.slug}`} className="flex min-h-16 items-center justify-between gap-4 rounded-xl bg-white/[0.045] px-5 py-4 text-white hover:bg-white/10 focus-visible:bg-[#341624]">{city.name}<span aria-hidden="true" className="text-[#d3bb73]">↗</span></Link></li>)}</ul></section>;
    })}
    {!filtered.length && <p className="mt-8 leading-7 text-white/75">Nie znaleziono lokalizacji spełniającej kryteria. Zmień filtry lub zapytaj nas o obsługę wydarzenia w wybranym miejscu.</p>}
  </div>;
}
