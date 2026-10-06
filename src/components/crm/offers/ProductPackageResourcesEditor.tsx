"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Users, Wrench, X, ImageOff, Pencil } from 'lucide-react';
import { useEquipmentCatalog, type EquipmentCatalogItem } from '@/app/(crm)/crm/equipment/hooks/useEquipmentCatalog';
import { validPackageCompensationSnapshot, type PackageCostCompensationSnapshot, validatePackageResources, type ProductPackageEquipment, type ProductPackageResources, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
import PackageStaffCompensationFields from './PackageStaffCompensationFields';
import { loadCompensationSettings } from '@/lib/personnel/compensationData';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import Popover from '@/components/UI/Tooltip';
import { supabase } from '@/lib/supabase/browser';
import { systemLabel } from '@/lib/ui/systemLabels';

function EquipmentThumbnail({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span aria-label={`Brak zdjęcia: ${name}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-black/15 text-[#e5e4e2]/30"><ImageOff className="h-4 w-4"/></span>;
  return <Popover portalWithinDialog openOn="auto" maxWidth={280} ariaLabel={`Podgląd zdjęcia: ${name}`} triggerClassName="shrink-0 cursor-zoom-in rounded-md" className="!border-white/10 !p-2"
    trigger={<img src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-10 w-10 rounded-md bg-black/15 object-cover"/>}
    content={<div className="w-[min(240px,calc(100vw_-_48px))]"><img src={src} alt={name} decoding="async" className="h-[min(220px,40vh)] w-full rounded-lg bg-black/15 object-contain"/><p className="mt-2 break-words text-xs text-[#e5e4e2]/75">{name}</p></div>}/>;
}

const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]';
function ResourceForm({ initial, readOnly, onApply, onClose }: { initial: ProductPackageResources | null | undefined; readOnly?: boolean; onApply: (value: ProductPackageResources) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<ProductPackageResources>(() => structuredClone(initial || { equipment: [], staff: [] }));
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'equipment' | 'staff'>('equipment');
  const [choosing, setChoosing] = useState(false);
  const [compensationSettings, setCompensationSettings] = useState<PackageCostCompensationSnapshot | null>(null);
  const [compensationLoading, setCompensationLoading] = useState(false);
  const [compensationError, setCompensationError] = useState('');
  const [compensationRetry, setCompensationRetry] = useState(0);
  useEffect(() => {
    if (tab !== 'staff' || readOnly) return;
    let live = true;
    setCompensationLoading(true); setCompensationError('');
    loadCompensationSettings().then(settings => {
      const snapshot = { cit_rate: Number(settings.cit_rate), dividend_rate: Number(settings.dividend_rate), updated_at: settings.updated_at };
      if (!validPackageCompensationSnapshot(snapshot)) throw new Error('Niepoprawne parametry');
      if (!live) return;
      setCompensationSettings(snapshot);
      setDraft(current => ({ ...current, staff: current.staff.map(row => row.compensation?.settlement_method === 'cash_non_deductible' && !validPackageCompensationSnapshot(row.compensation.compensation_snapshot) ? { ...row, compensation: { ...row.compensation, compensation_snapshot: snapshot } } : row) }));
    }).catch(() => { if (live) setCompensationError('Nie udało się pobrać parametrów CIT i dywidendy.'); })
      .finally(() => { if (live) setCompensationLoading(false); });
    return () => { live = false; };
  }, [tab, readOnly, compensationRetry]);
  const [equipmentEdit, setEquipmentEdit] = useState<ProductPackageEquipment | null>(null);
  const [equipmentImages, setEquipmentImages] = useState<Record<string, string | null>>({});
  const initialEquipmentKey = (initial?.equipment || []).map(row => `${row.equipment_kit_id ? 'kit' : 'item'}:${row.equipment_kit_id || row.equipment_item_id}`).sort().join('|');
  useEffect(() => {
    let stale = false;
    const entries = initialEquipmentKey ? initialEquipmentKey.split('|').map(key => key.split(':')) : [];
    const itemIds = entries.filter(([type]) => type === 'item').map(([, id]) => id);
    const kitIds = entries.filter(([type]) => type === 'kit').map(([, id]) => id);
    // Load existing selection thumbnails in two batches, never one request per row.
    void Promise.all([
      itemIds.length ? supabase.from('equipment_items').select('id,thumbnail_url').in('id', itemIds) : Promise.resolve({ data: [], error: null }),
      kitIds.length ? supabase.from('equipment_kits').select('id,thumbnail_url').in('id', kitIds) : Promise.resolve({ data: [], error: null }),
    ]).then(([equipment, kits]) => {
      if (stale) return;
      const images = Object.fromEntries([
        ...(equipment.data || []).map(item => [`item:${item.id}`, item.thumbnail_url]),
        ...(kits.data || []).map(item => [`kit:${item.id}`, item.thumbnail_url]),
      ]);
      setEquipmentImages(current => ({ ...current, ...images }));
    }).catch(() => { /* A missing thumbnail does not block editing resources. */ });
    return () => { stale = true; };
  }, [initialEquipmentKey]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const { items, isLoading, isFetching, isError, hasMore, loadMore, refetch } = useEquipmentCatalog({ q: search, limit: 24, activeOnly: true, enabled: !readOnly && choosing && tab === 'equipment' });
  const error = validatePackageResources(draft);
  const selectedEquipmentKeys = new Set(draft.equipment.map(row => `${row.equipment_kit_id ? 'kit' : 'item'}:${row.equipment_kit_id || row.equipment_item_id}`));
  const availableEquipment = items.filter(item => !item.is_cable && !selectedEquipmentKeys.has(`${item.is_kit ? 'kit' : 'item'}:${item.id}`));
  const equipmentEditError = equipmentEdit ? validatePackageResources({ equipment: [equipmentEdit], staff: [] }) : null;
  const removeEquipment = (id: string) => {
    setDraft(current => ({ ...current, equipment: current.equipment.filter(row => row.id !== id) }));
    setEquipmentEdit(current => current?.id === id ? null : current);
  };
  const addEquipment = (item: EquipmentCatalogItem) => {
    if (draft.equipment.length >= 100 || selectedEquipmentKeys.has(`${item.is_kit ? 'kit' : 'item'}:${item.id}`)) return;
    setEquipmentImages(current => ({ ...current, [`${item.is_kit ? 'kit' : 'item'}:${item.id}`]: item.thumbnail_url || null }));
    setDraft(current => ({ ...current, equipment: [...current.equipment, { id: crypto.randomUUID(), name: item.name, equipment_item_id: item.is_kit ? null : item.id, equipment_kit_id: item.is_kit ? item.id : null, quantity: 1, is_optional: false, notes: '' }] }));
  };
  return <>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5 [scrollbar-gutter:stable]">
      <p className="text-xs leading-5 text-[#e5e4e2]/55">Zakres na 1 pakiet. Sprzęt i obsada są niezależne od produktu bazowego oraz innych pakietów. Role określają wymagania — konkretne osoby przypiszesz do wydarzenia. Stawkę i rozliczenie obsady ustawisz przy roli; koszt dla spółki doliczymy do pakietu.</p>
      {!initial && <p className="rounded-lg bg-[#d3bb73]/10 p-3 text-xs text-[#d3bb73]">Zasoby tego pakietu nie zostały jeszcze określone. Sprzęt bazowy nie zostanie automatycznie przypisany.</p>}
      <div className="flex gap-2"><button type="button" aria-pressed={tab === 'equipment'} onClick={() => setTab('equipment')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === 'equipment' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5'}`}><Wrench className="h-4 w-4"/>Sprzęt ({draft.equipment.length})</button><button type="button" aria-pressed={tab === 'staff'} disabled={Boolean(equipmentEdit)} onClick={() => setTab('staff')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === 'staff' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5'}`}><Users className="h-4 w-4"/>Obsada ({draft.staff.reduce((sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0), 0)})</button></div>
      {tab === 'equipment' ? <>
        {draft.equipment.length > 0 && <p className="text-xs font-medium text-[#e5e4e2]/50">Dodany sprzęt</p>}
        <div className="space-y-2">{draft.equipment.map(row => <div key={row.id} className="rounded-lg bg-black/15 p-3">
          <div className="flex items-center gap-3">
            <EquipmentThumbnail key={equipmentImages[`${row.equipment_kit_id ? 'kit' : 'item'}:${row.equipment_kit_id || row.equipment_item_id}`] || row.id} src={equipmentImages[`${row.equipment_kit_id ? 'kit' : 'item'}:${row.equipment_kit_id || row.equipment_item_id}`]} name={row.name}/>
            <div className="min-w-0 flex-1"><p className="break-words text-sm">{row.name}</p><p className="text-xs text-[#e5e4e2]/50">{row.equipment_kit_id ? 'Zestaw' : 'Sprzęt'} · {row.quantity} szt. · {row.is_optional ? 'Opcjonalny' : 'Wymagany'}</p>{row.notes && <p className="mt-1 break-words text-xs text-[#e5e4e2]/55">{row.notes}</p>}</div>
            {!readOnly && <ResponsiveActionBar alwaysDropdown compact portalWithinDialog actions={[
              { label: 'Edytuj', icon: <Pencil className="h-4 w-4"/>, disabled: Boolean(equipmentEdit), onClick: () => setEquipmentEdit(structuredClone(row)) },
              { label: 'Usuń z pakietu', icon: <Trash2 className="h-4 w-4"/>, variant: 'danger', onClick: () => removeEquipment(row.id) },
            ]}/>}
          </div>
          {!readOnly && equipmentEdit?.id === row.id && <div className="mt-3 space-y-3 rounded-lg bg-white/5 p-3">
            <div className="flex items-end gap-4"><label className="w-28 text-xs text-[#e5e4e2]/60">Ilość<input autoFocus type="number" min="1" max="10000" step="1" value={Number.isFinite(equipmentEdit.quantity) ? equipmentEdit.quantity : ''} onChange={e => setEquipmentEdit({ ...equipmentEdit, quantity: e.target.valueAsNumber })} className={field}/></label><label className="pb-2 text-sm"><input type="checkbox" checked={equipmentEdit.is_optional} onChange={e => setEquipmentEdit({ ...equipmentEdit, is_optional: e.target.checked })} className="mr-2 accent-[#d3bb73]"/>Opcjonalny</label></div>
            <label className="block text-xs text-[#e5e4e2]/60">Wymagania i uwagi<input maxLength={500} value={equipmentEdit.notes} onChange={e => setEquipmentEdit({ ...equipmentEdit, notes: e.target.value })} className={field}/></label>
            {equipmentEditError && <p role="alert" className="text-xs text-red-200">{equipmentEditError}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEquipmentEdit(null)} className="rounded-lg bg-white/5 px-3 py-2 text-xs">Anuluj</button><button type="button" disabled={Boolean(equipmentEditError)} onClick={() => {
              if (equipmentEditError) return;
              setDraft(current => ({ ...current, equipment: current.equipment.map(item => item.id === equipmentEdit.id ? { ...equipmentEdit } : item) }));
              setEquipmentEdit(null);
            }} className="rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40">Zastosuj zmiany</button></div>
          </div>}
        </div>)}</div>
        {!draft.equipment.length && <p className="text-sm text-[#e5e4e2]/50">Brak przypisanego sprzętu.</p>}
        {!readOnly && <><button type="button" disabled={draft.equipment.length >= 100} onClick={() => setChoosing(current => !current)} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Plus className="h-4 w-4"/>{choosing ? 'Zamknij katalog' : 'Dodaj sprzęt z katalogu'}</button>
        {choosing && <div className="space-y-2 rounded-lg bg-black/10 p-3"><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Szukaj sprzętu lub zestawu…" aria-label="Szukaj sprzętu" className={field}/>
          {isError ? <button type="button" onClick={() => void refetch()} className="text-sm text-red-200">Nie udało się pobrać sprzętu. Spróbuj ponownie.</button> : isLoading ? <p className="text-sm text-[#e5e4e2]/50">Ładowanie katalogu…</p> : <div className="max-h-64 space-y-1 overflow-y-auto">{availableEquipment.map(item => { return <div key={`${item.is_kit ? 'kit' : 'item'}:${item.id}`} className="flex w-full items-center gap-3 rounded-lg bg-white/5 p-2"><EquipmentThumbnail key={item.thumbnail_url || item.id} src={item.thumbnail_url} name={item.name}/><button type="button" disabled={draft.equipment.length >= 100} onClick={() => addEquipment(item)} className="flex min-w-0 flex-1 items-center justify-between gap-3 self-stretch text-left text-sm disabled:opacity-40"><span className="min-w-0 break-words">{item.name}<span className="ml-2 text-xs text-[#e5e4e2]/40">{item.is_kit ? 'Zestaw' : 'Sprzęt'}</span></span><span className="shrink-0 text-xs text-[#d3bb73]">Dodaj</span></button></div>; })}{!availableEquipment.length && <p className="text-sm text-[#e5e4e2]/50">{hasMore ? 'Brak nowych pozycji w tej części katalogu. Użyj „Pokaż więcej” lub zmień wyszukiwanie.' : 'Brak kolejnych pasujących pozycji. Sprzęt dodany do pakietu jest ukryty w wynikach.'}</p>}</div>}
          {hasMore && <button type="button" disabled={isFetching} onClick={() => void loadMore().catch(() => {})} className="text-xs text-[#d3bb73]">{isFetching ? 'Ładowanie…' : 'Pokaż więcej'}</button>}
        </div>}</>}
      </> : <>
        {compensationLoading && <p className="text-xs text-[#e5e4e2]/50">Wczytywanie parametrów rozliczeń…</p>}
        {compensationError && <p role="alert" className="text-xs text-red-200">{compensationError} <button type="button" onClick={() => setCompensationRetry(current => current + 1)} className="underline">Spróbuj ponownie</button></p>}
        {draft.staff.map(row => <div key={row.id} className="space-y-3 rounded-lg bg-black/15 p-3">
          {readOnly ? <><p className="text-sm">{systemLabel(row.role, 'role', { preserveCustom: true })} · {row.quantity} os.</p><p className="text-xs text-[#e5e4e2]/60">{row.estimated_hours != null ? `${row.estimated_hours} h / osobę · ` : ''}{row.is_optional ? 'Opcjonalna obsada' : 'Wymagana obsada'}{row.notes ? ` · ${row.notes}` : ''}</p></> : <>
            <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs text-[#e5e4e2]/60">Rola<input value={row.role} maxLength={120} placeholder="Np. krupier, technik, kierowca" onChange={e => setDraft(current => ({ ...current, staff: current.staff.map(item => item.id === row.id ? { ...item, role: e.target.value } : item) }))} className={field}/></label><button type="button" aria-label={`Usuń rolę ${row.role}`} onClick={() => setDraft(current => ({ ...current, staff: current.staff.filter(item => item.id !== row.id) }))} className="rounded-lg p-2 text-red-200/70"><Trash2 className="h-4 w-4"/></button></div>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-[#e5e4e2]/60">Liczba osób<input type="number" min="1" max="10000" step="1" value={Number.isFinite(row.quantity) ? row.quantity : ''} onChange={e => setDraft(current => ({ ...current, staff: current.staff.map(item => item.id === row.id ? { ...item, quantity: e.target.valueAsNumber } : item) }))} className={field}/></label><label className="text-xs text-[#e5e4e2]/60">Godziny / osobę — opcjonalnie<input type="number" min="0" max="10000" step="0.25" value={row.estimated_hours ?? ''} onChange={e => setDraft(current => ({ ...current, staff: current.staff.map(item => item.id === row.id ? { ...item, estimated_hours: e.target.value === '' ? null : e.target.valueAsNumber } : item) }))} className={field}/></label></div>
            <label className="block text-xs text-[#e5e4e2]/60">Wymagania i uwagi<input value={row.notes} maxLength={500} placeholder="Np. 2 osoby na montaż, uprawnienia, zadania" onChange={e => setDraft(current => ({ ...current, staff: current.staff.map(item => item.id === row.id ? { ...item, notes: e.target.value } : item) }))} className={field}/></label>
            <label className="text-sm"><input type="checkbox" checked={row.is_optional} onChange={e => setDraft(current => ({ ...current, staff: current.staff.map(item => item.id === row.id ? { ...item, is_optional: e.target.checked } : item) }))} className="mr-2 accent-[#d3bb73]"/>Opcjonalna obsada</label>
          </>}
          <PackageStaffCompensationFields row={row} settings={compensationSettings} readOnly={readOnly} onChange={compensation => setDraft(current => ({ ...current, staff: current.staff.map(item => item.id === row.id ? { ...item, compensation } : item) }))}/>
        </div>)}
        {!draft.staff.length && <p className="text-sm text-[#e5e4e2]/50">Brak określonej obsady.</p>}
        {!readOnly && <button type="button" disabled={draft.staff.length >= 40} onClick={() => setDraft(current => ({ ...current, staff: [...current.staff, { id: crypto.randomUUID(), role: '', quantity: 1, estimated_hours: null, is_optional: false, notes: '' }] }))} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Plus className="h-4 w-4"/>Dodaj rolę</button>}
      </>}
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    </div>
    <footer className="shrink-0 space-y-3 bg-black/10 p-5">{equipmentEdit && <p className="text-xs text-[#d3bb73]">Zastosuj lub anuluj edycję sprzętu przed zatwierdzeniem zasobów.</p>}{!readOnly && <p className="text-xs text-[#e5e4e2]/45">Zastosuj zakres, a następnie zapisz pakiet lub pozycję oferty. Zatwierdzenie pustych list oznacza brak wymaganych zasobów.</p>}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-3 py-2 text-sm">{readOnly ? 'Zamknij' : 'Anuluj'}</button>{!readOnly && <button type="button" disabled={Boolean(error) || Boolean(equipmentEdit)} onClick={() => { if (!equipmentEdit && !validatePackageResources(draft)) onApply(structuredClone(draft)); }} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">Zastosuj zasoby</button>}</div></footer>
  </>;
}
export default function ProductPackageResourcesEditor({ value, onChange, disabled, readOnly = false }: { value: ProductSalesPackage; onChange?: (resources: ProductPackageResources) => void; disabled?: boolean; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  return <><button type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => setOpen(true)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-left text-sm text-[#d3bb73] disabled:opacity-40"><span>Sprzęt i obsada</span><span className="text-xs">{value.resources ? `${value.resources.equipment.length} poz. · ${value.resources.staff.reduce((sum, row) => sum + row.quantity, 0)} os.` : 'Nie określono'}</span></button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onClose={() => setOpen(false)} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65"><div className="flex max-h-[85dvh] flex-col"><header className="flex shrink-0 items-start justify-between gap-3 px-5 py-4"><div><h3 id={titleId} className="text-base font-medium">Sprzęt i obsada pakietu</h3><p className="mt-1 text-sm text-[#e5e4e2]/60">{value.name || 'Nowy pakiet'}</p></div><button autoFocus type="button" aria-label="Zamknij zasoby pakietu" onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-white/5"><X className="h-5 w-5"/></button></header><ResourceForm initial={value.resources} readOnly={readOnly || !onChange || disabled} onClose={() => setOpen(false)} onApply={resources => { onChange?.(resources); setOpen(false); }}/></div></dialog>, document.body)}
  </>;
}
