'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ProductStaffRow } from '../../types';
import PackageStaffCompensationFields from '@/components/crm/offers/PackageStaffCompensationFields';
import { loadCompensationSettings } from '@/lib/personnel/compensationData';
import { validatePackageResources, type PackageCostCompensationSnapshot, type PackageStaffCompensation, type ProductPackageStaff } from '@/lib/CRM/Offers/productSalesPackages';

export function AddStaffModal({ productId, productVariantName, initialValue, readOnly = false, onClose, onSubmit }: {
  productId: string; productVariantName?: string | null; initialValue?: ProductStaffRow; readOnly?: boolean;
  onClose: () => void; onSubmit: (payload: ProductStaffRow) => Promise<void> | void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState(initialValue?.role || '');
  const [quantity, setQuantity] = useState(initialValue?.quantity ?? 1);
  const [hours, setHours] = useState(initialValue?.estimated_hours == null ? '' : String(initialValue.estimated_hours));
  const [optional, setOptional] = useState(initialValue?.is_optional ?? false);
  const [notes, setNotes] = useState(initialValue?.notes || '');
  const [payment, setPayment] = useState<PackageStaffCompensation | null>(() => initialValue?.compensation || (initialValue?.hourly_rate != null ? {
    rate_basis: 'hourly', rate: Number(initialValue.hourly_rate), settlement_method: initialValue.payment_type === 'cash_no_receipt' ? 'cash_non_deductible' : 'invoice', compensation_snapshot: null,
  } : null));
  const [settings, setSettings] = useState<PackageCostCompensationSnapshot | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, []);
  useEffect(() => {
    if (readOnly) return;
    let active = true; setSettingsError('');
    void loadCompensationSettings().then(s => {
      if (!active) return;
      const snapshot = { cit_rate: s.cit_rate, dividend_rate: s.dividend_rate, updated_at: s.updated_at };
      setSettings(snapshot);
      setPayment(p => p?.settlement_method === 'cash_non_deductible' && !p.compensation_snapshot ? { ...p, compensation_snapshot: snapshot } : p);
    }).catch(() => { if (active) setSettingsError('Nie udało się pobrać parametrów rozliczenia gotówki.'); });
    return () => { active = false; };
  }, [readOnly, retry]);
  const row: ProductPackageStaff = { id: initialValue?.id || 'draft', role, quantity, estimated_hours: hours === '' ? null : Number(hours), is_optional: optional, notes, compensation: payment };
  const submit = async () => {
    if (savingRef.current || readOnly) return;
    const problem = validatePackageResources({ equipment: [], staff: [row] });
    if (problem) { setError(problem); return; }
    savingRef.current = true; setSaving(true); setError('');
    try {
      await onSubmit({ id: initialValue?.id || crypto.randomUUID(), product_id: productId, role: role.trim(), quantity,
        estimated_hours: row.estimated_hours, hourly_rate: payment?.rate_basis === 'hourly' ? payment.rate : null,
        is_optional: optional, notes: notes.trim() || null, compensation: payment,
        payment_type: payment?.settlement_method === 'cash_documented' ? 'cash_documented' : payment?.settlement_method === 'cash_non_deductible' ? 'cash_no_receipt' : initialValue?.payment_type === 'invoice_no_vat' ? 'invoice_no_vat' : 'invoice_with_vat',
      });
      onClose();
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać roli.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const close = () => { if (!savingRef.current) onClose(); };
  const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="product-staff-modal-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] backdrop:bg-black/65">
    <div className="flex max-h-[90dvh] flex-col"><header className="flex justify-between gap-3 p-5"><div><h3 id="product-staff-modal-title" className="text-lg uppercase">{readOnly ? 'Podgląd obsady' : initialValue ? 'Edytuj rolę i koszt' : 'Dodaj rolę i koszt'}</h3><p className="mt-1 text-xs text-[#d3bb73]">{productVariantName || 'Produkt bazowy'}</p></div><button type="button" disabled={saving} aria-label="Zamknij" onClick={close}><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-4"><fieldset disabled={saving || readOnly} className="space-y-4">
        <label className="block text-xs">Nazwa roli<input value={role} maxLength={120} onChange={e=>setRole(e.target.value)} placeholder="Np. Prowadzący" className={field}/></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs">Liczba osób<input type="number" min={1} max={10000} step={1} value={Number.isFinite(quantity) ? quantity : ''} onChange={e=>setQuantity(e.target.valueAsNumber)} className={field}/></label><label className="text-xs">Godziny / osobę<input type="number" min={0} max={10000} step="0.01" value={hours} onChange={e=>setHours(e.target.value)} className={field}/></label></div>
        <PackageStaffCompensationFields row={row} settings={settings} readOnly={readOnly} scope="product" onChange={setPayment}/>
        <label className="block text-xs">Notatki<textarea rows={2} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} className={field}/></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optional} onChange={e=>setOptional(e.target.checked)}/>Opcjonalna obsada — bez doliczania kosztu</label>
      </fieldset>
      {settingsError && <p className="text-xs text-red-200">{settingsError} <button type="button" disabled={saving} onClick={()=>setRetry(v=>v+1)} className="underline">Ponów</button></p>}
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}</div>
      <footer className="flex justify-end gap-2 p-5"><button type="button" disabled={saving} onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm">{readOnly ? 'Zamknij' : 'Anuluj'}</button>{!readOnly && <button type="button" disabled={saving} onClick={()=>void submit()} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33]">{saving ? 'Zapisywanie…' : 'Zapisz rolę i koszt'}</button>}</footer>
    </div>
  </dialog>;
}
