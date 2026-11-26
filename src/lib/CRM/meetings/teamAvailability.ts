/**
 * Działy, zakres planu i dostępność pracowników: Spotkania → „Pracownicy”, ostrzeżenia o zajętości w formularzu spotkania
 * i dział / przełożony na karcie pracownika (docs/team-availability.md). Dane z funkcji bazy `get_schedule_people`
 * i `get_team_availability`.
 * Identyczne kopie: src/lib/CRM/meetings/teamAvailability.ts ↔ mobile/src/lib/teamAvailability.ts
 * (pilnuje scripts/ci/check-shared-copies.mjs). Aplikacja na Maca ma odpowiednik w Swift (Meetings/TeamAvailability.swift).
 */

export type Department = 'management' | 'sales' | 'office' | 'warehouse';

export const DEPARTMENTS: Array<{ value: Department; label: string; hint: string }> = [
  { value: 'management', label: 'Zarząd', hint: 'Widzi plan wszystkich pracowników.' },
  { value: 'sales', label: 'Sprzedaż', hint: 'Widzi plan Sprzedaży, Biura i Magazynu.' },
  { value: 'office', label: 'Biuro', hint: 'Widzi plan Sprzedaży, Biura i Magazynu.' },
  { value: 'warehouse', label: 'Magazyn', hint: 'Magazyn, DJ i technicy — widzi plan swojego działu.' },
];

/** Pusty albo nieznany dział — Biuro (jak w bazie). */
export function department(value: unknown): Department {
  return value === 'management' || value === 'sales' || value === 'warehouse' ? value : 'office';
}

export function departmentLabel(value: unknown): string {
  const code = department(value);
  return DEPARTMENTS.find((option) => option.value === code)?.label ?? 'Biuro';
}

export interface SchedulePerson {
  id: string;
  name: string;
  surname: string;
  nickname: string;
  avatarUrl: string | null;
  department: Department;
  supervisorId: string | null;
  occupation: string;
  isSelf: boolean;
  isSubordinate: boolean;
}

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

export function schedulePersonFromRow(row: Record<string, unknown>): SchedulePerson {
  return {
    id: text(row.id),
    name: text(row.name),
    surname: text(row.surname),
    nickname: text(row.nickname),
    avatarUrl: row.avatar_url ? text(row.avatar_url) : null,
    department: department(row.department),
    supervisorId: row.supervisor_id ? text(row.supervisor_id) : null,
    occupation: text(row.occupation),
    isSelf: row.is_self === true,
    isSubordinate: row.is_subordinate === true,
  };
}

export function schedulePersonName(person: Pick<SchedulePerson, 'name' | 'surname' | 'nickname'>): string {
  return person.nickname.trim() || `${person.name} ${person.surname}`.trim() || 'Pracownik';
}

/** Osoby pogrupowane działami (kolejność: Zarząd, Sprzedaż, Biuro, Magazyn), w grupie — alfabetycznie. */
export function peopleByDepartment(people: SchedulePerson[]): Array<{ department: Department; label: string; people: SchedulePerson[] }> {
  return DEPARTMENTS.map((option) => ({
    department: option.value,
    label: option.label,
    people: people
      .filter((person) => person.department === option.value)
      .sort((a, b) => schedulePersonName(a).localeCompare(schedulePersonName(b), 'pl')),
  })).filter((group) => group.people.length > 0);
}

export type AvailabilityKind = 'meeting' | 'event' | 'phase' | 'absence';

export interface AvailabilityBlock {
  employeeId: string;
  kind: AvailabilityKind;
  /** Spotkanie albo event (do otwarcia) — tylko gdy widać szczegóły. */
  itemId: string | null;
  title: string | null;
  subtitle: string | null;
  start: string;
  end: string;
  allDay: boolean;
  /** Spotkanie wstępne, zaproszenie bez odpowiedzi / „może”, wniosek o nieobecność do akceptacji. */
  tentative: boolean;
  /** Szczegóły widoczne (osoba z zakresu albo spotkanie z moim udziałem); inaczej — tylko „Zajęty”. */
  detailed: boolean;
}

export function availabilityFromRow(row: Record<string, unknown>): AvailabilityBlock | null {
  const kind = text(row.kind);
  if (kind !== 'meeting' && kind !== 'event' && kind !== 'phase' && kind !== 'absence') return null;
  const start = text(row.starts_at);
  const end = text(row.ends_at);
  if (!row.employee_id || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  return {
    employeeId: text(row.employee_id),
    kind,
    itemId: row.item_id ? text(row.item_id) : null,
    title: row.title ? text(row.title) : null,
    subtitle: row.subtitle ? text(row.subtitle) : null,
    start,
    end,
    allDay: row.all_day === true,
    tentative: row.tentative === true,
    detailed: row.detailed === true,
  };
}

const KIND_LABELS: Record<AvailabilityKind, string> = { meeting: 'Spotkanie', event: 'Event', phase: 'Faza eventu', absence: 'Nieobecność' };

export function availabilityKindLabel(kind: AvailabilityKind): string {
  return KIND_LABELS[kind];
}

/** Tytuł bloku: nazwa (gdy widać szczegóły) albo „Zajęty” / „Nieobecność”. */
export function availabilityTitle(block: AvailabilityBlock): string {
  if (block.title) return block.title;
  return block.kind === 'absence' ? 'Nieobecność' : 'Zajęty';
}

export const AVAILABILITY_COLORS: Record<AvailabilityKind, string> = {
  meeting: '#0ea5e9',
  event: '#3b82f6',
  phase: '#8b5cf6',
  absence: '#10b981',
};
export const AVAILABILITY_BUSY_COLOR = '#8a8f9c';

export function availabilityColor(block: AvailabilityBlock): string {
  return block.detailed ? AVAILABILITY_COLORS[block.kind] : AVAILABILITY_BUSY_COLOR;
}

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayLabel = (date: Date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;

/** Godziny bloku (czas urządzenia): „10:00–11:00”, „cały dzień”, kilka dni — „02.12 10:00 – 03.12 02:00”. */
export function availabilityTime(block: Pick<AvailabilityBlock, 'start' | 'end' | 'allDay'>): string {
  const start = new Date(block.start);
  const end = new Date(block.end);
  if (block.allDay) {
    const last = new Date(end.getTime() - 1);
    return sameDay(start, last) ? 'cały dzień' : `${dayLabel(start)}–${dayLabel(last)}`;
  }
  if (sameDay(start, end)) return `${clock(start)}–${clock(end)}`;
  return `${dayLabel(start)} ${clock(start)} – ${dayLabel(end)} ${clock(end)}`;
}

export interface MeetingConflict {
  employeeId: string;
  blocks: AvailabilityBlock[];
}

/**
 * Zajętość wybranych osób w terminie spotkania [start, end) — bloki nachodzące na termin (bez samego edytowanego spotkania:
 * pomija je już funkcja bazy). Kolejność osób jak `employeeIds`.
 */
export function meetingConflicts(blocks: AvailabilityBlock[], start: string, end: string, employeeIds: string[]): MeetingConflict[] {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return [];
  return employeeIds
    .map((employeeId) => ({
      employeeId,
      blocks: blocks
        .filter((block) => block.employeeId === employeeId && Date.parse(block.start) < to && Date.parse(block.end) > from)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    }))
    .filter((conflict) => conflict.blocks.length > 0);
}

/** Jedna linia ostrzeżenia: „10:00–11:00 Spotkanie z klientem (wstępne); cały dzień Nieobecność”. */
export function conflictText(conflict: MeetingConflict): string {
  return conflict.blocks
    .map((block) => `${availabilityTime(block)} ${availabilityTitle(block)}${block.tentative ? ' (niepotwierdzone)' : ''}`)
    .join('; ');
}

/** Ile osób z listy ma coś w terminie (nagłówek ostrzeżenia). */
export function conflictHeadline(count: number): string {
  if (count === 1) return 'Jedna osoba ma już coś w planie w tym czasie';
  const lastTwo = count % 100;
  const last = count % 10;
  const few = last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14);
  return `${count} ${few ? 'osoby mają' : 'osób ma'} już coś w planie w tym czasie`;
}
