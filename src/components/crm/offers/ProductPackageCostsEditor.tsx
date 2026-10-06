"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';
import { loadCompensationSettings } from '@/lib/personnel/compensationData';
import { packageStaffCostItems, packageCostLineNet, packageCostSettlementLabels, validPackageCompensationSnapshot, type PackageCostCompensationSnapshot, type PackageCostSettlement, packageCostNet, validatePackageCosts, type ProductSalesPackage, type ProductPackageCost } from '@/lib/CRM/Offers/productSalesPackages';

const money = (value: number) => value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function ProductPackageCostSummary({ value, salePriceNet = value.price_net }: { value: ProductSalesPackage; salePriceNet?: number }) {
  const total = packageCostNet(value);
  const unpricedStaff = (value.resources?.staff || []).filter(row => !row.is_optional && !row.compensation).length;
  if (total == null) return <p className="text-xs text-[#e5e4e2]/50">Koszty: {value.cost_items == null ? 'nieuzupełnione' : 'uzupełnij pozycje kosztowe'} · marża nieustalona</p>;
  const margin = Number.isFinite(salePriceNet) ? Math.round((salePriceNet - total) * 100) / 100 : null;
  return <div className="space-y-1 text-xs text-[#e5e4e2]/65">
    <p>Koszt spółki / 1 pakiet: <strong className="text-[#e5e4e2]">{money(total)} zł netto</strong></p>
    {unpricedStaff > 0 && <p className="text-[#d3bb73]">Obsada bez określonej stawki: {unpricedStaff}. Kalkulacja kosztów jest niepełna.</p>}
    {!unpricedStaff && margin != null && <p className={margin < 0 ? 'text-red-200' : ''}>Marża: {money(margin)} zł{salePriceNet > 0 ? ` (${(margin / salePriceNet * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%)` : ''}</p>}
  </div>;
}

export default function ProductPackageCostsEditor({ value, onChange, disabled, salePriceNet }: {
  value: ProductSalesPackage;
  onChange: (costs: ProductPackageCost[] | null) => void;
  disabled?: boolean;
  salePriceNet?: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProductPackageCost[] | null>(null);
  const [settings, setSettings] = useState<PackageCostCompensationSnapshot | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsRevision, setSettingsRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setSettings(null); setSettingsLoading(true); setSettingsError('');
    loadCompensationSettings().then(data => {
      const snapshot = { cit_rate: Number(data.cit_rate), dividend_rate: Number(data.dividend_rate), updated_at: data.updated_at };
      if (!validPackageCompensationSnapshot(snapshot)) throw new Error('Niepoprawne parametry CIT lub dywidendy.');
      if (live) setSettings(snapshot);
    }).catch(() => { if (live) setSettingsError('Nie udało się pobrać parametrów rozliczeń. Nie można wybrać nowego przeliczenia gotówki.'); })
      .finally(() => { if (live) setSettingsLoading(false); });
    return () => { live = false; };
  }, [open, settingsRevision]);
  const rows = draft || [];
  const error = validatePackageCosts(draft);
  const total = packageCostNet(value);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  const field = 'mt-1 w-full min-w-0 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]';
  const update = (id: string, patch: Partial<ProductPackageCost>) => setDraft(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return <>
    <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => {
      setDraft(value.cost_items == null ? null : structuredClone(value.cost_items));
      setOpen(true);
    }} className="flex w-full items-center justify-between gap-3 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-left text-sm text-[#d3bb73] hover:bg-[#d3bb73]/15 disabled:opacity-40">
      <span>Koszty realizacji pakietu</span>
      <span className="shrink-0 text-xs">{total == null ? 'Uzupełnij' : `${money(total)} zł netto`}</span>
    </button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClose={close}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
      className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0"><h3 id={titleId} className="text-base font-medium">Koszty realizacji pakietu</h3><p className="mt-1 break-words text-sm text-[#e5e4e2]/60">{value.name || 'Nowy pakiet'}</p></div>
          <button autoFocus type="button" aria-label="Zamknij koszty pakietu" onClick={close} className="rounded-lg p-1.5 hover:bg-white/5"><X className="h-5 w-5"/></button>
        </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 [scrollbar-gutter:stable]">
      <p className="text-xs leading-5 text-[#e5e4e2]/50">Wewnętrzna kalkulacja kosztu spółki na 1 pakiet. Koszty obsady ze stawek przy rolach są doliczane automatycznie. Tutaj dodaj pozostałe koszty, np. sprzęt, transport lub logistykę. Koszty nie zwiększają ceny sprzedaży i nie są drukowane w ofercie. Nie rezerwują pracowników ani sprzętu.</p>
      {packageStaffCostItems(value.resources).length > 0 && <div className="space-y-2 rounded-lg bg-[#d3bb73]/5 p-3"><h4 className="text-sm text-[#d3bb73]">Obsada — naliczana automatycznie</h4>{packageStaffCostItems(value.resources).map(cost => <p key={cost.id} className="flex justify-between gap-3 text-xs text-[#e5e4e2]/70"><span>{cost.name}</span><span>{packageCostLineNet(cost) == null ? 'uzupełnij parametry' : `${money(packageCostLineNet(cost)!)} zł`}</span></p>)}<p className="text-xs text-[#e5e4e2]/45">Te stawki zmienisz w „Sprzęt i obsada”. Usuń ręczny wpis tej samej obsady, jeśli został dodany wcześniej.</p></div>}
      {settingsLoading && <p className="text-xs text-[#e5e4e2]/50">Wczytywanie parametrów rozliczeń…</p>}
      {settingsError && <p role="alert" className="text-xs text-red-200">{settingsError} <button type="button" onClick={() => setSettingsRevision(current => current + 1)} className="underline">Spróbuj ponownie</button></p>}
      {rows.map(row => <div key={row.id} className="space-y-2 rounded-lg bg-black/10 p-3">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-[#e5e4e2]/60">Nazwa kosztu<input disabled={disabled} value={row.name} maxLength={120} placeholder="Np. obsługa krupierska" onChange={e => update(row.id, { name: e.target.value })} className={field}/></label>
          <button type="button" disabled={disabled} aria-label={`Usuń koszt ${row.name || 'bez nazwy'}`} onClick={() => setDraft(rows.filter(item => item.id !== row.id))} className="rounded-lg p-2 text-red-200/70 hover:bg-white/5 disabled:opacity-40"><Trash2 className="h-4 w-4"/></button>
        </div>
        <label className="block text-xs text-[#e5e4e2]/60">Sposób rozliczenia<select disabled={disabled} value={row.settlement_method || 'invoice'} onChange={e => {
          const method = e.target.value as PackageCostSettlement;
          update(row.id, { settlement_method: method, compensation_snapshot: method === 'cash_non_deductible' ? settings || row.compensation_snapshot : null });
        }} className={field}>{Object.entries(packageCostSettlementLabels).map(([method, label]) => <option key={method} value={method} disabled={method === 'cash_non_deductible' && !settings && !validPackageCompensationSnapshot(row.compensation_snapshot)}>{label}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[#e5e4e2]/60">Ilość<input disabled={disabled} type="number" min="0.01" max="100000" step="0.01" value={Number.isFinite(row.quantity) ? row.quantity : ''} onChange={e => update(row.id, { quantity: e.target.valueAsNumber })} className={field}/></label>
          <label className="text-xs text-[#e5e4e2]/60">{row.settlement_method && row.settlement_method !== 'invoice' ? 'Kwota do wypłaty / szt. (zł)' : 'Stawka netto (zł)'}<input disabled={disabled} type="number" min="0" max="99999999" step="0.01" value={Number.isFinite(row.unit_cost_net) ? row.unit_cost_net : ''} onChange={e => update(row.id, { unit_cost_net: e.target.valueAsNumber })} className={field}/></label>
        </div>
        {row.settlement_method === 'cash_non_deductible' && <div className="space-y-1 text-xs text-[#e5e4e2]/55">
          {validPackageCompensationSnapshot(row.compensation_snapshot) && <p>Zapisane parametry: CIT {row.compensation_snapshot.cit_rate}% · dywidenda {row.compensation_snapshot.dividend_rate}%.</p>}
          <p>Koszt finansowania = kwota wypłaty ÷ (1 − CIT) ÷ (1 − podatek od dywidendy).</p>
          {settings && (!validPackageCompensationSnapshot(row.compensation_snapshot) || settings.cit_rate !== row.compensation_snapshot.cit_rate || settings.dividend_rate !== row.compensation_snapshot.dividend_rate) && <button type="button" disabled={disabled} onClick={() => update(row.id, { compensation_snapshot: { ...settings } })} className="text-[#d3bb73] underline">Użyj aktualnych parametrów: CIT {settings.cit_rate}% · dywidenda {settings.dividend_rate}%</button>}
          <a href="/crm/settings/compensation" target="_blank" rel="noopener noreferrer" className="inline-block text-[#d3bb73] underline">Ustawienia rozliczeń</a>
        </div>}
        {Number.isFinite(row.quantity * row.unit_cost_net) && <div className="space-y-1 rounded-lg bg-[#d3bb73]/5 p-3 text-xs">
          <p className="text-[#e5e4e2]/60">{row.settlement_method && row.settlement_method !== 'invoice' ? 'Łącznie do wypłaty' : 'Wartość netto'}: {money(Math.round(row.quantity * row.unit_cost_net * 100) / 100)} zł</p>
          <p className="font-medium text-[#d3bb73]">Koszt dla spółki: {packageCostLineNet(row) == null ? 'uzupełnij parametry' : `${money(packageCostLineNet(row)!)} zł`}</p>
          {row.settlement_method === 'cash_non_deductible' && packageCostLineNet(row) != null && <p className="text-[#e5e4e2]/55">Różnica finansowania: {money(packageCostLineNet(row)! - Math.round(row.quantity * row.unit_cost_net * 100) / 100)} zł. Szacunek według zapisanych parametrów.</p>}
        </div>}
      </div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || rows.length >= 40} onClick={() => setDraft([...rows, { id: crypto.randomUUID(), name: '', quantity: 1, unit_cost_net: NaN }])} className="flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40"><Plus className="h-3.5 w-3.5"/>Dodaj koszt</button>
        {draft == null && <button type="button" disabled={disabled} onClick={() => setDraft([])} className="rounded-lg px-3 py-2 text-xs text-[#e5e4e2]/60">Potwierdź brak dodatkowych kosztów</button>}
        {draft?.length === 0 && <button type="button" disabled={disabled} onClick={() => setDraft(null)} className="rounded-lg px-3 py-2 text-xs text-[#e5e4e2]/60">Oznacz jako nieuzupełnione</button>}
      </div>
      {error && <p role="alert" className="text-xs text-red-200">{error}</p>}
    </div>
        <footer className="shrink-0 space-y-3 bg-black/10 p-5">
          <ProductPackageCostSummary value={{ ...value, cost_items: draft }} salePriceNet={salePriceNet}/>
          <p className="text-xs text-[#e5e4e2]/45">Po zastosowaniu kosztów zapisz pakiet lub pozycję oferty, aby zachować zmiany.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm">Anuluj</button>
            <button type="button" disabled={disabled || Boolean(error)} onClick={() => {
              if (disabled || validatePackageCosts(draft)) return;
              onChange(draft == null ? null : structuredClone(draft));
              close();
            }} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">Zastosuj koszty</button>
          </div>
        </footer>
      </div>
    </dialog>, document.body)}
  </>;
}
