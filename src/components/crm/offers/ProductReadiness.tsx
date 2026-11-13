'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  productReadiness,
  READINESS_CHECK_SHORT,
  READINESS_EXEMPTION_REASON_MAX,
  withoutReadinessExemption,
  withReadinessExemption,
  type ProductReadiness,
  type ReadinessCheck,
  type ReadinessExemptionKey,
  type ReadinessExemptions,
  type ReadinessProduct,
  type ReadinessResources,
  type ReadinessStaffRow,
} from '@/lib/CRM/Offers/productReadiness';
import { openProductSection, PRODUCT_READINESS_REFRESH_EVENT } from './productSectionEvents';

const missingLabel = (count: number) =>
  count === 1 ? '1 brak' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? `${count} braki` : `${count} braków`;

/** Cztery kropki: Cena i koszt · Zdjęcie i opisy · Sprzęt i obsada · Klauzule (zielona — gotowe, bursztynowa — braki). */
export function ReadinessDots({ readiness, className = '' }: { readiness: ProductReadiness; className?: string }) {
  const label = readiness.ready
    ? 'Gotowy do oferty'
    : `Do uzupełnienia: ${readiness.groups.filter((group) => !group.ok).map((group) => group.label).join(', ')}`;
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {readiness.groups.map((group) => (
        <span key={group.key} aria-hidden="true" className={`h-2 w-2 rounded-full ${group.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      ))}
    </span>
  );
}

/** Krótki opis braków do listy produktów, np. „Braki: koszt, zdjęcie, sprzęt”. */
export function readinessSummary(readiness: ProductReadiness) {
  if (readiness.ready) return 'Gotowy do oferty';
  const labels = Array.from(new Set(readiness.missing.map((check) => READINESS_CHECK_SHORT[check.key])));
  return `Braki: ${labels.join(', ')}`;
}

function StateIcon({ check }: { check: ReadinessCheck }) {
  if (check.state === 'ok') return <CheckCircle2 aria-label="Gotowe" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />;
  if (check.state === 'missing') return <AlertTriangle aria-label="Brak" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />;
  return <CircleSlash aria-label="Nie dotyczy" className="mt-0.5 h-4 w-4 shrink-0 text-[#e5e4e2]/40" />;
}

/**
 * Karta produktu: gotowość do oferty z brakami, przejściem do właściwej sekcji („Uzupełnij”) i wpisem „Nie dotyczy”
 * z powodem (koszt, sprzęt, obsada, klauzule). Sprzęt i obsadę sprawdza na bieżąco w bazie.
 */
export default function ProductReadinessPanel({
  productId,
  product,
  canEdit,
  employeeId,
  onExemptionsSaved,
}: {
  productId: string;
  product: ReadinessProduct;
  canEdit: boolean;
  employeeId: string | null;
  onExemptionsSaved: (next: ReadinessExemptions) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [resources, setResources] = useState<ReadinessResources | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);
  const [waiving, setWaiving] = useState<ReadinessExemptionKey | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState<ReadinessExemptionKey | null>(null);

  const load = useCallback(async () => {
    const [equipment, staff] = await Promise.all([
      supabase.from('offer_product_equipment').select('id', { count: 'exact', head: true }).eq('product_id', productId),
      supabase.from('offer_product_staff').select('hourly_rate, estimated_hours, compensation, is_optional').eq('product_id', productId),
    ]);
    if (equipment.error || staff.error) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setResources({ equipmentCount: equipment.count ?? 0, staff: (staff.data || []) as ReadinessStaffRow[] });
  }, [productId]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(PRODUCT_READINESS_REFRESH_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(PRODUCT_READINESS_REFRESH_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const readiness = useMemo(() => productReadiness(product, resources), [product, resources]);
  const expanded = open ?? !readiness.ready;

  const save = async (key: ReadinessExemptionKey, next: ReadinessExemptions, message: string) => {
    setSaving(key);
    try {
      const { data, error } = await supabase.from('offer_products').update({ readiness_exemptions: next }).eq('id', productId).select('id').single();
      if (error || !data) {
        const missingColumn = /readiness_exemptions/.test(error?.message || '');
        throw new Error(missingColumn
          ? 'Zapis „nie dotyczy” wymaga migracji 20261113090000_offer_product_readiness w bazie.'
          : error?.message || 'Nie udało się zapisać.');
      }
      onExemptionsSaved(next);
      setWaiving(null);
      setReason('');
      showSnackbar(message, 'success');
    } catch (caught) {
      showSnackbar(caught instanceof Error ? caught.message : 'Nie udało się zapisać.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const submitWaiver = (event: FormEvent, check: ReadinessCheck) => {
    event.preventDefault();
    if (!check.exemptionKey) return;
    let next: ReadinessExemptions;
    try {
      next = withReadinessExemption(product.readiness_exemptions, check.exemptionKey, reason, employeeId);
    } catch (caught) {
      showSnackbar(caught instanceof Error ? caught.message : 'Wpisz powód.', 'error');
      return;
    }
    void save(check.exemptionKey, next, `Oznaczono: ${check.label.toLocaleLowerCase('pl-PL')} nie dotyczy tego produktu`);
  };

  const restore = (check: ReadinessCheck) => {
    if (!check.exemptionKey) return;
    void save(check.exemptionKey, withoutReadinessExemption(product.readiness_exemptions, check.exemptionKey),
      `Przywrócono wymaganie: ${check.label.toLocaleLowerCase('pl-PL')}`);
  };

  const status = !resources && !loadError
    ? 'Sprawdzam sprzęt i obsadę…'
    : loadError
      ? 'Nie udało się sprawdzić sprzętu i obsady.'
      : readiness.ready
        ? 'Gotowy — ma wszystko, czego potrzebuje oferta.'
        : `Do uzupełnienia: ${missingLabel(readiness.missing.length)}`;

  return (
    <section aria-labelledby="product-readiness-title" className="mb-3 rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-4">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="product-readiness-list"
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/50"
      >
        <span className="min-w-0">
          <span id="product-readiness-title" className="block text-sm font-medium text-[#e5e4e2]">Gotowość do oferty</span>
          <span role="status" className={`mt-0.5 block text-xs ${readiness.ready && resources ? 'text-emerald-300' : loadError ? 'text-red-300' : 'text-amber-200'}`}>
            {status}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {resources && <ReadinessDots readiness={readiness} />}
          <ChevronDown className={`h-4 w-4 text-[#d3bb73] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {expanded && (
        <div id="product-readiness-list" className="mt-3 space-y-3">
          {loadError && (
            <button type="button" onClick={() => void load()} className="text-xs text-[#d3bb73] hover:underline">Spróbuj ponownie</button>
          )}
          {readiness.groups.map((group) => (
            <div key={group.key}>
              <h3 className={`text-xs font-medium uppercase tracking-wide ${group.ok ? 'text-emerald-300/80' : 'text-amber-200'}`}>{group.label}</h3>
              <ul className="mt-1.5 space-y-1.5">
                {group.checks.map((check) => {
                  const resourceCheck = check.key === 'equipment' || check.key === 'staff';
                  const pending = resourceCheck && !resources && !loadError;
                  return (
                    <li key={check.key} className="rounded-lg bg-black/15 px-3 py-2 text-sm">
                      <div className="flex items-start gap-2">
                        {pending ? <Loader2 aria-label="Sprawdzanie" className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#e5e4e2]/40" /> : <StateIcon check={check} />}
                        <div className="min-w-0 flex-1">
                          <div className="text-[#e5e4e2]/85">{check.label}</div>
                          <div className="text-xs text-[#e5e4e2]/50">{pending ? 'Sprawdzam…' : check.detail}</div>
                          {check.exemption && check.state === 'ok' && canEdit && (
                            <button type="button" disabled={saving !== null} onClick={() => restore(check)} className="mt-1 text-xs text-[#e5e4e2]/50 underline-offset-2 hover:underline disabled:opacity-50">
                              Wpis „nie dotyczy” jest już zbędny — usuń
                            </button>
                          )}
                          {waiving === check.exemptionKey && check.exemptionKey && (
                            <form onSubmit={(event) => submitWaiver(event, check)} className="mt-2 space-y-2">
                              <label className="block text-xs text-[#e5e4e2]/60">
                                Dlaczego nie dotyczy tego produktu?
                                <input
                                  autoFocus
                                  value={reason}
                                  maxLength={READINESS_EXEMPTION_REASON_MAX}
                                  onChange={(event) => setReason(event.target.value)}
                                  onKeyDown={(event) => { if (event.key === 'Escape') { setWaiving(null); setReason(''); } }}
                                  placeholder={check.key === 'cost' ? 'np. własny sprzęt, koszt w amortyzacji' : check.key === 'equipment' ? 'np. artysta przyjeżdża ze swoim sprzętem' : 'Powód'}
                                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/60 focus:outline-none"
                                />
                              </label>
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => { setWaiving(null); setReason(''); }} className="rounded-lg px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Anuluj</button>
                                <button type="submit" disabled={saving !== null || reason.trim().length < 3} className="flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] disabled:opacity-50">
                                  {saving === check.exemptionKey && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                  Zapisz
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                        {!pending && (check.state === 'missing' || check.state === 'waived') && waiving !== check.exemptionKey && (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {check.state === 'missing' && (
                              <button type="button" onClick={() => openProductSection(check.anchor)} className="rounded-md px-2 py-0.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">
                                {canEdit ? 'Uzupełnij' : 'Pokaż'}
                              </button>
                            )}
                            {check.state === 'missing' && canEdit && check.exemptionKey && (
                              <button type="button" disabled={saving !== null} onClick={() => { setWaiving(check.exemptionKey); setReason(''); }} className="rounded-md px-2 py-0.5 text-xs text-[#e5e4e2]/55 hover:bg-white/5 disabled:opacity-50">
                                Nie dotyczy…
                              </button>
                            )}
                            {check.state === 'waived' && canEdit && (
                              <button type="button" disabled={saving !== null} onClick={() => restore(check)} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-[#e5e4e2]/55 hover:bg-white/5 disabled:opacity-50">
                                {saving === check.exemptionKey && <Loader2 className="h-3 w-3 animate-spin" />}
                                Przywróć
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {product.is_active === false && (
            <p className="text-xs text-[#e5e4e2]/50">Produkt jest nieaktywny — nie trafia do nowych ofert.</p>
          )}
        </div>
      )}
    </section>
  );
}
