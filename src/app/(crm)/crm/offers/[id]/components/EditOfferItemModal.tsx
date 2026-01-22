'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IOfferItem } from '../../types';

interface EditOfferItemModalProps {
  item: IOfferItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditOfferItemModal({ item, onClose, onSuccess }: EditOfferItemModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unitPrice, setUnitPrice] = useState(item.unit_price);
  const [discountPercent, setDiscountPercent] = useState(item.discount_percent);

  const handleSave = async () => {
    if (quantity <= 0) {
      showSnackbar('Ilość musi być większa od 0', 'error');
      return;
    }

    if (unitPrice < 0) {
      showSnackbar('Cena nie może być ujemna', 'error');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('offer_items')
        .update({
          quantity,
          unit_price: unitPrice,
          discount_percent: discountPercent,
        })
        .eq('id', item.id);

      if (error) throw error;

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

  const subtotal = quantity * unitPrice;
  const discountAmount = (subtotal * discountPercent) / 100;
  const total = subtotal - discountAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj pozycję</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div>
            <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">
              {item.product?.name || item.name}
            </h3>
            <p className="text-sm text-[#e5e4e2]/60">
              {item.product?.description || item.description}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Ilość *</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Cena jednostkowa (PLN) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rabat (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-[#e5e4e2]/60">Wartość brutto:</span>
              <span className="text-base text-[#e5e4e2]">{subtotal.toFixed(2)} PLN</span>
            </div>
            {discountAmount > 0 && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#e5e4e2]/60">Rabat:</span>
                <span className="text-base text-green-400">-{discountAmount.toFixed(2)} PLN</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-[#d3bb73]/10 pt-2">
              <span className="text-base font-medium text-[#e5e4e2]">Razem:</span>
              <span className="text-lg font-bold text-[#d3bb73]">{total.toFixed(2)} PLN</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
