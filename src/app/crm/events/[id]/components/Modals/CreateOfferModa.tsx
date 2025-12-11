import { supabase } from '@/lib/supabase';
import { X } from 'lucide-react';
import { useState } from 'react';

export function CreateOfferModal({
  isOpen,
  onClose,
  eventId,
  clientId,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  clientId: string;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    offer_number: '',
    valid_until: '',
    notes: '',
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    try {
      const offerData: any = {
        event_id: eventId,
        client_id: clientId,
        valid_until: formData.valid_until || null,
        notes: formData.notes || null,
        status: 'draft',
        total_amount: 0,
      };

      if (formData.offer_number.trim()) {
        offerData.offer_number = formData.offer_number;
      }

      const { data, error } = await supabase.from('offers').insert([offerData]).select();

      if (error) {
        console.error('Error creating offer:', error);
        alert('Błąd podczas tworzenia oferty: ' + error.message);
        return;
      }

      if (data && data[0]) {
        alert(`Utworzono ofertę: ${data[0].offer_number}`);
      }

      onSuccess();
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas tworzenia oferty');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Utwórz nową ofertę</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-400">
              Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np.
              OF/2025/10/001)
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer oferty</label>
            <input
              type="text"
              value={formData.offer_number}
              onChange={(e) => setFormData({ ...formData, offer_number: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Zostaw puste dla automatycznego numeru lub wpisz własny"
            />
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              System sprawdzi czy numer jest unikalny
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ważna do</label>
            <input
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Dodatkowe informacje o ofercie..."
            />
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-400">
              Po utworzeniu oferty będziesz mógł dodać do niej pozycje (atrakcje, usługi) i ustalić
              ceny.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Utwórz ofertę
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}