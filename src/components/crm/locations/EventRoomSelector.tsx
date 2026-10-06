'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { LocationRoom } from './LocationRooms';

export function EventRoomSelector({
  locationId,
  selected,
  stage,
  onChange,
}: {
  locationId: string | null;
  selected: string[];
  stage: string | null;
  onChange: (ids: string[], stage: string | null) => void;
}) {
  const [result, setResult] = useState<{
    id: string;
    rooms: LocationRoom[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!locationId) return;
    supabase
      .from('locations')
      .select('rooms')
      .eq('id', locationId)
      .single()
      .then(({ data, error }) => {
        if (active) setResult({ id: locationId, rooms: data?.rooms || [], error: !!error });
      });
    return () => {
      active = false;
    };
  }, [locationId]);
  if (!locationId || result?.id !== locationId) return null;
  if (result.error)
    return (
      <p role="alert" className="mt-2 text-sm text-red-300">
        Nie udało się pobrać sal wybranego obiektu. Wybierz obiekt ponownie lub odśwież formularz.
      </p>
    );
  if (!result.rooms.length) return null;
  return (
    <fieldset className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-[#e5e4e2]">
      <legend className="px-1 font-medium text-[#d3bb73]">Sale realizacji</legend>
      <p className="mb-3 text-xs text-white/60">
        Wybierz używane sale, także połączone, i wskaż miejsce sceny lub DJ-a.
      </p>
      {result.rooms.map((room) => (
        <label key={room.id} className="mb-2 flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 accent-[#d3bb73]"
            checked={selected.includes(room.id)}
            onChange={(e) => {
              const ids = e.target.checked
                ? [...selected, room.id]
                : selected.filter((id) => id !== room.id);
              onChange(ids, stage && ids.includes(stage) ? stage : null);
            }}
          />
          <span>
            {room.name}
            {room.notes && <span className="block text-xs text-white/60">{room.notes}</span>}
          </span>
        </label>
      ))}
      {!!selected.length && (
        <label className="mt-3 block">
          Scena / DJ
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#250914] p-2"
            value={stage || ''}
            onChange={(e) => onChange(selected, e.target.value || null)}
          >
            <option value="">Do ustalenia</option>
            {result.rooms
              .filter((room) => selected.includes(room.id))
              .map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}
