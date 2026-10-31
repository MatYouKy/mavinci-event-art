// Inquiry calendar dates are Polish local dates, not UTC instants.
function calendarDate(value: unknown): string {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(parsed);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function label(day: string, time?: string | null): string {
  if (!day) return '';
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}${time ? `, ${time}` : ''}`;
}
function instantLabel(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}
function rangeLabel(start: string, end: string): string {
  if (!start || !end) return start || end;
  const startParts = /^(\d{2}\.\d{2}\.\d{4})(?:,?\s+(\d{2}:\d{2}))?$/.exec(start);
  const endParts = /^(\d{2}\.\d{2}\.\d{4})(?:,?\s+(\d{2}:\d{2}))?$/.exec(end);
  if (startParts && endParts && startParts[1] === endParts[1]) {
    if (startParts[2] && endParts[2]) return `${startParts[1]}, ${startParts[2]}–${endParts[2]}`;
    if (endParts[2]) return `${startParts[1]}, do ${endParts[2]}`;
    return start;
  }
  return `${start} – ${end}`;
}

export function resolveOfferSchedule(offer: any) {
  const details = offer.inquiry?.inquiry_details || {};
  const fromInquiry = Boolean(offer.inquiry_id || offer.inquiry?.id);
  if (fromInquiry) {
    // A follow-up task deadline is not the event date.
    const startDay = calendarDate(details.termin);
    let endDay = details.event_single_day === true ? startDay : calendarDate(details.event_end_date);
    if (!endDay && startDay && details.event_end_next_day && details.event_single_day !== true) {
      const next = new Date(`${startDay}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      endDay = next.toISOString().slice(0, 10);
    }
    if (!endDay && details.event_single_day !== false) endDay = startDay;
    const startLabel = label(startDay, details.event_start_time);
    const endLabel = details.event_end_time || (endDay && endDay !== startDay) ? label(endDay, details.event_end_time) : '';
    return { fromInquiry, startLabel, endLabel, rangeLabel: rangeLabel(startLabel, endLabel) };
  }
  const startLabel = instantLabel(offer.event_date || offer.event?.event_date);
  const endLabel = instantLabel(offer.event?.event_end_date);
  return { fromInquiry, startLabel, endLabel, rangeLabel: rangeLabel(startLabel, endLabel) };
}
