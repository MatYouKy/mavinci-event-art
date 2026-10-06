'use client';

import { useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import OfferLogisticsRoute from './OfferLogisticsRoute';
import {
  emptyLogisticsEstimate, logisticsEstimateKinds, logisticsEstimateRowCost,
  newLogisticsEstimateRow, summarizeLogisticsEstimate,
  type LogisticsEstimate, type LogisticsEstimateRow, type LogisticsEstimateKind,
} from '@/lib/CRM/Offers/logisticsEstimate';

const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]';
const button = 'rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40';
const money = (n: number) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberValue = (value: string) => value === '' ? null : Number(value);

export default function OfferLogisticsEstimateEditor({ offerId, value, cost, onChange, onBusyChange, readOnly = false, disabled = false }: {
  offerId: string; onBusyChange?: (busy: boolean) => void;
  value: LogisticsEstimate | null; cost: string;
  onChange: (estimate: LogisticsEstimate | null, cost: string) => void;
  readOnly?: boolean; disabled?: boolean;
}) {
  const busyRows = useRef(new Set<string>());
  const summary = value ? summarizeLogisticsEstimate(value) : null;
  const update = (next: LogisticsEstimate) => {
    const result = summarizeLogisticsEstimate(next);
    onChange(next, result.total == null ? '' : String(result.total));
  };
  const patchRow = (id: string, patch: Partial<LogisticsEstimateRow>) => {
    if (value) update({ ...value, rows: value.rows.map(row => row.id === id ? { ...row, ...patch } : row) });
  };
  const numeric = (row: LogisticsEstimateRow, key: 'quantity' | 'units' | 'rate' | 'included_hours' | 'consumption', label: string, max: number, step = '0.01') => <label className="text-xs text-[#e5e4e2]/60">{label}<input type="number" min={key === 'quantity' ? 1 : 0} max={max} step={step} disabled={disabled} value={row[key] ?? ''} onChange={event => patchRow(row.id, { [key]: numberValue(event.target.value) })} className={field} placeholder="Uzupełnij" /></label>;

  return <div className="space-y-4">
    {!readOnly && <div className="flex flex-wrap gap-2" aria-label="Sposób szacowania kosztu">
      <button type="button" disabled={disabled} aria-pressed={Boolean(value)} onClick={() => { if (!value) update(emptyLogisticsEstimate()); }} className={`${button} ${value ? 'bg-[#d3bb73]/25' : ''}`}>Kalkulator szacunkowy</button>
      <button type="button" disabled={disabled} aria-pressed={!value} onClick={() => onChange(null, cost)} className={`${button} ${!value ? 'bg-[#d3bb73]/25' : ''}`}>Kwota ręczna</button>
    </div>}
    {value ? <>
      <p className="text-xs text-[#e5e4e2]/60">Szacunek na potrzeby oferty. Wpisuj koszty dla firmy. Dystans i czas uwzględniają wybrany zakres przejazdu; kalkulator nie ustala wynagrodzeń ani diet pracowniczych.</p>
      <div className="space-y-3">{value.rows.map(row => {
        const rowCost = logisticsEstimateRowCost(row);
        const quantityLabel = row.kind === 'fuel' ? 'Liczba aut' : row.kind === 'travel' || row.kind === 'meals' ? 'Liczba osób' : row.kind === 'accommodation' ? 'Liczba pokoi' : 'Ilość';
        const unitsLabel = row.kind === 'fuel' ? 'Dystans / auto (km)' : row.kind === 'travel' ? 'Podróż / osobę (h)' : row.kind === 'meals' ? 'Liczba dni' : row.kind === 'accommodation' ? 'Liczba nocy' : 'Mnożnik';
        const rateLabel = row.kind === 'fuel' ? 'Cena paliwa (zł/l)' : row.kind === 'travel' ? 'Koszt dla firmy (zł/h/os.)' : row.kind === 'meals' ? 'Budżet netto (zł/os./dzień)' : row.kind === 'accommodation' ? 'Koszt netto (zł/pokój/noc)' : 'Koszt jednostkowy netto (zł)';
        return <article key={row.id} className="space-y-3 rounded-xl bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-[#d3bb73]">{logisticsEstimateKinds[row.kind]}</span><span className="ml-auto text-sm text-[#d3bb73]">{rowCost == null ? 'Do uzupełnienia' : `${money(rowCost)} zł`}</span>{!readOnly && <button type="button" disabled={disabled} aria-label={`Usuń koszt: ${row.name}`} onClick={() => update({ ...value, rows: value.rows.filter(item => item.id !== row.id) })} className="rounded p-1 text-red-200"><Trash2 className="h-4 w-4" /></button>}</div>
          {readOnly ? <><p className="text-sm">{row.name}</p><p className="text-xs text-[#e5e4e2]/55">{quantityLabel}: {row.quantity} · {unitsLabel}: {row.units} · {rateLabel}: {row.rate}{row.kind === 'fuel' ? ` · Spalanie: ${row.consumption} l/100 km` : ''}{row.kind === 'travel' ? ` · Godziny już w pakiecie: ${row.included_hours} h/os.` : ''}</p></> : <>
            <label className="block text-xs text-[#e5e4e2]/60">Nazwa / założenie<input maxLength={120} value={row.name} disabled={disabled} onChange={event => patchRow(row.id, { name: event.target.value })} className={field} /></label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {numeric(row, 'quantity', quantityLabel, 10000, '1')}
              {row.kind !== 'fuel' && numeric(row, 'units', unitsLabel, 100000)}
              {row.kind !== 'fuel' && numeric(row, 'rate', rateLabel, 99999999.99)}

              {row.kind === 'travel' && numeric(row, 'included_hours', 'Godziny już w cenie pakietu / osobę', 100000)}
            </div>
            {row.kind === 'fuel' && <OfferLogisticsRoute offerId={offerId} value={row.route || value.route} distance={row.units} disabled={disabled}
              fuel={row.fuel_estimate || (row.rate != null || row.consumption != null ? { fuel_type: 'diesel', price: row.rate, consumption: row.consumption, price_source: 'manual', quote: null } : undefined)}
              onBusyChange={busy => { if (busy) busyRows.current.add(row.id); else busyRows.current.delete(row.id); onBusyChange?.(busyRows.current.size > 0); }}
              onApply={(route, fuel, distance) => {
                const patch: Partial<LogisticsEstimateRow> = { route };
                if (distance != null) patch.units = distance;
                if (fuel) { patch.fuel_estimate = fuel; patch.rate = fuel.price; patch.consumption = fuel.consumption; }
                patchRow(row.id, patch);
              }} />}
            {row.kind === 'fuel' && <p className="text-xs text-[#e5e4e2]/45">Koszt kalkulatora dotyczy jednego auta. Powyżej mnożymy go przez liczbę aut. Parking, opłaty i wynajem dodaj jako inny koszt.</p>}
            {row.kind === 'travel' && <p className="text-xs text-[#e5e4e2]/45">Koszt = osoby × (czas podróży − godziny już w pakiecie) × stawka. Kierowców i pasażerów możesz dodać oddzielnie.</p>}
            {row.kind === 'meals' && <p className="text-xs text-[#e5e4e2]/45">Uwzględnij tylko posiłki i napoje, które finansujesz. W założeniach zapisz wyżywienie zapewniane przez klienta.</p>}
          </>}
        </article>;
      })}</div>
      {!readOnly && <><div className="flex flex-wrap gap-2">{(Object.keys(logisticsEstimateKinds) as LogisticsEstimateKind[]).map(kind => <button key={kind} type="button" disabled={disabled || value.rows.length >= 30} onClick={() => update({ ...value, rows: [...value.rows, { ...newLogisticsEstimateRow(kind), ...(kind === 'fuel' && value.route ? { units: value.route.distance_km } : {}) }] })} className={button}><Plus className="mr-1 inline h-3.5 w-3.5" />{logisticsEstimateKinds[kind]}</button>)}</div>
        <label className="block text-xs text-[#e5e4e2]/60">Rezerwa na nieprzewidziane wydatki (%)<input type="number" min={0} max={100} step="0.01" value={value.reserve_percent ?? ''} disabled={disabled} onChange={event => update({ ...value, reserve_percent: numberValue(event.target.value) })} className={field} /></label>
        <label className="block text-xs text-[#e5e4e2]/60">Założenia szacunku<textarea rows={2} maxLength={2000} value={value.notes} disabled={disabled} onChange={event => update({ ...value, notes: event.target.value })} placeholder="Np. 2 osoby, nocleg bez śniadania, obiad zapewnia klient…" className={field} /></label>
      </>}
      {readOnly && value.notes && <p className="whitespace-pre-wrap text-xs text-[#e5e4e2]/60">{value.notes}</p>}
      <div className="rounded-xl bg-[#d3bb73]/10 p-4">
        {summary?.total != null ? <><p className="text-xs text-[#e5e4e2]/60">Koszty: {money(summary.subtotal)} zł · Rezerwa ({value.reserve_percent}%): {money(summary.reserve)} zł</p><p className="mt-2 text-lg text-[#d3bb73]">Szacunkowy koszt dla firmy: {money(summary.total)} zł</p></> : <p className="text-sm text-[#d3bb73]">{summary?.error}</p>}
      </div>
    </> : readOnly ? <p className="text-sm">Koszt dla firmy: {cost === '' ? 'Nie oszacowano' : `${money(Number(cost))} zł netto`}</p> : <label className="block text-sm">Wewnętrzny koszt logistyki netto (zł) — wymagany<input type="number" min="0" step="0.01" value={cost} disabled={disabled} onChange={event => onChange(null, event.target.value)} placeholder="Wpisz koszt lub 0" className={field} /></label>}
    <p className="text-xs text-[#e5e4e2]/50">Założenia i koszt są wewnętrzne. Zapisz logistykę, aby zachować zmiany. Osobna dopłata klienta jest ustawiana poniżej.</p>
  </div>;
}
