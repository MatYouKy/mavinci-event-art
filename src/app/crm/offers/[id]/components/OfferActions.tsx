'use client';

import { useState } from 'react';
import { Pencil, X, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface OfferActionsProps {
  offer: any;
  onUpdate: () => void;
}

export default function OfferActions({ offer, onUpdate }: OfferActionsProps) {
  const { showSnackbar } = useSnackbar();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    valid_until: offer.valid_until || '',
    notes: offer.notes || '',
    status: offer.status || 'draft',
  });

  const handleSubmit = async () => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('offers')
        .update({
          valid_until: formData.valid_until || null,
          notes: formData.notes || '',
          status: formData.status,
        })
        .eq('id', offer.id);

      if (error) throw error;

      showSnackbar('Oferta zaktualizowana', 'success');
      setIsEditing(false);
      onUpdate();
    } catch (err: any) {
      console.error('Error updating offer:', err);
      showSnackbar(err.message || 'Błąd podczas aktualizacji oferty', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Akcje</h2>
        <button
          onClick={() => setIsEditing(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edytuj ofertę
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-light text-[#e5e4e2]">Edytuj ofertę</h2>
        <button
          onClick={() => setIsEditing(false)}
          className="p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">Status</label>
          <select
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
          >
            <option value="draft">Szkic</option>
            <option value="sent">Wysłana</option>
            <option value="accepted">Zaakceptowana</option>
            <option value="rejected">Odrzucona</option>
            <option value="expired">Wygasła</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">Ważna do</label>
          <input
            type="date"
            value={formData.valid_until}
            onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
          />
        </div>

        <div>
          <label className="block text-xs text-[#e5e4e2]/60 mb-2">Notatki</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={4}
            className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50 resize-none"
            placeholder="Dodaj notatki..."
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            disabled={loading}
            className="px-4 py-2.5 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
