'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IOfferItem } from '../../types';


interface EditOfferItemModalProps {
  item: IOfferItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditOfferItemModal({
  item,
  onClose,
  onSuccess,
}: EditOfferItemModalProps) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj pozycję</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-2">
              {item.product?.name || item.name}
            </h3>
            <p className="text-sm text-[#e5e4e2]/60">
              {item.product?.description || item.description}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Ilość *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Cena jednostkowa (PLN) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
                className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Rabat (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={discountPercent}
                onChange={(e) =>
                  setDiscountPercent(parseFloat(e.target.value) || 0)
                }
                className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-[#e5e4e2]/60">Wartość brutto:</span>
              <span className="text-base text-[#e5e4e2]">
                {subtotal.toFixed(2)} PLN
              </span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-[#e5e4e2]/60">Rabat:</span>
                <span className="text-base text-green-400">
                  -{discountAmount.toFixed(2)} PLN
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-[#d3bb73]/10">
              <span className="text-base font-medium text-[#e5e4e2]">
                Razem:
              </span>
              <span className="text-lg font-bold text-[#d3bb73]">
                {total.toFixed(2)} PLN
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/10 rounded-lg transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 font-medium"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
