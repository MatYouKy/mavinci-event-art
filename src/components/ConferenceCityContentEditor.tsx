'use client';

import type { ConferenceCityContent } from '@/lib/SEO/conferenceCityContent';

type Props = { value: ConferenceCityContent; onChange: (value: ConferenceCityContent) => void };
const fieldClass = 'mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50';
const fields = [
  { key: 'heading', label: 'Nagłówek sekcji lokalnej', rows: 2 },
  { key: 'intro', label: 'Wprowadzenie do oferty w mieście', rows: 4 },
  { key: 'planning', label: 'Przygotowanie wydarzenia', rows: 5 },
] as const;

export function ConferenceCityContentEditor({ value, onChange }: Props) {
  return <details className="rounded-xl bg-white/[0.04] p-4 text-[#e5e4e2]">
    <summary className="cursor-pointer py-2 font-medium text-[#d3bb73]">Treść lokalnej strony konferencji</summary>
    <p className="mt-3 text-sm leading-6 text-white/65">Te informacje pojawiają się pod nagłówkiem strony. Pytania dla tego miasta edytujesz niżej w sekcji pytań i odpowiedzi.</p>
    <div className="mt-5 space-y-4">
      {fields.map(field => <label key={field.key} className="block text-sm">
        {field.label}
        <textarea className={fieldClass} rows={field.rows} value={value[field.key]} onChange={event => onChange({ ...value, [field.key]: event.target.value })} />
      </label>)}
      {value.checks.map((check, index) => <label key={index} className="block text-sm">
        Przygotowanie wyceny — punkt {index + 1}
        <textarea className={fieldClass} rows={2} value={check} onChange={event => onChange({ ...value, checks: value.checks.map((item, position) => position === index ? event.target.value : item) })} />
      </label>)}
      <label className="block text-sm">Nazwa przykładowego obiektu
        <input className={fieldClass} value={value.venue.name} onChange={event => onChange({ ...value, venue: { ...value.venue, name: event.target.value } })} />
      </label>
      <label className="block text-sm">Wskazówka dotycząca obiektu
        <textarea className={fieldClass} rows={4} value={value.venue.fact} onChange={event => onChange({ ...value, venue: { ...value.venue, fact: event.target.value } })} />
      </label>
      <label className="block text-sm">Oficjalne źródło informacji (adres HTTPS)
        <input type="url" className={fieldClass} value={value.venue.url} onChange={event => onChange({ ...value, venue: { ...value.venue, url: event.target.value } })} />
      </label>
      <p className="text-xs leading-5 text-white/55">Przykładowy obiekt służy planowaniu wydarzenia. Wykonaną realizację dodaj osobno do portfolio, z jej rzeczywistą lokalizacją.</p>
    </div>
  </details>;
}
