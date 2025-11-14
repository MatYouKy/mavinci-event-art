'use client';

import { useFormikContext, FieldArray } from 'formik';
import { Plus, Trash2, Upload } from 'lucide-react';
import { uploadImage } from '@/lib/storage';

type UnitEventType =
  | 'damage'
  | 'repair'
  | 'service'
  | 'status_change'
  | 'note'
  | 'inspection'
  | 'sold';

type DraftHistory = {
  tempId?: string;
  event_type: UnitEventType;
  description: string;
  image_url: string | null;
  old_status: string | null;
  new_status: string | null;
  employee_id: string | null;
  created_at: string; // ISO
};

export function HistoryTabForm() {
  const { values, setFieldValue } = useFormikContext<any>();
  const history: DraftHistory[] = values.history ?? [];

  const addRow = () => {
    const now = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    setFieldValue('history', [
      ...history,
      {
        tempId: crypto.randomUUID(),
        event_type: 'note',
        description: '',
        image_url: null,
        old_status: null,
        new_status: null,
        employee_id: null,
        created_at: now, // bez sekund dla ładnego input[type=datetime-local]
      } as DraftHistory,
    ]);
  };

  const removeRow = (idx: number) => {
    setFieldValue(
      'history',
      history.filter((_, i: number) => i !== idx),
    );
  };

  const setAt = (idx: number, patch: Partial<DraftHistory>) => {
    const next = [...history];
    next[idx] = { ...next[idx], ...patch };
    setFieldValue('history', next);
  };

  const uploadAt = async (file: File, idx: number) => {
    if (!file) return;
    try {
      const url = await uploadImage(file, 'equipment-history');
      setAt(idx, { image_url: url });
    } catch (e) {
      alert('Błąd podczas przesyłania zdjęcia');
      console.error(e);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Historia (opcjonalnie)</h3>
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj wpis
        </button>
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#d3bb73]/20 p-8 text-center text-[#e5e4e2]/60">
          Brak wpisów historii. Dodaj pierwszy wpis, jeśli chcesz zarejestrować zdarzenia już przy
          tworzeniu sprzętu.
        </div>
      ) : (
        <FieldArray
          name="history"
          render={() => (
            <div className="space-y-3">
              {history.map((row, idx) => {
                const dtLocal = row.created_at?.slice(0, 16) ?? '';
                return (
                  <div key={row.tempId ?? idx} className="rounded-lg bg-[#0f1119] p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Typ zdarzenia</label>
                        <select
                          value={row.event_type}
                          onChange={(e) => setAt(idx, { event_type: e.target.value as UnitEventType })}
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        >
                          <option value="note">Notatka</option>
                          <option value="damage">Uszkodzenie</option>
                          <option value="repair">Naprawa</option>
                          <option value="service">Serwis</option>
                          <option value="inspection">Przegląd</option>
                          <option value="status_change">Zmiana statusu</option>
                          <option value="sold">Sprzedano</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Data i godzina</label>
                        <input
                          type="datetime-local"
                          value={dtLocal}
                          onChange={(e) => setAt(idx, { created_at: e.target.value })}
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Stary status</label>
                        <input
                          value={row.old_status ?? ''}
                          onChange={(e) => setAt(idx, { old_status: e.target.value || null })}
                          placeholder="np. available"
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Nowy status</label>
                        <input
                          value={row.new_status ?? ''}
                          onChange={(e) => setAt(idx, { new_status: e.target.value || null })}
                          placeholder="np. in_service"
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>

                      <div className="md:col-span-3">
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Opis</label>
                        <textarea
                          rows={2}
                          value={row.description}
                          onChange={(e) => setAt(idx, { description: e.target.value })}
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          placeholder="Szczegóły zdarzenia..."
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        {row.image_url ? (
                          <img
                            src={row.image_url}
                            alt="hist"
                            className="h-16 w-20 rounded-lg border border-[#d3bb73]/20 object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-20 items-center justify-center rounded-lg border border-dashed border-[#d3bb73]/20 text-xs text-[#e5e4e2]/40">
                            Brak
                          </div>
                        )}
                        <label className="flex cursor-pointer items-center gap-1 rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/80 hover:bg-[#1a2033]">
                          <Upload className="h-3 w-3" />
                          Wgraj
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void uploadAt(f, idx);
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                        title="Usuń wpis"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        />
      )}
    </div>
  );
}