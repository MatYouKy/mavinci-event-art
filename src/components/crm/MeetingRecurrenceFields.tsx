import { MEETING_RECURRENCE_OPTIONS, meetingRecurrenceLabel } from '@/lib/meetings/recurrence';

export default function MeetingRecurrenceFields({ days, start, onChange, disabled = false }: {
  days: number;
  start: string;
  onChange: (days: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-white/[0.035] p-4">
      <label className="block text-sm text-[#e5e4e2]">
        Powtarzanie spotkania
        <select value={days} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}
          className="mt-2 w-full rounded-lg bg-[#13161f] px-3 py-2 text-sm disabled:opacity-50">
          {MEETING_RECURRENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {days > 0 && <p className="text-xs text-[#e5e4e2]/60">{meetingRecurrenceLabel(days, start)} (czas polski). Przypomnienia dotyczą każdego terminu.</p>}
      {disabled && <p className="text-xs text-[#e5e4e2]/60">Aby zmienić cykl, wybierz „To i kolejne spotkania”.</p>}
    </div>
  );
}
