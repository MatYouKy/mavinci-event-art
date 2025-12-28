import { supabase } from '@/lib/supabase';
import { useState } from 'react';
import { Edit, Save } from 'lucide-react';
import { logChange } from '../../../helpers/logChange';
import { useEvent } from '@/app/crm/events/hooks/useEvent';
import { useParams } from 'next/navigation';

export const EventDestailsDescription = ({
  eventDescription,
  hasLimitedAccess,
  handleSaveDescription,
}: {
  eventDescription: string;
  hasLimitedAccess: boolean;
  handleSaveDescription: (description: string) => void;
}) => {
  const [editedDescription, setEditedDescription] = useState(eventDescription);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  const handleSaveDescriptionClick = async () => {
    setIsEditingDescription(false);
    await handleSaveDescription(editedDescription);
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Opis</h2>
        {!isEditingDescription && !hasLimitedAccess && (
          <button
            onClick={() => {
              setEditedDescription(eventDescription || '');
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
        <p className="leading-relaxed text-[#e5e4e2]/80">{eventDescription || 'Brak opisu'}</p>
      )}
    </div>
  );
};
