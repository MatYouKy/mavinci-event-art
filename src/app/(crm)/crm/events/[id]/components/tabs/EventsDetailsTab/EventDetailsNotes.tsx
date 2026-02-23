import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Edit, Save } from 'lucide-react';

interface EventDetailsNotesProps {
  eventDetailsNotes: string;
  handleUpdateNotes: (notes: string) => Promise<void>;
}

function EventDetailsNotesInner({ eventDetailsNotes, handleUpdateNotes }: EventDetailsNotesProps) {
  const [notes, setNotes] = useState(eventDetailsNotes ?? '');
  const [editedNotes, setEditedNotes] = useState(eventDetailsNotes ?? '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Czy lokalnie nadpisaliśmy wartość po zapisie
  const hasLocalOverrideRef = useRef(false);

  // Sync z propsów (identycznie jak w opisie)
  useEffect(() => {
    const next = eventDetailsNotes ?? '';

    if (!hasLocalOverrideRef.current) {
      setNotes(next);
      if (!isEditingNotes) setEditedNotes(next);
      return;
    }

    // jeśli backend dogonił (props == lokalny stan), to odblokuj sync
    if (next === notes) {
      hasLocalOverrideRef.current = false;
      if (!isEditingNotes) setEditedNotes(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDetailsNotes, isEditingNotes]);

  const handleSaveNotes = async () => {
    const oldNotes = notes ?? '';
    const newNotes = (editedNotes ?? '').trimEnd();

    if (oldNotes === newNotes) {
      setIsEditingNotes(false);
      return;
    }

    try {
      await handleUpdateNotes(newNotes);

      // optimistic UI: od razu pokazuj zapisane notatki
      hasLocalOverrideRef.current = true;
      setNotes(newNotes);

      setIsEditingNotes(false);
    } catch (err) {
      console.error('Błąd zapisu notatek:', err);
    }
  };

  const displayed = useMemo(() => notes || 'Brak notatek', [notes]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
        {!isEditingNotes && (
          <button
            onClick={() => {
              setEditedNotes(notes);
              setIsEditingNotes(true);
            }}
            className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
          >
            <Edit className="h-4 w-4" />
          </button>
        )}
      </div>

      {isEditingNotes ? (
        <div className="space-y-3">
          <textarea
            value={editedNotes}
            onChange={(e) => setEditedNotes(e.target.value)}
            className="min-h-[120px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            placeholder="Dodaj notatki..."
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveNotes}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
            <button
              onClick={() => setIsEditingNotes(false)}
              className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <p className="leading-relaxed whitespace-pre-wrap text-[#e5e4e2]/80">{displayed}</p>
      )}
    </div>
  );
}

// ✅ memo: nie renderuj jeśli propsy się nie zmieniły
export const EventDetailsNotes = React.memo(
  EventDetailsNotesInner,
  (prev, next) =>
    prev.eventDetailsNotes === next.eventDetailsNotes &&
    prev.handleUpdateNotes === next.handleUpdateNotes,
);