'use client';
import Link from 'next/link';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { LocationRoom } from './LocationRooms';
export function EventRooms({
  eventId,
  locationId,
  canEdit,
  editing = false,
  onClose,
}: {
  eventId: string;
  locationId: string | null;
  canEdit: boolean;
  editing?: boolean;
  onClose?: () => void;
}) {
  const [rooms, setRooms] = useState<LocationRoom[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [stage, setStage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { showSnackbar } = useSnackbar();
  const [original, setOriginal] = useState({ ids: [] as string[], stage: '' });
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError('');
    setSelected([]);
    setStage('');
    setRooms([]);
    if (!locationId) return;
    Promise.all([
      supabase.from('locations').select('rooms').eq('id', locationId).single(),
      supabase
        .from('events')
        .select('location_room_ids,stage_room_id')
        .eq('id', eventId)
        .eq('location_id', locationId)
        .single(),
    ]).then(([loc, event]) => {
      if (!active) return;
      if (loc.error || event.error) {
        setError('Nie udało się pobrać sal wydarzenia.');
        return;
      }
      setRooms(loc.data.rooms || []);
      setSelected(event.data.location_room_ids || []);
      setStage(event.data.stage_room_id || '');
      setOriginal({ ids: event.data.location_room_ids || [], stage: event.data.stage_room_id || '' });
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [eventId, locationId]);
  if (!locationId) return null;
  const save = async () => {
    if (saving || !loaded || !canEdit) return;
    setSaving(true);
    setError('');
    try {
      let query = supabase
        .from('events')
        .update({ location_room_ids: selected, stage_room_id: stage || null })
        .eq('id', eventId)
        .eq('location_id', locationId)
        .eq('location_room_ids', `{${original.ids.join(',')}}`);
      query = original.stage
        ? query.eq('stage_room_id', original.stage)
        : query.is('stage_room_id', null);
      const { data, error } = await query.select('id').maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error('Dane wydarzenia zmieniły się lub nie masz uprawnień. Odśwież stronę.');
      setOriginal({ ids: selected, stage });
      showSnackbar('Sale zapisane. Jeśli wytyczne były już wysłane, wyślij je ponownie z nowym miejscem realizacji.', 'success');
      onClose?.();
    } catch (e: any) {
      setError(e.message || 'Nie udało się zapisać sal.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={editing && canEdit ? "mt-3 rounded-lg bg-white/5 p-3 text-sm" : "mt-1 text-sm text-[#e5e4e2]/70"}>
      {editing && canEdit && <p className="mb-2 font-medium text-[#d3bb73]">Sale realizacji</p>}
      {error && (
        <p role="alert" className="mb-2 text-red-300">
          {error}
        </p>
      )}
      {!loaded ? (
        !error && <p>Ładowanie sal…</p>
      ) : canEdit && editing ? (
        <fieldset disabled={saving}>
          <p className="mb-2 text-xs text-white/60">
            Zaznacz wszystkie używane sale, także połączone. Wskaż jedną salę ze sceną lub
            stanowiskiem DJ-a.
          </p>
          {rooms.length === 0 && (
            <p className="mb-2 text-white/60">Ten obiekt nie ma jeszcze zapisanych sal.</p>
          )}
          {rooms.map((room) => (
            <div key={room.id} className="mb-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-[#d3bb73]"
                  checked={selected.includes(room.id)}
                  onChange={(e) => {
                                    setSelected(
                      e.target.checked
                        ? [...selected, room.id]
                        : selected.filter((id) => id !== room.id),
                    );
                    if (!e.target.checked && stage === room.id) setStage('');
                  }}
                />
                {room.name}
              </label>
              {selected.includes(room.id) && room.notes && (
                <p className="ml-6 text-xs text-white/60">{room.notes}</p>
              )}
            </div>
          ))}
          {selected.length > 0 && (
            <label className="mt-3 block">
              Scena / DJ
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                              }}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#250914] p-2"
              >
                <option value="">Do ustalenia</option>
                {rooms
                  .filter((r) => selected.includes(r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-[#d3bb73] px-3 py-2 text-[#250914]"
            >
              {saving ? 'Zapisywanie…' : 'Zapisz sale wydarzenia'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected([...original.ids]);
                setStage(original.stage);
                setError('');
                onClose?.();
              }}
              className="rounded-lg px-3 py-2 text-[#e5e4e2]/70 hover:bg-white/5"
            >Anuluj</button>
            <Link
              className="text-xs text-[#d3bb73] hover:underline"
              href={`/crm/locations/${locationId}`}
            >
              Zarządzaj salami obiektu
            </Link>
          </div>
        </fieldset>
      ) : (
        <div>
          {original.ids.length ? (
            <>
              <p>Sale: {rooms.filter((room) => original.ids.includes(room.id)).map((room) => room.name).join(', ') || 'Nie znaleziono zapisanych sal'}</p>
              {original.stage && <p className="text-xs text-[#e5e4e2]/50">Scena / DJ: {rooms.find((room) => room.id === original.stage)?.name || 'Nie znaleziono zapisanej sali'}</p>}
            </>
          ) : rooms.length > 0 ? (
            <p className="text-xs text-[#e5e4e2]/50">Sala: nie wskazano</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
