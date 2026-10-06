'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useDialog } from '@/contexts/DialogContext';
import { Pencil, Trash2 } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import {
  TechnicalDetailsEditor,
  TechnicalDetailsView,
  type TechnicalDetails,
} from './LocationTechnicalDetails';

export type LocationRoom = {
  id: string;
  name: string;
  notes?: string;
  technical?: TechnicalDetails;
};
export function LocationRooms({ locationId, readOnly = false }: { locationId: string; readOnly?: boolean }) {
  const [rooms, setRooms] = useState<LocationRoom[] | null>(null);
  const [editing, setEditing] = useState<LocationRoom | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { showConfirm } = useDialog();
  useEffect(() => {
    let active = true;
    setRooms(null);
    setEditing(null);
    setError('');
    supabase
      .from('locations')
      .select('rooms')
      .eq('id', locationId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError('Nie udało się pobrać sal obiektu.');
        else setRooms(data.rooms || []);
      });
    return () => {
      active = false;
    };
  }, [locationId]);
  const persist = async (next: LocationRoom[]) => {
    if (readOnly) throw new Error('Nie masz uprawnień do edycji sal lokalizacji.');
    const names = next.map((r) => r.name.trim().toLocaleLowerCase('pl-PL'));
    if (new Set(names).size !== names.length)
      throw new Error('Nazwy sal w obiekcie nie mogą się powtarzać.');
    const { data, error } = await supabase
      .from('locations')
      .update({ rooms: next })
      .eq('id', locationId)
      .eq('rooms', JSON.stringify(rooms))
      .select('rooms')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Lista sal zmieniła się lub nie masz uprawnień. Odśwież stronę.');
    setRooms(data.rooms);
  };
  const save = async (technical: TechnicalDetails, fields: { name: string; notes: string }) => {
    if (!editing || !rooms) return;
    const updated = { ...editing, ...fields, technical };
    await persist(
      rooms.some((r) => r.id === editing.id)
        ? rooms.map((r) => (r.id === editing.id ? updated : r))
        : [...rooms, updated],
    );
    setEditing(null);
    setError('');
  };
  const remove = async (room: LocationRoom) => {
    if (saving || !rooms) return;
    if (
      !(await showConfirm({
        title: 'Usuń salę',
        message: `Czy usunąć salę „${room.name}”? Sali przypisanej do wydarzenia nie można usunąć.`,
        confirmText: 'Usuń salę',
      }))
    )
      return;
    setSaving(true);
    setError('');
    try {
      await persist(rooms.filter((r) => r.id !== room.id));
    } catch (e: any) {
      setError(e.message || 'Nie udało się usunąć sali.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="mt-6 rounded-xl bg-[#351020] p-4 text-[#e5e4e2] sm:p-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg uppercase">Sale i pomieszczenia</h2>
        {!readOnly && rooms && !editing && (
          <button
            type="button"
            disabled={saving || rooms.length >= 100}
            className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#250914] disabled:opacity-50"
            onClick={() => setEditing({ id: crypto.randomUUID(), name: '', notes: '' })}
          >
            Dodaj salę
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-white/60">
        W wydarzeniu możesz wybrać kilka sal i wskazać miejsce sceny/DJ-a.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {!rooms ? (
        !error && <p>Ładowanie sal…</p>
      ) : rooms.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/60">
              <tr>
                <th className="px-2 py-3">Pomieszczenie</th>
                <th className="px-2 py-3">Wejście / piętro</th>
                <th className="px-2 py-3">Materiały</th>
                {!readOnly && <th className="w-12 px-2 py-3"><span className="sr-only">Akcje</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rooms.map((room) => (
                <tr key={room.id} className="align-top">
                  <td className="min-w-48 px-2 py-3">
                    <strong>{room.name}</strong>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[#d3bb73]">
                        Szczegóły i materiały
                      </summary>
                      <div className="mt-3">
                        <TechnicalDetailsView value={room.technical} />
                      </div>
                    </details>
                  </td>
                  <td className="whitespace-pre-wrap px-2 py-3">{room.notes || '—'}</td>
                  <td className="px-2 py-3">{room.technical?.assets?.length || 0}</td>
                  {!readOnly && <td className="w-12 px-2 py-3">
                    <div className="flex justify-end">
                      <ResponsiveActionBar
                        alwaysDropdown
                        compact
                        disabledBackground
                        actions={[
                          {
                            label: 'Edytuj',
                            icon: <Pencil className="h-4 w-4" />,
                            disabled: !!editing || saving,
                            onClick: () => setEditing(room),
                          },
                          {
                            label: 'Usuń',
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                            disabled: !!editing || saving,
                            onClick: () => void remove(room),
                          },
                        ]}
                      />
                    </div>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-white/50">Nie dodano jeszcze pomieszczeń.</p>
      )}
      {!readOnly && editing && (
        <div className="mt-4">
          <h3 className="font-medium">
            {rooms?.some((r) => r.id === editing.id) ? 'Edytuj salę' : 'Nowa sala'}
          </h3>
          <TechnicalDetailsEditor
            key={editing.id}
            locationId={locationId}
            initial={editing.technical}
            room={editing}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </section>
  );
}
