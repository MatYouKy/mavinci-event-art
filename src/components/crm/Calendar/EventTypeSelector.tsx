'use client';

import { Building2, User, Calendar } from 'lucide-react';

interface EventTypeSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectType: (type: 'business' | 'individual' | 'meeting') => void;
  canCreateEvents?: boolean;
}

export default function EventTypeSelector({
  isOpen,
  onClose,
  onSelectType,
  canCreateEvents = false
}: EventTypeSelectorProps) {
  if (!isOpen) return null;

  const showOnlyMeetings = !canCreateEvents;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] rounded-xl max-w-2xl w-full p-8">
        <h2 className="text-2xl font-semibold text-[#e5e4e2] mb-2">Co chcesz dodać?</h2>
        <p className="text-[#e5e4e2]/60 mb-6">
          {showOnlyMeetings
            ? 'Możesz utworzyć nowe spotkanie'
            : 'Wybierz typ wydarzenia, które chcesz utworzyć'}
        </p>

        <div className={`grid grid-cols-1 ${showOnlyMeetings ? 'md:grid-cols-1' : 'md:grid-cols-3'} gap-4`}>
          {!showOnlyMeetings && (
            <>
              <button
                onClick={() => onSelectType('business')}
                className="group relative p-6 bg-[#1c1f33] border-2 border-[#d3bb73]/10 rounded-xl hover:border-[#d3bb73] transition-all hover:scale-105"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 bg-[#d3bb73]/10 rounded-full group-hover:bg-[#d3bb73]/20 transition-colors">
                    <Building2 className="w-8 h-8 text-[#d3bb73]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">Wydarzenie biznesowe</h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      Pełne wydarzenie z organizacją/firmą
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => onSelectType('individual')}
                className="group relative p-6 bg-[#1c1f33] border-2 border-[#d3bb73]/10 rounded-xl hover:border-[#d3bb73] transition-all hover:scale-105"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 bg-[#d3bb73]/10 rounded-full group-hover:bg-[#d3bb73]/20 transition-colors">
                    <User className="w-8 h-8 text-[#d3bb73]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">Wydarzenie indywidualne</h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      Pełne wydarzenie z osobą prywatną
                    </p>
                  </div>
                </div>
              </button>
            </>
          )}

          <button
            onClick={() => onSelectType('meeting')}
            className="group relative p-6 bg-[#1c1f33] border-2 border-[#d3bb73]/10 rounded-xl hover:border-[#d3bb73] transition-all hover:scale-105"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-4 bg-[#d3bb73]/10 rounded-full group-hover:bg-[#d3bb73]/20 transition-colors">
                <Calendar className="w-8 h-8 text-[#d3bb73]" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">Spotkanie</h3>
                <p className="text-sm text-[#e5e4e2]/60">
                  Szybkie spotkanie lub przypomnienie
                </p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 px-6 py-3 border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#e5e4e2]/5 transition-colors"
        >
          Anuluj
        </button>
      </div>
    </div>
  );
}
