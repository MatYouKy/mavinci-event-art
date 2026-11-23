'use client';

import { Clock, X } from 'lucide-react';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';

/**
 * Termin wykonania zadania — dzień (kalendarz albo DD.MM.RRRR) i opcjonalna godzina w czasie polskim; bez godziny termin na cały
 * dzień (do 23:59). Zapis: `taskDueIso(day, time)` z `src/lib/CRM/tasks/taskDue.ts` (te same reguły na Macu i w aplikacji).
 */
export default function TaskDueField({ day, time, onChange, onValidityChange, label = 'Termin wykonania' }: {
  day: string;
  time: string;
  onChange: (day: string, time: string) => void;
  onValidityChange?: (valid: boolean) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <SellerDatePicker label={label} value={day} onChange={(next) => onChange(next, next ? time : '')} onValidityChange={onValidityChange} />
      {day && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]">
            <Clock className="h-4 w-4 text-[#d3bb73]" />
            <span className="text-[#e5e4e2]/60">Godzina</span>
            <input
              type="time"
              value={time}
              onChange={(event) => onChange(day, event.target.value)}
              aria-label="Godzina terminu (opcjonalnie)"
              className="bg-transparent text-[#e5e4e2] outline-none [color-scheme:dark]"
            />
          </label>
          {time && (
            <button type="button" onClick={() => onChange(day, '')} className="inline-flex items-center gap-1 text-xs text-[#e5e4e2]/50 hover:text-[#e5e4e2]">
              <X className="h-3.5 w-3.5" />Bez godziny
            </button>
          )}
          <span className="text-xs text-[#e5e4e2]/45">{time ? `Termin: do ${time}.` : 'Bez godziny — termin na cały dzień (do końca dnia).'}</span>
        </div>
      )}
    </div>
  );
}
