import { supabase } from '@/lib/supabase';
import { useState } from 'react';
import { IEvent } from '../../../page';
import { Edit, Save } from 'lucide-react';
import { logChange } from '../../../helpers/logChange';

export const EventDestailsDescription = ({
  event,
  hasLimitedAccess,
  setEvent,
}: {
  event: IEvent;
  hasLimitedAccess: boolean;
  setEvent: (event: IEvent) => void;
}) => {
  const [editedDescription, setEditedDescription] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const handleSaveDescription = async () => {
    if (!event) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ description: editedDescription })
        .eq('id', event.id);

      if (error) {
        console.error('Error updating description:', error);
        alert('Błąd podczas zapisywania opisu');
        return;
      }

      setEvent({ ...event, description: editedDescription });
      setIsEditingDescription(false);
      await logChange(
        'updated',
        'Zaktualizowano opis eventu',
        'description',
        event.description,
        editedDescription,
      );
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Opis</h2>
        {!isEditingDescription && !hasLimitedAccess && (
          <button
            onClick={() => {
              setEditedDescription(event.description || '');
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
              onClick={handleSaveDescription}
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
        <p className="leading-relaxed text-[#e5e4e2]/80">{event.description || 'Brak opisu'}</p>
      )}
    </div>
  );
};
