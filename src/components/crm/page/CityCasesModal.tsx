'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import ResponsiveActionBar, { Action } from '../ResponsiveActionBar';
import { Loader2, Save, Trash2, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { PolishCityCases } from '@/lib/polishCityCases';

type CityCaseRow = {
  id: string;
  city_key: string;
  nominative: string;
  genitive: string;
  locative: string;
  locative_preposition: 'w' | 'we';
  is_active?: boolean;
};

export function CityCasesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [cases, setCases] = useState<CityCaseRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newCity, setNewCity] = useState({
    city_key: '',
    nominative: '',
    genitive: '',
    locative: '',
    locative_preposition: 'w' as 'w' | 'we',
  });

  const load = async () => {
    const { data, error } = await supabase
      .from('polish_city_cases')
      .select('id, city_key, nominative, genitive, locative, locative_preposition, is_active')
      .eq('is_active', true)
      .order('city_key');
  
    if (error) {
      console.error(error);
      return;
    }
  
    setCases((data as CityCaseRow[]) || []);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  // ➕ ADD
  const handleAdd = async () => {
    if (!newCity.city_key) return;
  
    setIsSaving(true);
  
    try {
      const payload = {
        ...newCity,
        city_key: newCity.city_key.toLowerCase().trim(),
        locative_preposition: newCity.locative_preposition || 'w',
        is_active: true,
      };
  
      const { data, error } = await supabase
        .from('polish_city_cases')
        .insert(payload)
        .select();
  
      if (error) throw error;
  
      showSnackbar('Wyjątek odmiany miast dodany', 'success');
  
      setNewCity({
        city_key: '',
        nominative: '',
        genitive: '',
        locative: '',
        locative_preposition: 'w',
      });
  
      await load();
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      showSnackbar('Błąd podczas dodawania wyjątku odmiany miast', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ✏️ UPDATE
  const handleUpdate = async (city: CityCaseRow) => {
    await supabase
      .from('polish_city_cases')
      .update({
        city_key: city.city_key.toLowerCase().trim(),
        nominative: city.nominative,
        genitive: city.genitive,
        locative: city.locative,
        locative_preposition: city.locative_preposition,
      })
      .eq('id', city.id);

    setEditingId(null);
    load();
  };

  // ❌ DELETE (soft)
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setIsDeleting(true);

    try {
      const { error } = await supabase
        .from('polish_city_cases')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      await load();
      showSnackbar('Wyjątek odmiany miast usunięty', 'success');
    } catch (error) {
      console.error(error);
      showSnackbar('Błąd podczas usuwania wyjątku odmiany miast', 'error');
    } finally {
      setDeletingId(null);
      setIsDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl rounded-xl bg-[#1c1f33] p-6 text-white">
        <h2 className="mb-4 text-xl font-semibold">Wyjątki odmiany miast</h2>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="mb-6 rounded bg-[#d3bb73] px-4 py-2 text-black">
            <X className="h-4 w-4" />
            Anuluj
          </button>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="mb-6 rounded bg-[#d3bb73] px-4 py-2 text-black"
            >
              Dodaj
            </button>
          )}
        </div>
        {/* ADD */}

        {isEditing ? (
          <>
            <div className="mb-6 grid grid-cols-1 gap-2">
              <input
                placeholder="city_key (np. łódź)"
                value={newCity.city_key}
                onChange={(e) => setNewCity({ ...newCity, city_key: e.target.value })}
                className="rounded bg-[#0f1119] p-2"
              />
              <input
                placeholder="np. Wrocław"
                value={newCity.nominative}
                onChange={(e) => setNewCity({ ...newCity, nominative: e.target.value })}
                className="rounded bg-[#0f1119] p-2"
              />
              <input
                placeholder="np. Wrocławia"
                value={newCity.genitive}
                onChange={(e) => setNewCity({ ...newCity, genitive: e.target.value })}
                className="rounded bg-[#0f1119] p-2"
              />
              <input
                placeholder="Wrocławiu"
                value={newCity.locative}
                onChange={(e) => setNewCity({ ...newCity, locative: e.target.value })}
                className="rounded bg-[#0f1119] p-2"
              />
              <select
                value={newCity.locative_preposition}
                onChange={(e) =>
                  setNewCity({
                    ...newCity,
                    locative_preposition: e.target.value as 'w' | 'we',
                  })
                }
                className="rounded bg-[#0f1119] p-2"
              >
                <option value="w">w</option>
                <option value="we">we</option>
              </select>
            </div>
          </>
        ) : (
          <div className="max-h-[400px] space-y-2 overflow-y-auto">
            {cases.map((c) => {
              const isEditing = editingId === c.id;
              const isDeleting = deletingId === c.id;

              const rowActions: Action[] = [
                {
                  label: isEditing ? 'Zapisz' : 'Edytuj',

                  variant: 'primary',

                  icon: <Save className="h-4 w-4" />,

                  onClick: () => {
                    if (isEditing) {
                      handleUpdate(c);
                    } else {
                      setEditingId(c.id);
                    }
                  },
                },

                {
                  label: 'Usuń',

                  variant: 'danger',

                  icon: isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  ),
                  onClick: () => handleDelete(c.id),
                },
              ];

              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded bg-[#0f1119] p-3"
                >
                  {isEditing ? (
                    <div className="mr-4 grid w-full grid-cols-4 gap-2">
                      <input
                        value={c.city_key}
                        onChange={(e) =>
                          setCases((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, city_key: e.target.value } : x,
                            ),
                          )
                        }
                        className="rounded bg-[#1c1f33] p-1"
                      />
                      <input
                        value={c.nominative}
                        onChange={(e) =>
                          setCases((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, nominative: e.target.value } : x,
                            ),
                          )
                        }
                        className="rounded bg-[#1c1f33] p-1"
                      />
                      <input
                        value={c.genitive}
                        onChange={(e) =>
                          setCases((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, genitive: e.target.value } : x,
                            ),
                          )
                        }
                        className="rounded bg-[#1c1f33] p-1"
                      />
                      <input
                        value={c.locative}
                        onChange={(e) =>
                          setCases((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, locative: e.target.value } : x,
                            ),
                          )
                        }
                        className="rounded bg-[#1c1f33] p-1"
                      />
                    </div>
                  ) : (
                    <div>
                      {isDeleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <div className="font-medium">{c.nominative}</div>
                          <div className="text-sm text-gray-400">
                            {c.genitive} / {c.locative}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <ResponsiveActionBar
                      actions={rowActions}
                      disabledBackground
                      mobileBreakpoint={4000}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {isEditing && (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsEditing(false)}
              className="mt-6 flex items-center gap-2 rounded-lg bg-[#800020]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#800020]/30"
            >
              <X className="h-4 w-4" />
              Anuluj
            </button>
            <button
              onClick={handleAdd}
              className="mt-6 flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-black hover:bg-[#d3bb73]/90"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
