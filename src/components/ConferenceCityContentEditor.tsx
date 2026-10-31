'use client';

import type { ConferenceCityContent } from '@/lib/SEO/conferenceCityContent';

type Props = { value: ConferenceCityContent; onChange: (value: ConferenceCityContent) => void };
const fieldClass = 'mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50';
const fields = [
  { key: 'heading', label: 'Nagłówek sekcji lokalnej', rows: 2 },
  { key: 'intro', label: 'Wprowadzenie do oferty w mieście', rows: 4 },
  { key: 'planningHeading', label: 'Nagłówek przygotowania wydarzenia (opcjonalny)', rows: 2 },
  { key: 'planning', label: 'Przygotowanie wydarzenia', rows: 5 },
  { key: 'formatsHeading', label: 'Nagłówek wariantów obsługi (opcjonalny)', rows: 2 },
  { key: 'logistics', label: 'Dojazd, montaż i obsługa sal', rows: 4 },
  { key: 'recording', label: 'Streaming i nagrania', rows: 4 },
  { key: 'partnership', label: 'Współpraca z agencjami i hotelami', rows: 4 },
] as const;

export function ConferenceCityContentEditor({ value, onChange }: Props) {
  return <details className="rounded-xl bg-white/[0.04] p-4 text-[#e5e4e2]">
    <summary className="cursor-pointer py-2 font-medium text-[#d3bb73]">Treść lokalnej strony konferencji</summary>
    <p className="mt-3 text-sm leading-6 text-white/65">Te informacje pojawiają się pod nagłówkiem strony. Pytania dla tego miasta edytujesz niżej w sekcji pytań i odpowiedzi.</p>
    <div className="mt-5 space-y-4">
      {fields.map(field => <label key={field.key} className="block text-sm">
        {field.label}
        <textarea className={fieldClass} rows={field.rows} value={value[field.key] || ''} onChange={event => onChange({ ...value, [field.key]: event.target.value })} />
      </label>)}
      {value.checks.map((check, index) => <label key={index} className="block text-sm">
        Przygotowanie wyceny — punkt {index + 1}
        <textarea className={fieldClass} rows={2} value={check} onChange={event => onChange({ ...value, checks: value.checks.map((item, position) => position === index ? event.target.value : item) })} />
      </label>)}
      <label className="block text-sm">Czynniki wyceny — jeden punkt w wierszu
        <textarea className={fieldClass} rows={6} value={(value.costFactors || []).join('\n')} onChange={event => onChange({ ...value, costFactors: event.target.value.split('\n') })} />
      </label>
      {(value.scenarios || []).map((scenario, index) => <div key={index} className="space-y-2 rounded-lg bg-black/15 p-3">
        <label className="block text-sm">Scenariusz {index + 1} — nazwa
          <input className={fieldClass} value={scenario.title} onChange={event => onChange({ ...value, scenarios: value.scenarios?.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })} />
        </label>
        <label className="block text-sm">Zakres realizacji
          <textarea className={fieldClass} rows={4} value={scenario.description} onChange={event => onChange({ ...value, scenarios: value.scenarios?.map((item, position) => position === index ? { ...item, description: event.target.value } : item) })} />
        </label>
        <button type="button" className="min-h-11 text-sm text-white/60" onClick={() => onChange({ ...value, scenarios: value.scenarios?.filter((_, position) => position !== index) })}>Usuń scenariusz</button>
      </div>)}
      <button type="button" className="min-h-11 rounded-lg bg-white/5 px-4 text-sm text-[#d3bb73]" onClick={() => onChange({ ...value, scenarios: [...(value.scenarios || []), { title: '', description: '' }] })}>Dodaj scenariusz</button>
      <label className="block text-sm">Nagłówek lokalnych korzyści (opcjonalny)
        <input className={fieldClass} value={value.benefitsHeading || ''} onChange={event => onChange({ ...value, benefitsHeading: event.target.value })} />
      </label>
      <p className="text-xs leading-5 text-white/55">Korzyści dla tego miasta zastępują ogólną sekcję zalet. Opisuj własne zaplecze, sposób realizacji i potwierdzone doświadczenie.</p>
      {(value.benefits || []).map((benefit, index) => <div key={index} className="space-y-2 rounded-lg bg-black/15 p-3">
        <label className="block text-sm">Korzyść {index + 1} — nazwa
          <input className={fieldClass} value={benefit.title} onChange={event => onChange({ ...value, benefits: value.benefits?.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })} />
        </label>
        <label className="block text-sm">Konkretna wartość dla organizatora
          <textarea className={fieldClass} rows={4} value={benefit.description} onChange={event => onChange({ ...value, benefits: value.benefits?.map((item, position) => position === index ? { ...item, description: event.target.value } : item) })} />
        </label>
        <button type="button" className="min-h-11 text-sm text-white/60" onClick={() => onChange({ ...value, benefits: value.benefits?.filter((_, position) => position !== index) })}>Usuń korzyść</button>
      </div>)}
      <button type="button" className="min-h-11 rounded-lg bg-white/5 px-4 text-sm text-[#d3bb73]" onClick={() => onChange({ ...value, benefits: [...(value.benefits || []), { title: '', description: '' }] })}>Dodaj lokalną korzyść</button>
      {value.serviceArea ? <fieldset className="space-y-3 rounded-xl bg-black/15 p-4">
        <legend className="px-2 text-sm text-[#d3bb73]">Mapa i obszar obsługi</legend>
        <label className="block text-sm">Nagłówek
          <input className={fieldClass} value={value.serviceArea.heading} onChange={event => onChange({ ...value, serviceArea: { ...value.serviceArea!, heading: event.target.value } })} />
        </label>
        <label className="block text-sm">Opis dojazdu i obsługi regionu
          <textarea className={fieldClass} rows={5} value={value.serviceArea.description} onChange={event => onChange({ ...value, serviceArea: { ...value.serviceArea!, description: event.target.value } })} />
        </label>
        <label className="block text-sm">Miejscowości — jedna w wierszu
          <textarea className={fieldClass} rows={5} value={value.serviceArea.locations.join('\n')} onChange={event => onChange({ ...value, serviceArea: { ...value.serviceArea!, locations: event.target.value.split('\n') } })} />
        </label>
        <p className="text-xs leading-5 text-white/55">Mapa miasta oznacza obszar dojazdu. Jedyną oznaczoną bazą MAVINCI pozostaje biuro przy Towarowej 20B w Olsztynie.</p>
      </fieldset> : <button type="button" className="min-h-11 rounded-lg bg-white/5 px-4 text-sm text-[#d3bb73]" onClick={() => onChange({ ...value, serviceArea: { heading: '', description: '', locations: [] } })}>Dodaj własny opis obszaru obsługi</button>}
      <p className="text-xs leading-5 text-white/55">Obiekt jest opcjonalny. Wypełnij wszystkie trzy pola albo pozostaw je puste. Nie wpisuj obiektu jako klienta bez potwierdzonej realizacji.</p>
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
