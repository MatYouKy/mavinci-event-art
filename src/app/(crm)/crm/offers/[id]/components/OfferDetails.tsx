'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { calculateOfferDiscount, type OfferDiscountMode } from '@/lib/CRM/Offers/offerDiscount';
import { getOfferStatusBadgeProps } from '../../helpers/statusColors';
import { getOfferPricingTotals, getOfferSummary } from '@/lib/CRM/Offers/offerTotals';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';

/** Jak klient widzi rabat w PDF (`offers.discount_display`). */
const DISCOUNT_DISPLAYS = [
  { key: 'lines', label: 'Przy pozycjach', hint: 'Klient widzi rabat każdej pozycji i rabat na ofertę.' },
  { key: 'total', label: 'Rabat łączny', hint: 'Pozycje w cenach przed rabatem, pod tabelą jeden rabat łączny.' },
  { key: 'none', label: 'Ceny po rabacie', hint: 'Klient widzi tylko ceny po rabacie — bez kwoty rabatu.' },
] as const;

export const OfferDetails = ({ offer, canEdit = false, onSaved }: { offer: any; canEdit?: boolean; onSaved?: () => unknown }) => {
  const { showSnackbar } = useSnackbar();
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discountDraft, setDiscountDraft] = useState<{ mode: OfferDiscountMode; value: string } | null>(null);
  const [savingDisplay, setSavingDisplay] = useState(false);
  useEffect(() => { setEditingDiscount(false); setDiscountDraft(null); }, [offer.id]);
  const badge = getOfferStatusBadgeProps(offer.status);
  const discountBase = getOfferPricingTotals(offer);
  const canEditDiscount = canEdit && offer.sales_channel !== 'seller_portal' && discountBase.source === 'offer';
  const discountPreview = calculateOfferDiscount(discountBase.listNet, discountBase.taxPercent,
    discountDraft?.mode || 'amount', discountDraft?.value ?? String(discountBase.discountAmount));
  const totals = editingDiscount && discountPreview ? {
    ...discountBase, discountAmount: discountPreview.discount_amount,
    discountPercent: discountPreview.discount_percent, net: discountPreview.net,
    taxAmount: discountPreview.tax_amount, gross: discountPreview.total_amount,
  } : discountBase;
  // Rabaty pozycji i rabat na ofertę osobno (jak podsumowanie wyceny w PDF, na Macu i w aplikacji).
  const summary = getOfferSummary(offer, totals);
  const customerLogisticsNet = summary.logisticsNet;
  const discountDisplay = DISCOUNT_DISPLAYS.find((display) => display.key === offer.discount_display) || DISCOUNT_DISPLAYS[0];
  const saveDiscountDisplay = async (value: string) => {
    if (!canEditDiscount || savingDisplay || value === discountDisplay.key) return;
    setSavingDisplay(true);
    try {
      const { error } = await supabase.from('offers').update({ discount_display: value }).eq('id', offer.id).select('id').single();
      if (error) throw error;
      await onSaved?.();
      showSnackbar('Zapisano — wygeneruj PDF ponownie, żeby klient zobaczył zmianę', 'success');
    } catch (error: any) {
      const missing = ['42703', 'PGRST204'].includes(error?.code);
      showSnackbar(missing ? 'Wybór rabatu w PDF wymaga migracji 20261124120000_offer_discount_display.sql' : error?.message || 'Nie udało się zapisać ustawienia rabatu', 'error');
    } finally { setSavingDisplay(false); }
  };
  const saveDiscount = async () => {
    if (!canEditDiscount || !discountPreview || loading) return;
    setLoading(true);
    try {
      const { net, ...payload } = discountPreview;
      const { error } = await supabase.from('offers').update({ ...payload, totals_include_logistics: true }).eq('id', offer.id).select('id').single();
      if (error) throw error;
      await onSaved?.();
      setEditingDiscount(false); setDiscountDraft(null);
      showSnackbar('Rabat zapisany', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zapisać rabatu', 'error');
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <FullScreenLoader show={savingDisplay} title="Zapisuję ustawienie rabatu" description="Zmiana obejmie PDF po ponownym wygenerowaniu." />
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>

      <div className="mb-4">
        <p className="mb-1 text-sm text-[#e5e4e2]/60">Status</p>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs uppercase ${badge.bg} ${badge.text} ${badge.border} `}
        >
          {badge.label}
        </span>
      </div>

      <div className="mb-4 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
        <p className="mb-2 text-sm text-[#e5e4e2]/60">Podsumowanie</p>
        <table className="w-full text-sm"><thead><tr className="text-xs text-[#e5e4e2]/50"><th className="pb-2 text-left">Cała oferta</th><th className="pb-2 text-right">Netto</th><th className="pb-2 text-right">Brutto</th></tr></thead><tbody>
          {summary.rows.map((row) => {
            const money = (value: number) => (value < 0 ? `−${Math.abs(value).toFixed(2)}` : value.toFixed(2));
            if (row.emphasis) return <tr key={row.key} className="bg-[#d3bb73]/10 font-medium text-[#d3bb73]"><td className="py-3">{row.label}</td><td className="text-right">{money(row.net)}</td><td className="text-right">{money(row.gross)}</td></tr>;
            const discountRow = row.key === 'lineDiscount' || row.key === 'offerDiscount';
            return <tr key={row.key} className={discountRow ? 'text-[#d3bb73]' : row.key === 'list' ? '' : 'text-[#e5e4e2]/70'}>
              <td className={row.key === 'list' ? 'py-2 text-[#e5e4e2]/70' : 'py-2'}>{row.label}</td><td className="text-right">{money(row.net)}</td><td className="text-right">{money(row.gross)}</td>
            </tr>;
          })}
        </tbody></table>
        <p className="mt-2 text-xs text-[#e5e4e2]/50">Kwoty w PLN · VAT {totals.hasMixedVatRates ? 'według stawek pozycji' : `${totals.taxPercent}%`}: {totals.taxAmount.toFixed(2)} zł</p>
        {summary.discountNote && <p className="mt-2 text-xs text-[#e5e4e2]/50">{summary.discountNote}</p>}
        {totals.source === 'offer' && (
          <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
            <label className="flex flex-wrap items-center gap-2 text-xs text-[#e5e4e2]/60">
              <span>Rabat w PDF dla klienta</span>
              <select value={discountDisplay.key} disabled={!canEditDiscount || savingDisplay} onChange={(event) => void saveDiscountDisplay(event.target.value)}
                className="rounded-lg border border-white/10 bg-[#1c1f33] px-2 py-1.5 text-xs text-[#e5e4e2] disabled:opacity-60">
                {DISCOUNT_DISPLAYS.map((display) => <option key={display.key} value={display.key}>{display.label}</option>)}
              </select>
            </label>
            <p className="mt-1 text-xs text-[#e5e4e2]/45">{discountDisplay.hint}</p>
          </div>
        )}
        {customerLogisticsNet > 0 && <p className="mt-2 text-xs text-[#e5e4e2]/50">Logistyka jest ujęta w sumie. Rabat od całej oferty obejmuje również jej cenę.</p>}
      </div>

      {canEditDiscount && !editingDiscount && <button type="button" onClick={() => { setDiscountDraft(null); setEditingDiscount(true); }} className="mb-4 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20">{discountBase.discountAmount > 0 ? 'Edytuj rabat' : 'Dodaj rabat'}</button>}
          {editingDiscount && canEditDiscount && <section className="rounded-xl bg-[#0a0d1a]/60 p-4">
            <h3 className="mb-2 text-base font-medium text-[#e5e4e2]">Rabat</h3>
            <>
              <p className="mb-3 text-xs text-[#e5e4e2]/60">Podstawa rabatu: {discountBase.listNet.toFixed(2)} zł netto{customerLogisticsNet > 0 ? ' — pozycje oferty wraz z logistyką' : ''}{summary.lineDiscount > 0 ? `, po rabatach pozycji (−${summary.lineDiscount.toFixed(2)} zł)` : ''}. Ustaw rabat kwotowy, procentowy albo docelową cenę całej oferty.</p>
              <div className="grid gap-3">
                {([
                  ['amount', 'Rabat netto (zł)', discountPreview?.discount_amount],
                  ['percent', 'Rabat (%)', discountPreview?.discount_percent],
                  ['target', 'Cena docelowa netto (zł)', discountPreview?.net],
                ] as const).map(([mode, label, value]) => <label key={mode} className="text-xs text-[#e5e4e2]/60">
                  {label}
                  <input type="number" min="0" max={mode === 'percent' ? 100 : discountBase.listNet} step="0.01" disabled={loading}
                    value={discountDraft?.mode === mode ? discountDraft.value : (value ?? 0).toFixed(2)}
                    onChange={e => setDiscountDraft({ mode, value: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" />
                </label>)}
              </div>
              {!discountPreview && <p role="alert" className="mt-2 text-sm text-red-300">Podaj kwotę od 0 do wartości oferty lub rabat od 0 do 100%.</p>}
              {discountPreview && <p className="mt-3 text-sm text-[#d3bb73]">Po rabacie: {discountPreview.net.toFixed(2)} zł netto · VAT: {discountPreview.tax_amount.toFixed(2)} zł · {discountPreview.total_amount.toFixed(2)} zł brutto</p>}
              <button type="button" disabled={loading} onClick={() => setDiscountDraft({ mode: 'amount', value: '0' })} className="mt-2 text-xs text-[#e5e4e2]/60 hover:text-[#d3bb73]">Usuń rabat</button>
            </>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={loading || !discountPreview} onClick={saveDiscount} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40">{loading ? 'Zapisuję…' : 'Zapisz rabat'}</button>
              <button type="button" disabled={loading} onClick={() => { setEditingDiscount(false); setDiscountDraft(null); }} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2]/70 disabled:opacity-40">Anuluj</button>
            </div>
          </section>}

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-[#e5e4e2]/60">Utworzona</p>
          <p className="text-[#e5e4e2]">
            {offer.created_at ? new Date(offer.created_at).toLocaleString('pl-PL') : '-'}
          </p>
        </div>

        <div>
          <p className="text-[#e5e4e2]/60">Ostatnia aktualizacja</p>
          <p className="text-[#e5e4e2]">
            {offer.updated_at ? new Date(offer.updated_at).toLocaleString('pl-PL') : '-'}
          </p>
        </div>

        <div>
          <p className="text-[#e5e4e2]/60">Wygasa</p>
          <p className="text-[#e5e4e2]">
            {offer.valid_until ? new Date(offer.valid_until).toLocaleString('pl-PL') : '-'}
          </p>
        </div>
      </div>
    </div>
  );
};
