import { EVENT_STEP_DEFAULT_HOUR, type EventStepTone } from '@/lib/events/steps/eventSteps';

/** Kolory statusu kroku (bez obramowań — tło i kolor tekstu). */
export const EVENT_STEP_TONE_CHIP: Record<EventStepTone, string> = {
  neutral: 'bg-white/10 text-[#e5e4e2]/85',
  progress: 'bg-sky-400/15 text-sky-200',
  success: 'bg-emerald-400/15 text-emerald-200',
  danger: 'bg-red-500/20 text-red-200',
  muted: 'bg-white/5 text-[#e5e4e2]/50',
  warning: 'bg-amber-400/15 text-amber-200',
};

/** Tło całego wiersza kroku. */
export const EVENT_STEP_TONE_ROW: Record<EventStepTone, string> = {
  neutral: 'bg-white/[0.04]',
  progress: 'bg-sky-400/[0.06]',
  success: 'bg-white/[0.025]',
  danger: 'bg-red-500/[0.08]',
  muted: 'bg-white/[0.025]',
  warning: 'bg-amber-400/[0.07]',
};

export const stepInputClass =
  'mt-1 block w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-white/35 focus:border-[#d3bb73]/30 disabled:opacity-60';

const pad = (value: number) => String(value).padStart(2, '0');

/** Godzina wstawiana do pól terminu / dostawy, gdy podano samą datę (wspólna z aplikacją). */
export const EVENT_STEP_DEFAULT_TIME = `${pad(EVENT_STEP_DEFAULT_HOUR)}:00`;

/** ISO → { date: 'RRRR-MM-DD', time: 'GG:MM' } w czasie lokalnym (dla SellerDatePicker i pola godziny). */
export function isoToLocalParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: '', time: '' };
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

/** Data 'RRRR-MM-DD' + godzina 'GG:MM' (czas lokalny) → ISO; null gdy brak lub błędna data. */
export function localPartsToIso(date: string, time: string, fallbackTime = EVENT_STEP_DEFAULT_TIME): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!dateMatch) return null;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time || fallbackTime) ?? /^(\d{1,2}):(\d{2})$/.exec(fallbackTime);
  const [, year, month, day] = dateMatch.map(Number);
  const hours = timeMatch ? Number(timeMatch[1]) : EVENT_STEP_DEFAULT_HOUR;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  const value = new Date(year, month - 1, day, hours, minutes);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) return null;
  return value.toISOString();
}

/** Numer telefonu do linku tel:. */
export const telHref = (phone: string | null | undefined): string | null => {
  const digits = (phone || '').replace(/[^+0-9]/g, '');
  return digits.length >= 6 ? `tel:${digits}` : null;
};

export const formatEventDay = (value: string | null | undefined): string => {
  if (!value) return 'Termin nieustalony';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Termin nieustalony';
  return date.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
};

/** Unikalny sufiks kanału Realtime — ponowne zamontowanie nie trafia na kanał w trakcie zamykania. */
export function channelSuffix(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
