import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Edit, Save } from 'lucide-react';
import { logChange } from '../../../helpers/logChange';

type Props = {
  eventId: string;
  eventDescription: string;
  hasLimitedAccess: boolean;
  handleSaveDescription: (description: string) => Promise<void>;
};

function EventDestailsDescriptionInner({
  eventId,
  eventDescription,
  hasLimitedAccess,
  handleSaveDescription,
}: Props) {
  // Lokalna "prawda" do renderu
  const [description, setDescription] = useState(eventDescription ?? '');
  const [editedDescription, setEditedDescription] = useState(eventDescription ?? '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  // Flaga: czy lokalnie nadpisaliśmy opis (po zapisie)
  const hasLocalOverrideRef = useRef(false);

  // Sync z propsów:
  // - jeśli NIE mamy lokalnego override -> zawsze przyjmij props
  // - jeśli MAMY override -> przyjmij props dopiero gdy będzie równy lokalnemu (czyli backend już "dogonił")
  useEffect(() => {
    const next = eventDescription ?? '';

    if (!hasLocalOverrideRef.current) {
      setDescription(next);
      if (!isEditingDescription) setEditedDescription(next);
      return;
    }

    // jeśli backend już zwrócił to co zapisaliśmy, to odblokuj sync
    if (next === description) {
      hasLocalOverrideRef.current = false;
      // (opcjonalnie) wyrównaj editedDescription
      if (!isEditingDescription) setEditedDescription(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDescription, isEditingDescription]);

  const handleSaveDescriptionClick = async () => {
    const oldDescription = description ?? '';
    const newDescription = (editedDescription ?? '').trimEnd();

    if (oldDescription === newDescription) {
      setIsEditingDescription(false);
      return;
    }

    try {
      // 1) zapis do bazy (rodzic / hook / supabase update)
      await handleSaveDescription(newDescription);

      // 2) natychmiast aktualizujemy UI lokalnie
      hasLocalOverrideRef.current = true;
      setDescription(newDescription);

      // 3) log audytu
      await logChange(
        eventId,
        'UPDATE',
        'Zmieniono opis wydarzenia',
        'description',
        oldDescription,
        newDescription,
      );

      setIsEditingDescription(false);
    } catch (err) {
      console.error('Błąd zapisu opisu:', err);
    }
  };

  const displayed = useMemo(() => description || 'Brak opisu', [description]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Opis</h2>

        {!isEditingDescription && !hasLimitedAccess && (
          <button
            onClick={() => {
              setEditedDescription(description || '');
              setIsEditingDescription(true);
            }}
            className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
          >
            <Edit className="h-4 w-4" />
          </button>
        )}
      </div>

      {isEditingDescription ? (
        <div className="space-y-3">
          <textarea
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            className="min-h-[120px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            placeholder="Dodaj opis eventu..."
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveDescriptionClick}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Save className="h-4 w-4" />
              Zapisz
            </button>
            <button
              onClick={() => setIsEditingDescription(false)}
              className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <p className="leading-relaxed whitespace-pre-wrap text-[#e5e4e2]/80">
          {displayed}
        </p>
      )}
    </div>
  );
}

// ✅ MEMO z custom compare (żeby nie renderował bez potrzeby)
export const EventDestailsDescription = React.memo(
  EventDestailsDescriptionInner,
  (prev, next) =>
    prev.eventId === next.eventId &&
    prev.eventDescription === next.eventDescription &&
    prev.hasLimitedAccess === next.hasLimitedAccess &&
    prev.handleSaveDescription === next.handleSaveDescription,
);