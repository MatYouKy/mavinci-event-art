'use client';
import { calculateStage, stageDefaults, type StageCatalog, type ModularSnapshot } from '@/lib/CRM/Offers/modularProduct';
const input = 'mt-1 w-full min-w-0 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
function NumberField({ label, value, onChange, min = 0, step = '0.01', optional = false }: { label: string; value: number | null; onChange: (n: number | null) => void; min?: number; step?: string; optional?: boolean }) {
  return <label className="block min-w-0 text-sm">{label}<input type="number" className={input} min={min} step={step} value={value != null && Number.isFinite(value) ? value : ''} placeholder={optional ? 'Do wyceny' : 'Uzupełnij'} onChange={e => onChange(e.target.value === '' ? optional ? null : NaN : Number(e.target.value))} /></label>;
}
export function StageRatesEditor({ value, onChange }: { value: StageCatalog; onChange: (v: StageCatalog) => void }) {
  const patch = (v: Partial<StageCatalog>) => onChange({ ...value, ...v });
  return <div className="space-y-4">
    <p className="text-xs opacity-65">Stawki sprzedaży netto za jeden dzień. Puste pole oznacza brak wyceny; 0 oznacza element wliczony w cenę. Blat ma 1 × 2 m.</p>
    <div className="grid grid-cols-2 gap-3">
      <NumberField label="Blat 1 × 2 m (zł/szt.)" value={value.deck_rate} onChange={n => patch({ deck_rate: n! })} />
      <NumberField label="Nogi na jeden blat" value={value.legs_per_deck} min={1} step="1" onChange={n => patch({ legs_per_deck: n! })} />
      <NumberField label="Blendy / mocowanie (zł / komplet na bok)" optional value={value.fascia_rate} onChange={n => patch({ fascia_rate: n })} />
      <NumberField label="Wysłona (zł)" optional value={value.skirt_rate} onChange={n => patch({ skirt_rate: n })} />
      <label className="text-sm">Naliczanie wysłony<select className={input} value={value.skirt_basis} onChange={e => patch({ skirt_basis: e.target.value as 'set' | 'metre' })}><option value="set">Za cały komplet</option><option value="metre">Za metr bieżący</option></select></label>
      <NumberField label="Dywan (zł/m²)" optional value={value.carpet_rate} onChange={n => patch({ carpet_rate: n })} />
      <NumberField label="Schody (zł/kpl.)" optional value={value.stairs_rate} onChange={n => patch({ stairs_rate: n })} />
      <NumberField label="Mnożnik ceny zestawu" min={0.01} value={value.multiplier} onChange={n => patch({ multiplier: n! })} />
    </div>
    <p className="text-sm">Wysokości i cena jednej nogi</p>
    {value.heights.map((h, i) => <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
      <NumberField label="Wysokość (cm)" value={h.cm} min={1} step="1" onChange={n => patch({ heights: value.heights.map((r, j) => j === i ? { ...r, cm: n! } : r) })} />
      <NumberField label="Noga (zł/szt.)" optional value={h.leg_rate} onChange={n => patch({ heights: value.heights.map((r, j) => j === i ? { ...r, leg_rate: n } : r) })} />
      <button type="button" disabled={value.heights.length <= 1} className="rounded-lg px-2 py-2 text-sm text-red-200 disabled:opacity-40" onClick={() => patch({ heights: value.heights.filter((_, j) => j !== i) })}>Usuń</button>
    </div>)}
    <button type="button" disabled={value.heights.length >= 20} className="text-sm text-[#d3bb73]" onClick={() => patch({ heights: [...value.heights, { cm: Math.max(...value.heights.map(h => h.cm)) + 10, leg_rate: null }] })}>+ Dodaj wysokość</button>
  </div>;
}
export function ProductConfigurationEditor({ value, onChange }: { value: StageCatalog | null; onChange: (v: StageCatalog | null) => void }) {
  return <div className="space-y-4"><label className="text-sm">Sposób wyceny<select className={input} value={value ? 'stage' : 'standard'} onChange={e => onChange(e.target.value === 'stage' ? stageDefaults() : null)}><option value="standard">Standardowy produkt / pakiety</option><option value="stage">Produkt konfigurowalny — podest</option></select></label>
    {value && <><StageRatesEditor value={value} onChange={onChange} /><p className="text-xs opacity-65">Nowe oferty otrzymają kopię tych stawek. W tym trybie cenę określa konfigurator podestu; warianty i pakiety katalogowe nie są do niej doliczane.</p></>}
  </div>;
}
export default function StageConfigurator({ value, onChange, disabled = false, seller = false }: { value: ModularSnapshot; onChange: (v: ModularSnapshot) => void; disabled?: boolean; seller?: boolean }) {
  const p = value.selection, result = calculateStage(value);
  const patch = (v: Partial<typeof p>) => onChange({ ...value, selection: { ...p, ...v } });
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-xl bg-white/[0.035] p-4 disabled:opacity-60">
    <h3 className="text-base font-medium">Konfiguracja podestu</h3>
    <div className="flex flex-wrap gap-2">{[[4,2],[6,3],[8,4]].map(([w,d]) => <button key={w} type="button" className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]" onClick={() => patch({ width:w,depth:d })}>{w} × {d} m</button>)}</div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <NumberField label="Szerokość frontu (m)" value={p.width} min={1} step="1" onChange={n => patch({ width:n! })} />
      <NumberField label="Głębokość (m)" value={p.depth} min={1} step="1" onChange={n => patch({ depth:n! })} />
      <NumberField label="Wysokość podestu (cm)" value={p.height} min={1} step="1" onChange={n => patch({ height:n! })} />
      <label className="text-sm">Wysłona<select className={input} value={p.skirt} onChange={e => patch({ skirt:e.target.value as typeof p.skirt })}><option value="none">Bez wysłony</option><option value="front_sides">Front i dwa boki</option><option value="all">Cztery strony</option></select></label>
      <NumberField label="Schody — liczba kompletów" value={p.stairs} step="1" onChange={n => patch({ stairs:n! })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.carpet} onChange={e => patch({ carpet:e.target.checked })} />Pokrycie dywanem</label>
    </div>
    <div className="space-y-2"><p className="text-xs opacity-65">Wpisz wysokość podestu — nogi i ich liczbę dobierzemy z zapisanych wariantów. Dostępne wysokości:</p><div className="flex flex-wrap gap-2">{value.catalog.heights.map((h,i) => <button type="button" key={i} onClick={() => patch({ height:h.cm })} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]">{h.cm} cm</button>)}</div>{!value.catalog.heights.some(h => h.cm === p.height) && <p role="alert" className="text-sm text-amber-200">Brak nóg dla podanej wysokości. Wybierz jedną z dostępnych powyżej.</p>}</div>
    <p className="text-xs opacity-65">Rozmiar dotyczy jednego podestu. Ilość zestawów i liczba dni w ofercie mnożą całą jego cenę. Układ modułów, wysokość i wyposażenie dobiera sprzedawca do wymagań realizacji.</p>
    {!seller && <details><summary className="cursor-pointer text-sm text-[#d3bb73]">Stawki i mnożnik dla tej oferty</summary><div className="mt-3"><StageRatesEditor value={value.catalog} onChange={catalog => onChange({ ...value,catalog })} /></div></details>}
    {!seller && p.accessories.map((a,i) => <div key={a.id} className="grid grid-cols-2 gap-2 rounded-lg bg-black/10 p-3">
      <label className="text-sm">Akcesorium<input className={input} maxLength={100} value={a.name} onChange={e => patch({ accessories:p.accessories.map((x,j) => j===i ? {...x,name:e.target.value}:x) })} /></label>
      <label className="text-sm">Nazwa angielska (PDF EN)<input className={input} maxLength={100} value={a.name_en} onChange={e => patch({ accessories:p.accessories.map((x,j) => j===i ? {...x,name_en:e.target.value}:x) })} /></label>
      <NumberField label="Ilość sztuk" min={1} step="1" value={a.quantity} onChange={n => patch({ accessories:p.accessories.map((x,j) => j===i ? {...x,quantity:n!}:x) })} />
      <NumberField label="Cena netto za sztukę" optional value={a.rate} onChange={n => patch({ accessories:p.accessories.map((x,j) => j===i ? {...x,rate:n}:x) })} />
      <button type="button" className="text-left text-sm text-red-200" onClick={() => patch({ accessories:p.accessories.filter((_,j) => j!==i) })}>Usuń akcesorium</button>
    </div>)}
    {!seller && <button type="button" disabled={p.accessories.length >= 8} className="text-sm text-[#d3bb73]" onClick={() => patch({ accessories:[...p.accessories,{id:crypto.randomUUID(),name:'',name_en:'',quantity:1,rate:null}] })}>+ Dodaj akcesorium</button>}
    {result.error && <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{result.error}</p>}
    {result.lines.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2">Składniki zestawu</th><th>Ilość</th><th>Stawka netto</th><th className="text-right">Razem netto</th></tr></thead><tbody>{result.lines.map(l => <tr key={l.key}><td className="py-2 pr-2">{l.name}</td><td>{l.quantity} {l.unit}</td><td>{l.rate === null ? 'Do wyceny' : l.rate.toFixed(2)}</td><td className="text-right">{l.rate === null ? '—' : l.total.toFixed(2)}</td></tr>)}</tbody></table></div>}
    <p className="text-right font-medium text-[#d3bb73]">{result.error ? 'Uzupełnij konfigurację, aby ustalić cenę' : `${result.area} m² · ${result.decks} blatów · mnożnik ${value.catalog.multiplier} · ${result.total.toFixed(2)} zł netto / zestaw / dzień`}</p>
    <p className="text-xs opacity-65">W PDF klient zobaczy zakres i cenę zestawu. Stawki części oraz mnożnik pozostają w kalkulacji. Montaż i transport dodaj oddzielnie, jeśli nie są objęte inną pozycją.</p>
  </fieldset>;
}
