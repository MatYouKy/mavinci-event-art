'use client';

import { Plus, Trash2 } from 'lucide-react';
import { calculateModular } from '@/lib/CRM/Offers/modularProduct';
import { selectSellerLedDimensions, type SellerLedSnapshot } from '@/lib/seller/ledPackage';
import { sellerMoney } from '@/lib/seller/portal';

const field = 'mt-1.5 h-11 w-full rounded-lg border border-white/10 bg-black/15 px-3 text-sm outline-none focus:border-[#d3bb73]/30';
export default function SellerLedPackageConfigurator({ value, onChange, disabled }: {
  value: SellerLedSnapshot; onChange: (next: SellerLedSnapshot) => void; disabled?: boolean;
}) {
  const sections = value.selection.led_sections || [];
  const update = (next: typeof sections) => onChange(selectSellerLedDimensions(value, { ...value, selection: { ...value.selection, led_sections: next } }));
  const result = calculateModular(value);
  const rate = value.catalog.components.find(component => component.basis === 'area')?.rate;
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl bg-white/[0.035] p-4 disabled:opacity-60">
    <legend className="px-1 text-sm font-medium">Ekran LED — wymiary i pełna obsługa</legend>
    <p className="text-sm leading-6 text-white/65">Podaj szerokość i wysokość obrazu. Konstrukcja, procesor i realizator są już w cenie pakietowej — nie musisz dobierać urządzeń.</p>
    {sections.map((section, index) => {
      const valid = Number.isInteger(section.columns) && Number.isInteger(section.rows) && section.columns > 0 && section.rows > 0 && section.columns <= 200 && section.rows <= 200;
      return <div key={section.id} className="space-y-3 rounded-lg bg-black/10 p-3">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{section.name}</h3>{sections.length > 1 && <button type="button" aria-label={'Usuń ' + section.name} onClick={() => update(sections.filter((_, position) => position !== index))} className="rounded-lg p-2 text-white/45 hover:bg-white/5 hover:text-rose-200"><Trash2 className="h-4 w-4" /></button>}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-white/60">Szerokość obrazu (m)<input type="number" min="0.5" max="100" step="0.5" value={Number.isFinite(section.columns) ? section.columns / 2 : ''} onChange={event => update(sections.map((item, position) => position === index ? { ...item, columns: event.target.valueAsNumber * 2 } : item))} className={field} /></label>
          <label className="text-xs text-white/60">Wysokość obrazu (m)<input type="number" min="0.5" max="100" step="0.5" value={Number.isFinite(section.rows) ? section.rows / 2 : ''} onChange={event => update(sections.map((item, position) => position === index ? { ...item, rows: event.target.valueAsNumber * 2 } : item))} className={field} /></label>
        </div>
        {valid ? <div className="flex flex-col items-center gap-2 rounded-lg bg-black/15 p-4">
          <div aria-hidden="true" className="flex max-h-40 w-full max-w-sm items-center justify-center rounded bg-[#d3bb73]/15 text-sm text-[#d3bb73]" style={{ aspectRatio: Math.max(.5, Math.min(4, section.columns / section.rows)) }}>
            {section.columns / 2} × {section.rows / 2} m
          </div>
          <p className="text-xs text-[#d3bb73]">Powierzchnia: {section.columns * section.rows / 4} m²</p>
        </div> : <p role="alert" className="text-xs text-amber-100">Uzupełnij oba wymiary od 0,5 do 100 m, co 0,5 m. Starszą konfigurację bez wymiarów trzeba uzupełnić.</p>}
      </div>;
    })}
    <p className="text-xs text-white/45">Wymiary obrazu wybierasz co 0,5 m. Wysokość zawieszenia i dobór konstrukcji ustali opiekun w CRM.</p>
    <button type="button" disabled={sections.length >= 30} className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40" onClick={() => update([...sections, { id: crypto.randomUUID(), name: 'Ekran ' + (sections.length + 1), columns: 6, rows: 4 }])}><Plus className="h-4 w-4" />Dodaj kolejny ekran</button>
    <div className="space-y-2 rounded-lg bg-[#d3bb73]/10 p-4">
      <p className="text-sm">{rate == null ? 'Stawka pakietowa: do wyceny przez opiekuna' : `Twój pakiet: ${sellerMoney(rate)} netto / m² / dzień`}</p>
      <p className="text-xs text-white/60">Obejmuje ekran, konstrukcję, procesor i realizatora ekranu. Nie doliczaj tych usług drugi raz. Liczbę dni i zestawów ustawisz w pozycji oferty.</p>
      {!result.error && <p className="font-medium text-[#d3bb73]">{value.selection.area} m² × {sellerMoney(rate)} = {sellerMoney(result.total)} netto / dzień</p>}
    </div>
  </fieldset>;
}
