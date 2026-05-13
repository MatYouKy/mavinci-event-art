'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IOfferItem } from '../../types';

const VAT_RATES = [0, 5, 8, 23] as const;

interface EditOfferItemModalProps {
  item: IOfferItem | null;
  offerId?: string;
  vatRate?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditOfferItemModal({
  item,
  offerId,
  vatRate = 23,
  onClose,
  onSuccess,
}: EditOfferItemModalProps) {
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [unitPrice, setUnitPrice] = useState(item?.unit_price ?? 0);
  const [discountPercent, setDiscountPercent] = useState(item?.discount_percent ?? 0);
  const [itemVatRate, setItemVatRate] = useState(vatRate);

  if (!item) return null;

  const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
  const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
  const safeDiscountPercent = Number.isFinite(discountPercent) ? discountPercent : 0;

  const netto = safeQuantity * safeUnitPrice;
  const discountAmount = (netto * safeDiscountPercent) / 100;
  const nettoAfterDiscount = netto - discountAmount;
  const vatAmount = (nettoAfterDiscount * itemVatRate) / 100;
  const brutto = nettoAfterDiscount + vatAmount;

  const handleSave = async () => {
    if (safeQuantity <= 0) {
      showSnackbar('Ilość musi być większa od 0', 'error');
      return;
    }

    if (safeUnitPrice < 0) {
      showSnackbar('Cena nie może być ujemna', 'error');
      return;
    }

    if (safeDiscountPercent < 0 || safeDiscountPercent > 100) {
      showSnackbar('Rabat musi być w zakresie 0–100%', 'error');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('offer_items')
        .update({
          quantity: safeQuantity,
          unit_price: safeUnitPrice,
          discount_percent: safeDiscountPercent,
        })
        .eq('id', item.id);

      if (error) throw error;

      if (offerId) {
        const { error: offerError } = await supabase
          .from('offers')
          .update({ tax_percent: itemVatRate })
          .eq('id', offerId);

        if (offerError) console.error('Error updating VAT rate:', offerError);
      }

      showSnackbar('Pozycja zaktualizowana', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error updating item:', error);
      showSnackbar('Błąd podczas aktualizacji pozycji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-base text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none md:px-4 md:py-2 md:text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 md:items-center md:p-4">
      <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#d3bb73]/20 bg-[#0f1119] md:max-w-2xl md:rounded-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#0f1119] px-4 py-4 md:px-6">
          <div>
            <h2 className="text-lg font-light text-[#e5e4e2] md:text-xl">Edytuj pozycję</h2>
            <p className="mt-0.5 line-clamp-1 text-xs text-[#e5e4e2]/50">
              {item.product?.name || item.name}
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2] disabled:opacity-50"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:space-y-6 md:px-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/60 p-4">
            <h3 className="line-clamp-2 text-base font-medium text-[#e5e4e2]">
              {item.product?.name || item.name}
            </h3>

            {(item.product?.description || item.description) && (
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#e5e4e2]/60">
                {item.product?.description || item.description}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Ilość
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Cena netto / szt.
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Rabat %
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                Stawka VAT
              </label>
              <select
                value={itemVatRate}
                onChange={(e) => setItemVatRate(Number(e.target.value))}
                className={inputClass}
              >
                {VAT_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
            <div className="space-y-2 text-sm">
              <SummaryRow label="Netto" value={`${netto.toFixed(2)} PLN`} />

              {discountAmount > 0 && (
                <>
                  <SummaryRow
                    label={`Rabat (${safeDiscountPercent}%)`}
                    value={`-${discountAmount.toFixed(2)} PLN`}
                    valueClassName="text-green-400"
                  />
                  <SummaryRow label="Netto po rabacie" value={`${nettoAfterDiscount.toFixed(2)} PLN`} />
                </>
              )}

              <SummaryRow label={`VAT (${itemVatRate}%)`} value={`${vatAmount.toFixed(2)} PLN`} />

              <div className="mt-3 flex items-center justify-between border-t border-[#d3bb73]/10 pt-3">
                <span className="text-sm font-medium text-[#e5e4e2]">Brutto</span>
                <span className="text-xl font-bold text-[#d3bb73]">
                  {brutto.toFixed(2)} PLN
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 grid grid-cols-2 gap-3 border-t border-[#d3bb73]/20 bg-[#0f1119] p-4 md:flex md:justify-end md:px-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-3 text-sm font-medium text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10 disabled:opacity-50 md:py-2"
          >
            Anuluj
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-semibold text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50 md:py-2"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName = 'text-[#e5e4e2]',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[#e5e4e2]/55">{label}</span>
      <span className={`text-right font-medium ${valueClassName}`}>{value}</span>
    </div>
  );
}