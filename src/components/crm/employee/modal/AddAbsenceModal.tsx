import { supabase } from '@/lib/supabase/browser';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useState } from 'react';

interface AddAbsenceModalProps {
  employeeId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddAbsenceModal: React.FC<AddAbsenceModalProps> = ({
  employeeId,
  onClose,
  onSuccess,
}) => {
  const [formData, setFormData] = useState({
    absence_type: 'vacation',
    start_date: '',
    end_date: '',
    all_day: true,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee } = useCurrentEmployee();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { error } = await supabase.from('employee_absences').insert({
        employee_id: employeeId,
        absence_type: formData.absence_type,
        start_date: formData.start_date,
        end_date: formData.end_date,
        all_day: formData.all_day,
        notes: formData.notes || null,
        approval_status: 'pending',
        created_by: currentEmployee?.id,
      });

      if (error) throw error;
      showSnackbar('Wniosek o nieobecność został złożony', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error creating absence:', error);
      showSnackbar('Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-6 text-xl font-light text-[#e5e4e2]">Dodaj nieobecność</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/80">Typ nieobecności</label>
            <select
              value={formData.absence_type}
              onChange={(e) => setFormData({ ...formData, absence_type: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              required
            >
              <option value="vacation">Urlop wypoczynkowy</option>
              <option value="sick_leave">Zwolnienie lekarskie</option>
              <option value="unpaid_leave">Urlop bezpłatny</option>
              <option value="training">Szkolenie</option>
              <option value="remote_work">Praca zdalna</option>
              <option value="other">Inne</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/80">Data rozpoczęcia</label>
              <input
                type="datetime-local"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/80">Data zakończenia</label>
              <input
                type="datetime-local"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="all_day"
              checked={formData.all_day}
              onChange={(e) => setFormData({ ...formData, all_day: e.target.checked })}
              className="h-4 w-4 rounded border-[#d3bb73]/30"
            />
            <label htmlFor="all_day" className="text-sm text-[#e5e4e2]/80">
              Cały dzień
            </label>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/80">Notatki (opcjonalnie)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
              disabled={saving}
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
