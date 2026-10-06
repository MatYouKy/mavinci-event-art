'use client';
import { Plus, Trash2 } from 'lucide-react';
import { addonLabels, addonQuantity, addonsTotal, type ProductAddon, type AddonKind } from '@/lib/CRM/Offers/offerAddons';

export default function ProductAddonsEditor({ value, onChange, disabled = false, catalog = false, hideHeading = false, singleItem = false }: {
  value: ProductAddon[]; onChange: (value: ProductAddon[]) => void; disabled?: boolean; catalog?: boolean; hideHeading?: boolean; singleItem?: boolean;
}) {
  const update = (id: string, patch: Partial<ProductAddon>) => onChange(value.map(a => a.id === id ? { ...a, ...patch } : a));
  const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 p-2 text-sm text-inherit focus:outline-none focus:border-[#d3bb73]/40';
  const number = (a: ProductAddon, key: 'quantity' | 'included_quantity' | 'unit_price', label: string) => <label className="text-xs text-[#e5e4e2]/70">{label}<input type="number" min="0" max={key === 'unit_price' ? 99999999 : 100000} step="0.01" value={key === 'unit_price' && a.price_on_request && a[key] === 0 ? '' : Number.isFinite(a[key]) ? a[key] : ''} placeholder={key === 'unit_price' && a.price_on_request ? 'Do indywidualnej wyceny' : undefined} onChange={e => update(a.id, { [key]: e.target.value === '' ? (key === 'unit_price' && a.price_on_request ? 0 : NaN) : Number(e.target.value) })} className={field} /></label>;
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl bg-[#d3bb73]/5 p-4 disabled:opacity-60">
    <legend className={hideHeading ? 'sr-only' : 'px-1 text-sm font-medium text-[#d3bb73]'}>{catalog ? 'Dodatki i limity pakietu' : 'Skonfiguruj zakres i dodatki'}</legend>
    <p className="text-xs leading-relaxed text-[#e5e4e2]/60">{catalog ? 'Ustaw domyślne limity i stawki. Nowa oferta otrzyma własną kopię tych ustawień.' : 'Ustawienia dotyczą tylko tej oferty. Ilości dodatków odnoszą się do jednego pakietu; liczba pakietów mnoży cały zakres.'} Dodatki korzystają ze stawki VAT oferty.</p>
    {value.map(a => <div key={a.id} className="space-y-3 rounded-lg bg-black/15 p-3">
      <div className="flex items-end gap-2"><label className="flex-1 text-xs text-[#e5e4e2]/70">Nazwa dodatku<input value={a.name} maxLength={120} onChange={e => update(a.id, { name: e.target.value })} className={field} /></label>{!singleItem && <button type="button" aria-label={`Usuń dodatek ${a.name}`} onClick={() => onChange(value.filter(x => x.id !== a.id))} className="rounded-lg p-2 text-red-300 hover:bg-red-400/10"><Trash2 size={17} /></button>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-[#e5e4e2]/70">Sposób naliczania<select value={a.kind} onChange={e => update(a.id, { kind: e.target.value as AddonKind, enabled: false })} className={field}>{Object.entries(addonLabels).map(([key, label]) => <option key={key} value={key} className="bg-[#1c1f33]">{label}</option>)}</select></label><label className="text-xs text-[#e5e4e2]/70">Jednostka<input value={a.unit} maxLength={20} onChange={e => update(a.id, { unit: e.target.value })} className={field} /></label>
        {a.kind === 'over_limit' && number(a, 'included_quantity', 'W cenie pakietu')}
        {a.kind !== 'optional' && number(a, 'quantity', a.kind === 'over_limit' ? 'Łączna potrzebna ilość' : 'Ilość')}
        {number(a, 'unit_price', a.kind === 'optional' ? 'Cena dodatku netto (zł)' : 'Cena za dodatkową jednostkę netto (zł)')}
        {a.kind === 'optional' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.enabled} onChange={e => update(a.id, { enabled: e.target.checked })} className="accent-[#d3bb73]" />{catalog ? 'Domyślnie zaznaczony' : 'Dodaj do oferty'}</label>}
      </div>
      {catalog && <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/70"><input type="checkbox" checked={Boolean(a.price_on_request)} onChange={e => update(a.id, { price_on_request: e.target.checked })} className="accent-[#d3bb73]" />Cena ustalana indywidualnie — wymagana po wybraniu dodatku</label>}
      {a.price_on_request && a.unit_price <= 0 && <p role={addonQuantity(a) > 0 ? 'alert' : undefined} className="text-xs text-[#d3bb73]">{addonQuantity(a) > 0 ? 'Wpisz uzgodnioną cenę, aby zapisać ofertę. Ta opcja nie jest bezpłatna.' : 'Opcja do indywidualnej wyceny. Cenę uzupełnisz po jej wybraniu.'}</p>}
      <label className="block text-xs text-[#e5e4e2]/70">Zakres / warunki widoczne w kalkulacji<textarea maxLength={500} rows={2} value={a.description} onChange={e => update(a.id, { description: e.target.value })} className={field} /></label>
      {!(a.price_on_request && a.unit_price <= 0) && <p className="text-xs text-[#d3bb73]">{a.kind === 'over_limit' ? `W pakiecie: ${a.included_quantity}. Płatne ponad limit: ` : 'Płatna ilość: '}{addonQuantity(a)} × {a.unit_price.toLocaleString('pl-PL')} zł = {(Math.round(addonQuantity(a) * a.unit_price * 100) / 100).toLocaleString('pl-PL')} zł netto</p>}
    </div>)}
    {!singleItem && <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={value.length >= 40} onClick={() => onChange([...value, { id: crypto.randomUUID(), name: '', description: '', kind: 'quantity', unit: 'szt.', included_quantity: 0, quantity: 0, unit_price: 0, enabled: false }])} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Plus size={16} />{catalog ? 'Dodaj regułę' : 'Dodaj indywidualny dodatek'}</button><span className="text-sm text-[#d3bb73]">Dodatki: {addonsTotal(value).toLocaleString('pl-PL')} zł netto / pakiet</span></div>}
    {value.length > 0 && <p className="text-xs text-[#e5e4e2]/60">PDF pokaże pakiet bazowy i wybrane dodatki z ceną jednostkową. Układ kompaktowy będzie niedostępny.</p>}
  </fieldset>;
}
