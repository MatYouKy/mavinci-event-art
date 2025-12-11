import { Edit, Save } from 'lucide-react';
import React, { useState } from 'react';
import { IEvent } from '../../../page';
import { supabase } from '@/lib/supabase';
import { logChange } from '../../../helpers/logChange';

interface EventDetailsNotesProps {
  event: IEvent;
  setEvent: (event: IEvent) => void;
}

export const EventDetailsNotes = ({ event, setEvent }: EventDetailsNotesProps) => {
  const [editedNotes, setEditedNotes] = useState(event.notes || '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  const handleSaveNotes = async () => {
    if (!event) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ notes: editedNotes })
        .eq('id', event.id);

      if (error) {
        console.error('Error updating notes:', error);
        alert('Błąd podczas zapisywania notatek');
        return;
      }

      setEvent({ ...event, notes: editedNotes });
      setIsEditingNotes(false);
      await logChange(
        'updated',
        'Zaktualizowano notatki eventu',
        'notes',
        event.notes,
        editedNotes,
      );
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
        {!isEditingNotes && (
          <button
            onClick={() => {
              setEditedNotes(event.notes || '');
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
        <p className="leading-relaxed text-[#e5e4e2]/80">{event.notes || 'Brak notatek'}</p>
      )}
    </div>
  );
};
