'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import SeasonPriceNotice from './SeasonPriceNotice';
import {
  applyPriceListToOffer,
  loadSeasonPrices,
  priceListSeason,
  seasonPriceNotice,
  type PriceListApplyResult,
  type SeasonPrices,
} from '@/lib/CRM/Offers/seasonPrices';

const money = (value: number) => `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

/**
 * Cennik oferty na karcie oferty: skąd są ceny (cennik sezonowy marki według daty eventu), gwarancja ceny i —
 * dla edytujących — „Przelicz według cennika…”: najpierw podgląd różnic, potem świadome zastosowanie.
 */
export default function OfferSeasonPricePanel({ offerId, revision, canEdit, onApplied }: {
  offerId: string;
  /** Zmiana (np. `content_revision` oferty) odświeża opis cennika. */
  revision?: string | number | null;
  canEdit: boolean;
  onApplied: () => void | Promise<unknown>;
}) {
  const { showSnackbar } = useSnackbar();
  const [prices, setPrices] = useState<SeasonPrices | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PriceListApplyResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void loadSeasonPrices(supabase, { offerId }).then((result) => { if (active) setPrices(result); });
    return () => { active = false; };
  }, [offerId, revision]);

  const notice = seasonPriceNotice(prices, 'offer');
  const targetListId = prices?.suggested?.id || prices?.price_list?.id || null;

  const loadPreview = useCallback(async () => {
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await applyPriceListToOffer(supabase, offerId, { priceListId: targetListId, dryRun: true }));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Nie udało się przygotować podglądu.');
    }
  }, [offerId, targetListId]);

  const openDialog = () => {
    setOpen(true);
    void loadPreview();
  };

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  const apply = async () => {
    if (!preview?.price_list || busy) return;
    setBusy(true);
    try {
      const result = await applyPriceListToOffer(supabase, offerId, { priceListId: preview.price_list.id, dryRun: false });
      const name = result.price_list?.name || preview.price_list.name;
      showSnackbar(result.changes.length
        ? `Zmieniono ceny pozycji (${result.changes.length}) według cennika „${name}”.`
        : `Oferta jest wyceniona według cennika „${name}”.`, 'success');
      setOpen(false);
      setPrices(await loadSeasonPrices(supabase, { offerId }));
      await onApplied();
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się przeliczyć oferty.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!notice) return null;
  const action = canEdit && notice.canReprice && targetListId ? (
    <button type="button" onClick={openDialog}
      className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#d3bb73]/15 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/25">
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Przelicz według cennika…
    </button>
  ) : null;

  const canApply = Boolean(preview?.price_list && (preview.changes.length > 0 || !preview.linked));

  return (
    <>
      <SeasonPriceNotice prices={prices} mode="offer" action={action} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) setOpen(false); }}>
          <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="season-price-dialog-title"
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] outline-none">
            <div className="flex items-start justify-between gap-4 border-b border-[#d3bb73]/15 p-5">
              <div>
                <h2 id="season-price-dialog-title" className="text-lg font-light text-[#e5e4e2]">Przelicz według cennika</h2>
                <p className="mt-1 text-xs text-[#e5e4e2]/60">
                  {preview?.price_list
                    ? `${preview.price_list.name}${preview.price_list.company_name ? ` · ${preview.price_list.company_name}` : ''} · sezon ${priceListSeason(preview.price_list)}`
                    : 'Porównanie cen pozycji z cennikiem sezonu'}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Zamknij" className="rounded-lg p-1.5 text-[#e5e4e2]/60 hover:bg-white/5 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm text-[#e5e4e2]">
              {!preview && !previewError && <p role="status" className="flex items-center gap-2 text-white/60"><Loader2 className="h-4 w-4 animate-spin" />Porównuję ceny pozycji z cennikiem…</p>}
              {previewError && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-red-200">{previewError}</p>}
              {preview && (
                <>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Zmienią się tylko pozycje poniżej — cena bazowa z cennika (dodatki, ilości i rabaty zostają). Po zapisie oferta pamięta ten cennik, a PDF trzeba wygenerować ponownie.
                  </p>
                  {preview.changes.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead className="bg-white/[0.03] text-[#e5e4e2]/55">
                          <tr>
                            <th className="px-3 py-2 font-normal">Pozycja</th>
                            <th className="px-3 py-2 text-right font-normal">Ilość</th>
                            <th className="px-3 py-2 text-right font-normal">Cena netto</th>
                            <th className="px-3 py-2 text-right font-normal">Wartość netto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {preview.changes.map((change) => (
                            <tr key={change.item_id}>
                              <td className="px-3 py-2">{change.name}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#e5e4e2]/70">{change.quantity}{change.days > 1 ? ` × ${change.days} dni` : ''}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className="text-[#e5e4e2]/50 line-through">{money(change.old_price)}</span>
                                <ArrowRight className="mx-1 inline h-3 w-3 text-[#d3bb73]" aria-label="na" />
                                <span>{money(change.new_price)}</span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className="text-[#e5e4e2]/50">{money(change.old_subtotal)}</span>
                                <ArrowRight className="mx-1 inline h-3 w-3 text-[#d3bb73]" aria-label="na" />
                                <span>{money(change.new_subtotal)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-[#e5e4e2]/70">
                      Ceny pozycji są już zgodne z cennikiem{preview.linked ? '.' : ' — zapis tylko powiąże ofertę z tym cennikiem (gwarancja ceny).'}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#e5e4e2]/65">
                    <span>Do zmiany: <strong className="text-[#e5e4e2]">{preview.changes.length}</strong></span>
                    <span>Zgodne z cennikiem: <strong className="text-[#e5e4e2]">{preview.unchanged}</strong></span>
                    {preview.changes.length > 0 && <span>Różnica netto (przed rabatem oferty): <strong className={preview.delta_net >= 0 ? 'text-[#e5e4e2]' : 'text-emerald-300'}>{preview.delta_net > 0 ? '+' : ''}{money(preview.delta_net)}</strong></span>}
                  </div>
                  {preview.skipped.length > 0 && (
                    <details className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-[#e5e4e2]/65">
                      <summary className="cursor-pointer">Bez zmian ({preview.skipped.length}) — ceny ustalane inaczej</summary>
                      <ul className="mt-2 space-y-1">
                        {preview.skipped.map((row) => <li key={row.item_id}>{row.name} — {row.reason.toLowerCase()}</li>)}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d3bb73]/15 p-4">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/70 hover:bg-white/5 disabled:opacity-40">Anuluj</button>
              <button type="button" onClick={() => void apply()} disabled={!canApply || busy}
                className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {preview && preview.changes.length === 0 ? 'Powiąż z cennikiem' : 'Zastosuj ceny z cennika'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
