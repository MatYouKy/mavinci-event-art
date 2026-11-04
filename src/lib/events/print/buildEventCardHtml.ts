/**
 * Karta imprezy — wydruk dla kierownika imprezy: co, dla kogo, gdzie, kiedy, z kim,
 * kontakty, harmonogram, auta i trasy, zespół, podwykonawcy, sprzęt, przygotowanie i wytyczne.
 * Bez cen i kwot (karta trafia do zespołu realizacji).
 */

export const EVENT_CARD_TEMPLATE_VERSION = '2026-11-04.1';

export type EventCardPerson = {
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
};

export type EventCardScheduleRow = {
  /** Data i godzina rozpoczęcia (ISO albo YYYY-MM-DD HH:mm). */
  start?: string | null;
  end?: string | null;
  title: string;
  details?: string | null;
  /** Kto odpowiada / kto bierze udział. */
  people?: string | null;
  kind?: 'agenda' | 'phase' | 'logistics' | 'milestone';
};

export type EventCardVehicle = {
  name: string;
  registration?: string | null;
  driver?: EventCardPerson | null;
  passengers: EventCardPerson[];
  departure?: { place?: string | null; time?: string | null } | null;
  arrival?: { place?: string | null; time?: string | null } | null;
  returnTime?: string | null;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  notes?: string | null;
};

export type EventCardEquipment = {
  group?: string | null;
  name: string;
  quantity?: number | null;
  unit?: string | null;
  notes?: string | null;
};

export type EventCardPreparation = {
  label: string;
  dueDate?: string | null;
  status?: string | null;
  owner?: string | null;
  urgent?: boolean;
};

export type EventCardSubcontractor = {
  company: string;
  scope?: string | null;
  contact?: EventCardPerson | null;
  when?: string | null;
};

export type EventCardData = {
  companyLogoUrl?: string | null;
  companyName?: string | null;
  website?: string | null;
  generatedAt: string;
  generatedBy?: string | null;
  event: {
    name: string;
    number?: string | null;
    status?: string | null;
    category?: string | null;
    start?: string | null;
    end?: string | null;
    guests?: number | null;
    description?: string | null;
  };
  manager?: EventCardPerson | null;
  client?: {
    name?: string | null;
    contacts: EventCardPerson[];
  } | null;
  venue?: {
    name?: string | null;
    address?: string | null;
    mapUrl?: string | null;
    contacts: EventCardPerson[];
    notes?: string | null;
  } | null;
  schedule: EventCardScheduleRow[];
  team: EventCardPerson[];
  vehicles: EventCardVehicle[];
  subcontractors: EventCardSubcontractor[];
  equipment: EventCardEquipment[];
  preparation: EventCardPreparation[];
  guidelines: Array<{ title: string; text: string }>;
  files?: Array<{ name: string; folder?: string | null }>;
  /** Informacje o pominiętych sekcjach (np. brak uprawnień do danych), widoczne na karcie. */
  notices?: string[];
};

const esc = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/** Data i godzina w strefie Europe/Warsaw (wydruk na serwerze w UTC nie przesuwa godzin). */
function parts(value?: string | null) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return { y, m, d, time: '', weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => fmt.find((part) => part.type === type)?.value || '';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), time: `${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateLabel = (value?: string | null) => {
  const p = parts(value);
  return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : '';
};
const timeLabel = (value?: string | null) => parts(value)?.time || '';
const dateTimeLabel = (value?: string | null) => {
  const p = parts(value);
  if (!p) return '';
  return `${pad(p.d)}.${pad(p.m)}.${p.y}${p.time ? `, ${p.time}` : ''}`;
};

function rangeLabel(start?: string | null, end?: string | null) {
  const a = parts(start);
  const b = parts(end);
  if (!a) return '';
  const startText = `${a.weekday} ${pad(a.d)}.${pad(a.m)}.${a.y}${a.time ? `, ${a.time}` : ''}`;
  if (!b) return startText;
  const sameDay = a.y === b.y && a.m === b.m && a.d === b.d;
  return sameDay
    ? `${startText}${b.time ? ` – ${b.time}` : ''}`
    : `${startText} – ${b.weekday} ${pad(b.d)}.${pad(b.m)}.${b.y}${b.time ? `, ${b.time}` : ''}`;
}

const phoneHtml = (phone?: string | null) =>
  phone ? `<span class="phone">${esc(phone)}</span>` : '<span class="missing">brak telefonu</span>';

const durationLabel = (minutes?: number | null) => {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

const personLine = (person: EventCardPerson) => `
  <div class="person">
    <div class="person-name">${esc(person.name)}${person.role ? `<span class="person-role">${esc(person.role)}</span>` : ''}</div>
    <div class="person-contact">${phoneHtml(person.phone)}${person.email ? `<span class="email">${esc(person.email)}</span>` : ''}</div>
    ${person.note ? `<div class="person-note">${esc(person.note)}</div>` : ''}
  </div>`;

export function buildEventCardHtml(data: EventCardData): string {
  const { event } = data;
  const range = rangeLabel(event.start, event.end);

  // Telefony w jednym miejscu: kto, w jakiej roli, numer.
  const phoneBook: Array<EventCardPerson & { group: string }> = [];
  const seen = new Set<string>();
  const addPhone = (group: string, person?: EventCardPerson | null) => {
    if (!person?.name) return;
    const key = `${person.name}|${person.phone || ''}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    phoneBook.push({ ...person, group });
  };
  addPhone('Kierownik imprezy', data.manager);
  data.client?.contacts.forEach((person) => addPhone('Klient', person));
  data.venue?.contacts.forEach((person) => addPhone('Miejsce', person));
  data.vehicles.forEach((vehicle) => addPhone(`Kierowca · ${vehicle.name}`, vehicle.driver));
  data.subcontractors.forEach((sub) => addPhone(`Podwykonawca · ${sub.company}`, sub.contact));

  const schedule = [...data.schedule].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  let lastDay = '';
  const scheduleRows = schedule
    .map((row) => {
      const day = dateLabel(row.start);
      const dayRow = day && day !== lastDay ? `<tr class="day"><td colspan="3">${esc(parts(row.start)?.weekday || '')} ${esc(day)}</td></tr>` : '';
      lastDay = day || lastDay;
      const time = timeLabel(row.start);
      const end = timeLabel(row.end);
      return `${dayRow}<tr class="kind-${row.kind || 'agenda'}">
        <td class="time">${esc(time)}${end ? `<span class="muted"> – ${esc(end)}</span>` : ''}</td>
        <td><div class="strong">${esc(row.title)}</div>${row.details ? `<div class="muted small pre">${esc(row.details)}</div>` : ''}</td>
        <td class="small">${esc(row.people || '')}</td>
      </tr>`;
    })
    .join('');

  const vehiclesHtml = data.vehicles
    .map((vehicle) => `
      <div class="vehicle keep">
        <div class="vehicle-head">
          <div class="vehicle-name">${esc(vehicle.name)}${vehicle.registration ? `<span class="plate">${esc(vehicle.registration)}</span>` : ''}</div>
          <div class="vehicle-route">
            ${vehicle.departure?.time || vehicle.departure?.place ? `<span><span class="label">Wyjazd</span> ${esc(dateTimeLabel(vehicle.departure?.time))}${vehicle.departure?.place ? ` · ${esc(vehicle.departure.place)}` : ''}</span>` : ''}
            ${vehicle.arrival?.time || vehicle.arrival?.place ? `<span><span class="label">Na miejscu</span> ${esc(dateTimeLabel(vehicle.arrival?.time))}${vehicle.arrival?.place ? ` · ${esc(vehicle.arrival.place)}` : ''}</span>` : ''}
            ${vehicle.returnTime ? `<span><span class="label">Powrót</span> ${esc(dateTimeLabel(vehicle.returnTime))}</span>` : ''}
            ${vehicle.distanceKm || vehicle.durationMinutes ? `<span><span class="label">Trasa</span> ${vehicle.distanceKm ? `${esc(Math.round(vehicle.distanceKm))} km` : ''}${vehicle.distanceKm && vehicle.durationMinutes ? ' · ' : ''}${esc(durationLabel(vehicle.durationMinutes))}</span>` : ''}
          </div>
        </div>
        <div class="vehicle-people">
          <div>
            <div class="label">Kierowca</div>
            ${vehicle.driver ? personLine(vehicle.driver) : '<div class="missing">Nie przypisano kierowcy</div>'}
          </div>
          <div>
            <div class="label">Jadą razem</div>
            ${vehicle.passengers.length ? vehicle.passengers.map(personLine).join('') : '<div class="muted">—</div>'}
          </div>
        </div>
        ${vehicle.notes ? `<div class="vehicle-notes pre">${esc(vehicle.notes)}</div>` : ''}
      </div>`)
    .join('');

  const equipmentGroups = new Map<string, EventCardEquipment[]>();
  for (const item of data.equipment) {
    const group = item.group || 'Sprzęt';
    equipmentGroups.set(group, [...(equipmentGroups.get(group) || []), item]);
  }
  const equipmentHtml = [...equipmentGroups.entries()]
    .map(([group, items]) => `
      <tbody class="keep">
        <tr class="group"><td colspan="4">${esc(group)}</td></tr>
        ${items
          .map((item) => `<tr>
            <td class="check"><span class="box"></span></td>
            <td>${esc(item.name)}${item.notes ? `<div class="muted small">${esc(item.notes)}</div>` : ''}</td>
            <td class="num">${item.quantity != null ? esc(item.quantity) : ''}</td>
            <td class="small muted">${esc(item.unit || 'szt.')}</td>
          </tr>`)
          .join('')}
      </tbody>`)
    .join('');

  const section = (title: string, body: string, extraClass = '') =>
    body ? `<section class="section ${extraClass}"><h2>${esc(title)}</h2>${body}</section>` : '';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8" />
<title>Karta imprezy — ${esc(event.name)}</title>
<style>
  /*invoice-print-fonts*/
  @page { size: A4; margin: 12mm 12mm 16mm; }
  :root { --ink: #111827; --text: #1f2937; --muted: #6b7280; --line: #e5e7eb; --panel: #f6f7f9; --warn: #92400e; --warn-bg: #fffbeb; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 8.8pt; line-height: 1.42; color: var(--text); font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow-wrap: anywhere; }
  h1, h2, h3 { margin: 0; color: var(--ink); }
  h2 { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1.5px solid var(--ink); break-after: avoid; page-break-after: avoid; }
  .muted { color: var(--muted); }
  .small { font-size: 7.8pt; }
  .strong { font-weight: 600; color: var(--ink); }
  .pre { white-space: pre-wrap; }
  .num { text-align: right; white-space: nowrap; }
  .keep { break-inside: avoid; page-break-inside: avoid; }
  .missing { color: var(--warn); font-size: 7.8pt; }
  .label { display: inline-block; font-size: 6.8pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-right: 4px; }

  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 12px; border-bottom: 2px solid var(--ink); }
  .logo { display: block; max-width: 52mm; max-height: 16mm; object-fit: contain; object-position: left center; }
  .doc-title { text-align: right; }
  .doc-kind { font-size: 8pt; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .doc-name { margin-top: 2px; font-size: 17pt; font-weight: 700; line-height: 1.15; color: var(--ink); }
  .doc-when { margin-top: 4px; font-size: 9.5pt; font-weight: 600; color: var(--ink); }
  .doc-meta { margin-top: 3px; font-size: 7.5pt; color: var(--muted); }

  .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .fact { background: var(--panel); border-radius: 6px; padding: 8px 10px; }
  .fact .value { margin-top: 2px; font-weight: 600; color: var(--ink); }
  .fact .sub { margin-top: 2px; font-size: 7.8pt; color: var(--text); }

  .section { margin-top: 16px; }
  .notice { margin-top: 10px; padding: 7px 10px; border-radius: 6px; background: var(--warn-bg); color: var(--warn); font-size: 7.8pt; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { text-align: left; font-size: 6.8pt; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--line); }
  td { padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr.day td { background: var(--panel); font-weight: 700; color: var(--ink); text-transform: capitalize; padding: 4px 6px; }
  tr.group td { background: var(--panel); font-weight: 600; color: var(--ink); padding: 4px 6px; }
  td.time { font-weight: 600; color: var(--ink); white-space: nowrap; }
  tr.kind-logistics td.time, tr.kind-milestone td.time { color: var(--warn); }
  td.check { width: 7mm; }
  .box { display: inline-block; width: 3.2mm; height: 3.2mm; border: 1px solid #9ca3af; border-radius: 1px; }

  .phonebook { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
  .phonebook .row { display: grid; grid-template-columns: 30mm minmax(0, 1fr) auto; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--line); align-items: baseline; }
  .phonebook .group { font-size: 7pt; color: var(--muted); }
  .phone { font-weight: 600; color: var(--ink); white-space: nowrap; }
  .email { margin-left: 8px; color: var(--muted); font-size: 7.8pt; }

  .vehicle { background: var(--panel); border-radius: 8px; padding: 9px 11px; margin-bottom: 8px; }
  .vehicle-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .vehicle-name { font-size: 10pt; font-weight: 700; color: var(--ink); }
  .plate { margin-left: 8px; padding: 1px 6px; border-radius: 4px; background: #fff; font-size: 8pt; font-weight: 600; letter-spacing: 0.05em; }
  .vehicle-route { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 8pt; }
  .vehicle-people { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 14px; margin-top: 6px; }
  .vehicle-notes { margin-top: 6px; font-size: 7.8pt; }
  .person { padding: 2px 0; }
  .person-name { font-weight: 600; color: var(--ink); }
  .person-role { margin-left: 6px; font-weight: 400; color: var(--muted); font-size: 7.8pt; }
  .person-note { font-size: 7.5pt; color: var(--muted); }

  .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
  .guideline { padding: 6px 0; border-bottom: 1px solid var(--line); }
  .guideline-title { font-weight: 600; color: var(--ink); }
  .prep-urgent td:first-child { color: var(--warn); font-weight: 600; }

  .signoff { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 10px; }
  .signoff .slot { padding-top: 26px; border-bottom: 1px solid #9ca3af; }
  .signoff .caption { margin-top: 3px; font-size: 7pt; color: var(--muted); }
  .notes-lines div { height: 7mm; border-bottom: 1px solid var(--line); }
</style>
</head>
<body>
  <header class="doc-header">
    <div>${data.companyLogoUrl ? `<img class="logo" src="${esc(data.companyLogoUrl)}" alt="Logo" />` : `<div class="strong">${esc(data.companyName || '')}</div>`}</div>
    <div class="doc-title">
      <div class="doc-kind">Karta imprezy</div>
      <div class="doc-name">${esc(event.name)}</div>
      ${range ? `<div class="doc-when">${esc(range)}</div>` : ''}
      <div class="doc-meta">${[event.number, event.category, event.status].filter(Boolean).map(esc).join(' · ')}</div>
    </div>
  </header>

  <div class="facts keep">
    <div class="fact"><div class="label">Kierownik imprezy</div><div class="value">${esc(data.manager?.name || '—')}</div><div class="sub">${data.manager ? phoneHtml(data.manager.phone) : '<span class="missing">Nie wskazano</span>'}</div></div>
    <div class="fact"><div class="label">Dla kogo</div><div class="value">${esc(data.client?.name || '—')}</div><div class="sub">${data.client?.contacts[0] ? `${esc(data.client.contacts[0].name)} · ${phoneHtml(data.client.contacts[0].phone)}` : ''}</div></div>
    <div class="fact"><div class="label">Gdzie</div><div class="value">${esc(data.venue?.name || '—')}</div><div class="sub">${esc(data.venue?.address || '')}</div></div>
    <div class="fact"><div class="label">Kiedy</div><div class="value">${esc(dateLabel(event.start) || '—')}</div><div class="sub">${esc([timeLabel(event.start), timeLabel(event.end)].filter(Boolean).join(' – '))}${event.guests ? ` · ${esc(event.guests)} gości` : ''}</div></div>
  </div>

  ${(data.notices || []).map((text) => `<div class="notice">${esc(text)}</div>`).join('')}

  ${section('Telefony', phoneBook.length ? `<div class="phonebook">${phoneBook.map((person) => `
    <div class="row keep"><span class="group">${esc(person.group)}</span><span><span class="strong">${esc(person.name)}</span>${person.role && person.role !== person.group ? ` <span class="muted small">${esc(person.role)}</span>` : ''}</span>${phoneHtml(person.phone)}</div>`).join('')}</div>` : '')}

  ${section('Miejsce', data.venue && (data.venue.address || data.venue.notes || data.venue.contacts.length) ? `
    <div class="two keep">
      <div>
        <div class="strong">${esc(data.venue.name || '')}</div>
        <div>${esc(data.venue.address || '')}</div>
        ${data.venue.mapUrl ? `<div class="small muted">${esc(data.venue.mapUrl)}</div>` : ''}
      </div>
      <div>${data.venue.contacts.map(personLine).join('')}${data.venue.notes ? `<div class="small pre">${esc(data.venue.notes)}</div>` : ''}</div>
    </div>` : '')}

  ${section('Harmonogram', scheduleRows ? `<table><colgroup><col style="width:16%"/><col style="width:58%"/><col style="width:26%"/></colgroup>
    <thead><tr><th>Godzina</th><th>Co</th><th>Kto</th></tr></thead><tbody>${scheduleRows}</tbody></table>` : '<div class="missing">Brak harmonogramu — uzupełnij agendę lub etapy wydarzenia.</div>')}

  ${section('Transport i trasy', vehiclesHtml || '<div class="missing">Nie przypisano aut do wydarzenia.</div>')}

  ${section('Zespół', data.team.length ? `<table><colgroup><col style="width:30%"/><col style="width:30%"/><col style="width:20%"/><col style="width:20%"/></colgroup>
    <thead><tr><th>Osoba</th><th>Rola / zadanie</th><th>Telefon</th><th>Uwagi</th></tr></thead><tbody>
    ${data.team.map((person) => `<tr><td class="strong">${esc(person.name)}</td><td>${esc(person.role || '')}</td><td>${phoneHtml(person.phone)}</td><td class="small muted">${esc(person.note || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="missing">Nie przypisano zespołu.</div>')}

  ${section('Podwykonawcy', data.subcontractors.length ? `<table><colgroup><col style="width:28%"/><col style="width:32%"/><col style="width:22%"/><col style="width:18%"/></colgroup>
    <thead><tr><th>Firma</th><th>Zakres</th><th>Kontakt</th><th>Kiedy</th></tr></thead><tbody>
    ${data.subcontractors.map((sub) => `<tr><td class="strong">${esc(sub.company)}</td><td class="small">${esc(sub.scope || '')}</td><td>${sub.contact ? `${esc(sub.contact.name)}<div>${phoneHtml(sub.contact.phone)}</div>` : ''}</td><td class="small">${esc(sub.when || '')}</td></tr>`).join('')}
    </tbody></table>` : '')}

  ${section('Do przygotowania i zamówienia', data.preparation.length ? `<table><colgroup><col style="width:7%"/><col style="width:47%"/><col style="width:16%"/><col style="width:30%"/></colgroup>
    <thead><tr><th></th><th>Co</th><th>Termin</th><th>Odpowiada / stan</th></tr></thead><tbody>
    ${data.preparation.map((item) => `<tr class="${item.urgent ? 'prep-urgent' : ''}"><td class="check"><span class="box"></span></td><td>${esc(item.label)}</td><td>${esc(dateLabel(item.dueDate))}</td><td class="small">${esc([item.owner, item.status].filter(Boolean).join(' · '))}</td></tr>`).join('')}
    </tbody></table>` : '')}

  ${section('Sprzęt', equipmentHtml ? `<table><colgroup><col style="width:7%"/><col style="width:69%"/><col style="width:12%"/><col style="width:12%"/></colgroup>
    <thead><tr><th></th><th>Pozycja</th><th class="num">Ilość</th><th>J.m.</th></tr></thead>${equipmentHtml}</table>` : '')}

  ${section('Wytyczne', data.guidelines.length ? data.guidelines.map((g) => `<div class="guideline keep"><div class="guideline-title">${esc(g.title)}</div><div class="pre">${esc(g.text)}</div></div>`).join('') : '')}

  ${section('Pliki w CRM', data.files?.length ? `<div class="small">${data.files.map((file) => `${esc(file.folder ? `${file.folder} / ` : '')}${esc(file.name)}`).join(' · ')}</div>` : '', 'keep')}

  <section class="section keep">
    <h2>Notatki i potwierdzenia</h2>
    <div class="notes-lines"><div></div><div></div><div></div></div>
    <div class="signoff">
      <div><div class="slot"></div><div class="caption">Wydanie sprzętu z magazynu — magazyn / data</div></div>
      <div><div class="slot"></div><div class="caption">Odbiór i załadunek — kierowca / kierownik imprezy</div></div>
      <div><div class="slot"></div><div class="caption">Zwrot do magazynu — stan sprawdzony / data</div></div>
    </div>
  </section>

  <div class="doc-meta" style="margin-top:12px">Wygenerowano ${esc(dateTimeLabel(data.generatedAt))}${data.generatedBy ? ` przez ${esc(data.generatedBy)}` : ''}. Aktualne dane są w CRM — karta nie zawiera cen.</div>
</body>
</html>`;
}
