import 'server-only';
import type { NativeContext } from './auth';
import { sendingAccounts } from './offerActions';
import { composeEmailHtml } from './messages';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import { meetingRecurrenceLabel } from '@/lib/meetings/recurrence';

/*
 * E-maile do uczestników spoza firmy (kontakty dodane do spotkania) — jak zaproszenia w Teams / Outlooku
 * (docs/team-availability.md). Wysyła osoba, która zapisała spotkanie (CRM, Mac, telefon), ze swojej pierwszej skrzynki
 * (`sendingAccounts`) przez `send-email`, z szablonem i stopką firmy skrzynki. Każdy kontakt dostaje osobną wiadomość (adresy
 * nie są widoczne dla innych) i plik .ics do kalendarza:
 *   zaproszenie — nowe spotkanie albo nowy uczestnik spoza firmy,
 *   zmiana      — inny termin albo miejsce, przywrócone (nieodwołane) albo potwierdzone wstępne spotkanie,
 *   odwołanie   — spotkanie odwołane (status) albo usunięte,
 *   nieaktualne — kontakt usunięty z listy uczestników.
 * Spotkania cykliczne: zaproszenie do całego cyklu (nowe spotkanie albo zmiana „ten i kolejne”) ma .ics z regułą powtarzania;
 * zmiana i odwołanie pojedynczego terminu cyklu — sama treść (bez .ics, żeby nie rozbić cyklu w kalendarzu odbiorcy).
 * Dane spotkania i kontaktów — `meeting_mail_context` (prawa: organizator albo uczestnicząca osoba z „calendar_manage”;
 * po usunięciu — jeszcze 2 godziny). Notatki spotkania (wewnętrzne) nie trafiają do wiadomości.
 */

type Row = Record<string, any>;
type MailContact = { id: string; name: string; email: string | null };
type MeetingMail = {
  id: string; title: string; start: string; end: string | null; allDay: boolean; location: string | null; address: string | null;
  status: string; deleted: boolean; seriesId: string | null; recurrenceDays: number; recurrenceIndex: number | null;
  seriesEndsBefore: string | null; organizer: string | null; contacts: MailContact[];
};
/** Stan spotkania sprzed zmiany (z okna, które je zapisało): termin, miejsce, status i kontakty. */
export type MeetingBefore = { start: string; end: string | null; allDay: boolean; location: string; status: string; contactIds: string[] };
type Kind = 'invite' | 'update' | 'cancel' | 'withdrawn';
export type MeetingMailResult = {
  sent: number; skipped: string[]; failed: Array<{ name: string; error: string }>; noMailbox: boolean; message: string | null;
};

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 25;
const ZONE = 'Europe/Warsaw';
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const dayFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortFormat = new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const isoDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

const localDay = (date: Date) => isoDayFormat.format(date);
const time = (date: Date) => timeFormat.format(date);

/** Termin w treści: „wtorek, 2 grudnia 2026, 10:00–11:00”, „… (cały dzień)”, wiele dni — od – do. */
function termText(start: Date, end: Date | null, allDay: boolean) {
  const sameDay = !end || localDay(start) === localDay(end);
  if (allDay) return sameDay ? `${dayFormat.format(start)} (cały dzień)` : `${dayFormat.format(start)} – ${dayFormat.format(end!)} (całe dni)`;
  if (!end) return `${dayFormat.format(start)}, ${time(start)}`;
  if (sameDay) return `${dayFormat.format(start)}, ${time(start)}–${time(end)}`;
  return `${dayFormat.format(start)}, ${time(start)} – ${dayFormat.format(end)}, ${time(end)}`;
}

const shortTerm = (start: Date, allDay: boolean) => (allDay ? shortFormat.format(start) : `${shortFormat.format(start)}, ${time(start)}`);

export function parseMeetingBefore(value: unknown): MeetingBefore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Row;
  if (Number.isNaN(Date.parse(text(row.start)))) return null;
  return {
    start: text(row.start),
    end: row.end && !Number.isNaN(Date.parse(text(row.end))) ? text(row.end) : null,
    allDay: row.allDay === true,
    location: text(row.location).trim(),
    status: ['tentative', 'confirmed', 'cancelled'].includes(text(row.status)) ? text(row.status) : 'confirmed',
    contactIds: (Array.isArray(row.contactIds) ? row.contactIds : []).map(text).filter((id: string) => UUID.test(id)).slice(0, 200),
  };
}

function parseContext(row: Row): MeetingMail {
  return {
    id: text(row.id),
    title: text(row.title) || 'Spotkanie',
    start: text(row.start),
    end: row.end ? text(row.end) : null,
    allDay: row.allDay === true,
    location: row.location ? text(row.location) : null,
    address: row.address ? text(row.address) : null,
    status: text(row.status) || 'confirmed',
    deleted: row.deleted === true,
    seriesId: row.seriesId ? text(row.seriesId) : null,
    recurrenceDays: Number(row.recurrenceDays) || 0,
    recurrenceIndex: row.recurrenceIndex == null ? null : Number(row.recurrenceIndex),
    seriesEndsBefore: row.seriesEndsBefore ? text(row.seriesEndsBefore) : null,
    organizer: row.organizer ? text(row.organizer) : null,
    contacts: (Array.isArray(row.contacts) ? row.contacts : []).map((contact: Row) => ({
      id: text(contact.id), name: text(contact.name) || 'Kontakt', email: contact.email ? text(contact.email).trim() : null,
    })),
  };
}

// MARK: Plik .ics (RFC 5545)

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsStamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsDate = (date: Date) => localDay(date).replace(/-/g, '');

/** Linie najwyżej 75 bajtów (UTF-8), kontynuacja od spacji. */
function fold(line: string) {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function nextDay(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildIcs(meeting: MeetingMail, method: 'REQUEST' | 'CANCEL', options: {
  series: boolean; organizer: { name: string; email: string }; attendee: MailContact;
}) {
  const start = new Date(meeting.start);
  const end = meeting.end ? new Date(meeting.end) : new Date(start.getTime() + 60 * 60 * 1000);
  const uid = options.series && meeting.seriesId ? `series-${meeting.seriesId}@mavinci.pl` : `meeting-${meeting.id}@mavinci.pl`;
  // Kolejna wersja zaproszenia zastępuje poprzednią w kalendarzu odbiorcy (SEQUENCE rośnie z czasem wysyłki).
  const sequence = Math.max(0, Math.floor(Date.now() / 1000) - 1_767_225_600);
  const location = [meeting.location, meeting.address].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//MAVINCI//CRM//PL',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    ...(meeting.allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${nextDay(localDay(end))}`]
      : [`DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`]),
    ...(options.series && meeting.recurrenceDays > 0
      ? [`RRULE:FREQ=DAILY;INTERVAL=${meeting.recurrenceDays}${meeting.seriesEndsBefore
        ? `;UNTIL=${icsStamp(new Date(new Date(meeting.seriesEndsBefore).getTime() - 1000))}` : ''}`]
      : []),
    `SUMMARY:${icsText(meeting.title)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    `ORGANIZER;CN=${icsText(options.organizer.name)}:mailto:${options.organizer.email}`,
    `ATTENDEE;CN=${icsText(options.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${options.attendee.email}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : meeting.status === 'tentative' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// MARK: Treść

function compose(kind: Kind, meeting: MeetingMail, before: MeetingBefore | null, options: { cycle: boolean; futureScope: boolean; ics: boolean }) {
  const start = new Date(meeting.start);
  const end = meeting.end ? new Date(meeting.end) : null;
  const term = termText(start, end, meeting.allDay);
  const place = [meeting.location, meeting.address].filter(Boolean).join(', ');
  const title = meeting.title;
  const short = shortTerm(start, meeting.allDay);
  const lines: string[] = ['Dzień dobry,', ''];
  let subject = '';
  if (kind === 'invite') {
    subject = `Zaproszenie: ${title} — ${short}`;
    lines.push(`zapraszamy na spotkanie „${title}”.`, '', `Termin: ${term}`);
    if (options.cycle) lines.push(`Powtarzanie: ${meetingRecurrenceLabel(meeting.recurrenceDays, meeting.start).toLowerCase()}`);
    if (place) lines.push(`Miejsce: ${place}`);
    if (meeting.organizer) lines.push(`Organizator: ${meeting.organizer}`);
    if (meeting.status === 'tentative') lines.push('', 'Termin jest wstępny — potwierdzimy go w osobnej wiadomości.');
    if (options.ics) lines.push('', 'W załączniku zaproszenie do kalendarza (plik .ics).');
  } else if (kind === 'update') {
    subject = `Zmiana spotkania: ${title} — ${short}`;
    lines.push(`zmieniły się szczegóły spotkania „${title}”.`, '');
    const timeChanged = before && !sameMoment(before, meeting);
    lines.push(`Termin: ${term}`);
    if (timeChanged && before) lines.push(`(wcześniej: ${termText(new Date(before.start), before.end ? new Date(before.end) : null, before.allDay)})`);
    if (options.cycle) lines.push(`Powtarzanie: ${meetingRecurrenceLabel(meeting.recurrenceDays, meeting.start).toLowerCase()}`);
    if (place) lines.push(`Miejsce: ${place}`);
    if (before && normalize(before.location) !== normalize(meeting.location || '') && before.location) lines.push(`(wcześniej: ${before.location})`);
    if (before?.status === 'cancelled') lines.push('', 'Spotkanie nie jest już odwołane — odbędzie się w podanym terminie.');
    else if (before?.status === 'tentative' && meeting.status === 'confirmed') lines.push('', 'Termin jest potwierdzony.');
    else if (meeting.status === 'tentative') lines.push('', 'Termin jest wstępny — potwierdzimy go w osobnej wiadomości.');
    if (options.ics) lines.push('', 'W załączniku zaktualizowane zaproszenie do kalendarza (plik .ics).');
  } else if (kind === 'cancel') {
    subject = `Odwołane spotkanie: ${title} — ${short}`;
    lines.push(`spotkanie „${title}” zaplanowane na ${term} zostało odwołane.`);
    if (options.futureScope && meeting.seriesId) lines.push('Odwołane są także kolejne terminy tego cyklu.');
    lines.push('', 'Przepraszamy za zmianę planów.');
  } else {
    subject = `Zaproszenie nieaktualne: ${title} — ${short}`;
    lines.push(`zaproszenie na spotkanie „${title}” (${term}) jest już nieaktualne.`);
  }
  lines.push('', 'Z pozdrowieniami');
  return { subject, text: lines.join('\n') };
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const moment = (value: string | null) => (value ? new Date(value).getTime() : null);
const sameMoment = (before: MeetingBefore, meeting: MeetingMail) =>
  moment(before.start) === moment(meeting.start) && moment(before.end) === moment(meeting.end) && before.allDay === meeting.allDay;

// MARK: Wysyłka

/**
 * Wiadomości po zapisie albo usunięciu spotkania: `before` — stan sprzed zmiany (brak = nowe spotkanie), `scope` — zakres zmiany
 * w cyklu („future” — ten i kolejne terminy). Zwraca liczbę wysłanych, kontakty bez adresu i błędy (zapis spotkania już się udał).
 */
export async function notifyMeetingContacts(
  ctx: NativeContext, accessToken: string, meetingId: string, before: MeetingBefore | null, scope: 'single' | 'future',
): Promise<MeetingMailResult> {
  const { data, error } = await ctx.supabase.rpc('meeting_mail_context', { p_meeting_id: meetingId });
  if (error) throw Object.assign(new Error(error.message || 'Nie udało się przygotować wiadomości.'), { status: error.code === '42501' ? 403 : 400 });
  const meeting = parseContext((data || {}) as Row);
  const current = new Map(meeting.contacts.map((contact) => [contact.id, contact]));
  const plan: Array<{ kind: Kind; contact: MailContact }> = [];

  if (meeting.deleted || (meeting.status === 'cancelled' && before?.status !== 'cancelled')) {
    for (const contact of meeting.contacts) plan.push({ kind: 'cancel', contact });
  } else if (meeting.status !== 'cancelled') {
    const known = new Set(before?.contactIds ?? []);
    const changed = !!before && (!sameMoment(before, meeting) || normalize(before.location) !== normalize(meeting.location || '')
      || before.status === 'cancelled' || (before.status === 'tentative' && meeting.status === 'confirmed'));
    for (const contact of meeting.contacts) {
      if (!before || !known.has(contact.id)) plan.push({ kind: 'invite', contact });
      else if (changed) plan.push({ kind: 'update', contact });
    }
    const removed = [...known].filter((id) => !current.has(id));
    if (removed.length) {
      const { data: rows, error: contactsError } = await ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email')
        .in('id', removed.slice(0, MAX_RECIPIENTS));
      if (contactsError) throw contactsError;
      for (const row of (rows || []) as Row[]) {
        plan.push({
          kind: 'withdrawn',
          contact: {
            id: text(row.id),
            name: text(row.full_name).trim() || `${text(row.first_name)} ${text(row.last_name)}`.trim() || 'Kontakt',
            email: text(row.email).trim() || null,
          },
        });
      }
    }
  }

  const result: MeetingMailResult = { sent: 0, skipped: [], failed: [], noMailbox: false, message: null };
  const deliverable = plan.filter(({ contact }) => {
    if (contact.email && EMAIL.test(contact.email)) return true;
    result.skipped.push(contact.name);
    return false;
  }).slice(0, MAX_RECIPIENTS);
  if (!deliverable.length) {
    result.message = plan.length ? 'Osoby spoza firmy nie mają adresu e-mail — wiadomość nie została wysłana.' : null;
    return result;
  }

  const accounts = await sendingAccounts(ctx).catch(() => []);
  const account = accounts[0];
  if (!account) {
    result.noMailbox = true;
    result.message = 'Nie masz skrzynki pocztowej w CRM — e-mail do osób spoza firmy nie został wysłany.';
    return result;
  }
  const organizer = { name: text(account.from_name).trim() || `${ctx.employee.name} ${ctx.employee.surname}`.trim() || 'MAVINCI', email: account.email_address };
  const cycleInvite = !!meeting.seriesId && meeting.recurrenceDays > 0 && (!before || scope === 'future');
  const htmlCache = new Map<Kind, { subject: string; html: string; ics: boolean }>();

  for (const { kind, contact } of deliverable) {
    // .ics: spotkanie bez cyklu — zawsze; cykl — tylko zaproszenie do całego cyklu (reguła powtarzania).
    const ics = !meeting.seriesId || (kind === 'invite' && cycleInvite);
    let prepared = htmlCache.get(kind);
    if (!prepared) {
      const content = compose(kind, meeting, before, { cycle: cycleInvite && kind !== 'cancel' && kind !== 'withdrawn', futureScope: scope === 'future', ics });
      const html = await composeEmailHtml(ctx.supabase, {
        employeeId: ctx.employee.id, accountId: account.id, subject: content.subject, text: content.text,
      });
      prepared = { subject: content.subject, html, ics };
      htmlCache.set(kind, prepared);
    }
    const method = kind === 'cancel' || kind === 'withdrawn' ? 'CANCEL' : 'REQUEST';
    const attachments = prepared.ics ? [{
      filename: method === 'CANCEL' ? 'odwolanie.ics' : 'zaproszenie.ics',
      content: Buffer.from(buildIcs(meeting, method, { series: cycleInvite, organizer, attendee: contact }), 'utf8').toString('base64'),
      contentType: `text/calendar; charset=utf-8; method=${method}`,
      contentDisposition: 'attachment' as const,
    }] : [];
    try {
      await dispatchCrmEmail({
        accessToken,
        functionName: 'send-email',
        payload: { emailAccountId: account.id, to: contact.email, subject: prepared.subject, body: prepared.html, attachments },
      });
      result.sent += 1;
    } catch (cause) {
      result.failed.push({ name: contact.name, error: cause instanceof Error ? cause.message : 'Nie udało się wysłać wiadomości.' });
    }
  }
  const parts: string[] = [];
  if (result.sent) parts.push(`E-mail do osób spoza firmy: wysłano ${result.sent}.`);
  if (result.skipped.length) parts.push(`Bez adresu e-mail: ${result.skipped.join(', ')}.`);
  if (result.failed.length) parts.push(`Nie wysłano: ${result.failed.map((item) => item.name).join(', ')} (${result.failed[0].error}).`);
  result.message = parts.join(' ') || null;
  return result;
}
