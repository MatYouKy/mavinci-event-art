'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { PortfolioCitySettings } from '@/lib/SEO/conferencePortfolio';

type City = { locality: string; name: string };
type Props = { value: PortfolioCitySettings; onChange: (value: PortfolioCitySettings) => void; available?: boolean };
const fieldClass = 'mt-2 w-full rounded-lg border border-white/10 bg-[#190f1b] px-3 py-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';

export function PortfolioCityFields({ value, onChange, available = true }: Props) {
  const [cities, setCities] = useState<City[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.from('schema_org_places').select('locality,name').eq('is_global', true).order('name')
      .then(({ data, error }) => {
        if (!active) return;
        setError(Boolean(error));
        setCities((data || []).filter(city => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.locality || '')));
      });
    return () => { active = false; };
  }, []);
  const filtered = cities.filter(city => city.name.toLocaleLowerCase('pl-PL').includes(query.toLocaleLowerCase('pl-PL')));
  return <fieldset disabled={!available} className="my-6 space-y-5 rounded-xl bg-white/[0.04] p-5 text-white/80 disabled:opacity-60">
    <legend className="px-2 text-base font-medium text-[#d3bb73]">Miasto realizacji i strony konferencji</legend>
    {!available && <p role="status" className="text-sm">Pola będą dostępne po zastosowaniu migracji bazy „conference_portfolio_city_references”. Pozostałe dane realizacji możesz zapisać.</p>}
    <label className="block text-sm">Gdzie wydarzenie faktycznie się odbyło?
      <select className={fieldClass} value={value.event_city_slug || ''} onChange={event => onChange({ ...value, event_city_slug: event.target.value || null })}>
        <option value="">Nie przypisano miasta / inne miejsce</option>
        {value.event_city_slug && !cities.some(city => city.locality === value.event_city_slug) && <option value={value.event_city_slug}>Dotychczas przypisane miasto</option>}
        {cities.map(city => <option key={city.locality} value={city.locality}>{city.name}</option>)}
      </select>
      <span className="mt-2 block text-xs leading-5 text-white/55">W polu „Lokalizacja” podaj również nazwę obiektu. Wybieraj wyłącznie rzeczywiste miejsce wydarzenia.</span>
    </label>
    <label className="block text-sm">Pokazywanie na stronach konferencji
      <select className={fieldClass} value={value.conference_reference_enabled === null ? 'inherit' : value.conference_reference_enabled ? 'include' : 'exclude'} onChange={event => onChange({ ...value, conference_reference_enabled: event.target.value === 'inherit' ? null : event.target.value === 'include' })}>
        <option value="inherit">Automatycznie — według tagu „konferencje”</option>
        <option value="include">Pokazuj jako przykład obsługi konferencji</option>
        <option value="exclude">Nie pokazuj na stronach konferencji</option>
      </select>
    </label>
    <div>
      <p className="text-sm font-medium">Priorytetowe miasta dla tej referencji</p>
      <p className="mt-2 text-xs leading-5 text-white/60">Te tagi określają, na których stronach pokazać realizację wyżej. Nie zmieniają jej miejsca. Bez tagów przykład nadal może być wyświetlany we wszystkich obsługiwanych miastach.</p>
      <label className="block"><span className="sr-only">Szukaj miasta</span><input className={fieldClass} type="search" placeholder="Szukaj miasta…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {error && <p role="alert" className="mt-3 text-sm">Nie udało się wczytać miast. Odśwież edycję przed zmianą przypisania.</p>}
      <div className="mt-3 grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
        {filtered.map(city => <label key={city.locality} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5">
          <input type="checkbox" className="accent-[#d3bb73]" checked={value.reference_city_slugs.includes(city.locality)} onChange={event => onChange({ ...value, reference_city_slugs: event.target.checked ? [...value.reference_city_slugs, city.locality] : value.reference_city_slugs.filter(slug => slug !== city.locality) })} />
          {city.name}
        </label>)}
      </div>
    </div>
  </fieldset>;
}
