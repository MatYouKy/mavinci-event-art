export const MEETING_RECURRENCE_OPTIONS = [
  { value: 0, label: 'Nie powtarzaj' },
  { value: 1, label: 'Codziennie' },
  { value: 7, label: 'Co tydzień' },
  { value: 14, label: 'Co dwa tygodnie' },
];

export function meetingRecurrenceLabel(days: number, start?: string | null): string {
  const label = MEETING_RECURRENCE_OPTIONS.find((option) => option.value === days)?.label || 'Nie powtarzaj';
  if (!days || !start || Number.isNaN(new Date(start).getTime())) return label;
  const date = new Date(start);
  const time = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const weekday = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'long' }).format(date);
  return days === 1 ? `${label} o ${time}` : `${label} · ${weekday}, ${time}`;
}
