// Calendar days and clock times are local Europe/Warsaw values, not UTC instants.
export type SellerEventDay = { date: string; start_time: string; end_time: string };
type ScheduleValues = { event_days?: SellerEventDay[] | null; starts_at?: string | null; ends_at?: string | null };
export const MAX_SELLER_EVENT_DAYS = 31;
export const emptySellerEventDay = (date = ''): SellerEventDay => ({ date, start_time: '', end_time: '' });
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validSellerDay(day: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
export function nextSellerDay(day: string) {
  if (!validSellerDay(day)) return '';
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  const next = date.toISOString().slice(0, 10);
  return validSellerDay(next) ? next : '';
}
export const sellerDayLabel = (date: string) => date ? date.split('-').reverse().join('.') : 'Data do ustalenia';
export function sellerEventDayLabel(day: SellerEventDay) {
  if (!day.start_time && !day.end_time) return sellerDayLabel(day.date) + ' · godziny do ustalenia';
  const overnight = day.end_time < day.start_time;
  return overnight
    ? `${sellerDayLabel(day.date)}, ${day.start_time} → ${sellerDayLabel(nextSellerDay(day.date))}, ${day.end_time} (następny dzień)`
    : `${sellerDayLabel(day.date)}, ${day.start_time}–${day.end_time}`;
}
function legacyDay(values?: ScheduleValues | null): SellerEventDay | null {
  const start = values?.starts_at?.slice(0, 16);
  const end = values?.ends_at?.slice(0, 16);
  if (!start || !end) return null;
  const date = start.slice(0, 10), endDate = end.slice(0, 10);
  const start_time = start.slice(11), end_time = end.slice(11);
  if (!validSellerDay(date) || !timePattern.test(start_time) || !timePattern.test(end_time)) return null;
  if ((endDate === date && end_time > start_time) || (endDate === nextSellerDay(date) && end_time < start_time)) return { date, start_time, end_time };
  return null;
}
export function hasLegacySellerEventRange(values?: ScheduleValues | null) {
  return !values?.event_days?.length && Boolean(values?.starts_at || values?.ends_at) && !legacyDay(values);
}
export function sellerEventDaysFrom(values?: ScheduleValues | null, fallbackDate = ''): SellerEventDay[] {
  if (values?.event_days?.length) return values.event_days.map(day => ({ ...day }));
  const legacy = legacyDay(values);
  return legacy ? [legacy] : [emptySellerEventDay(fallbackDate)];
}
export function buildSellerEventSchedule(input: SellerEventDay[]) {
  const days = input.length === 1 && !input[0].date && !input[0].start_time && !input[0].end_time ? [] : input.map(day => ({ ...day }));
  let error = '';
  let previousDate = '', previousEnd = '';
  let starts_at: string | null = null, ends_at: string | null = null;
  if (days.length > MAX_SELLER_EVENT_DAYS) error = `Możesz dodać do ${MAX_SELLER_EVENT_DAYS} dni wydarzenia.`;
  for (let index = 0; index < days.length && !error; index += 1) {
    const day = days[index];
    const fail = (text: string) => { error = `Dzień ${index + 1}: ${text}`; };
    if (!validSellerDay(day.date)) { fail('wpisz poprawną datę.'); break; }
    if (previousDate && day.date <= previousDate) { fail('dni muszą mieć różne daty i być ułożone chronologicznie.'); break; }
    if (Boolean(day.start_time) !== Boolean(day.end_time)) { fail('uzupełnij obie godziny albo pozostaw obie do ustalenia.'); break; }
    if (day.start_time && (!timePattern.test(day.start_time) || !timePattern.test(day.end_time))) { fail('wpisz poprawne godziny w formacie HH:MM.'); break; }
    if (day.start_time && day.start_time === day.end_time) { fail('godzina zakończenia musi różnić się od rozpoczęcia.'); break; }
    const endDate = day.end_time < day.start_time ? nextSellerDay(day.date) : day.date;
    if (!endDate) { fail('data zakończenia wykracza poza obsługiwany zakres.'); break; }
    const start = day.start_time ? day.date + 'T' + day.start_time : null;
    const end = day.end_time ? endDate + 'T' + day.end_time : null;
    if (start && previousEnd && start < previousEnd) { fail('godziny nakładają się na poprzedni dzień wydarzenia.'); break; }
    if (index === 0) starts_at = start;
    if (index === days.length - 1) ends_at = end;
    previousDate = day.date;
    if (end) previousEnd = end;
  }
  return { days, starts_at, ends_at, error };
}
