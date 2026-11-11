/**
 * Spotkania: status spotkania, odpowiedzi uczestników, prywatność i układ osi czasu.
 * Identyczne kopie: src/lib/CRM/meetings/meetingStatus.ts ↔ mobile/src/lib/meetingStatus.ts
 * (pilnuje scripts/ci/check-shared-copies.mjs). Aplikacja na Maca ma odpowiednik w Swift.
 */

export type MeetingStatus = 'tentative' | 'confirmed' | 'cancelled';
export type MeetingResponse = 'pending' | 'accepted' | 'tentative' | 'declined';
export type MeetingKind = 'company' | 'private';

export interface MeetingStatusOption {
  value: MeetingStatus;
  label: string;
  action: string;
  color: string;
}

export interface MeetingResponseOption {
  value: MeetingResponse;
  label: string;
  action: string;
  color: string;
}

export const MEETING_STATUSES: MeetingStatusOption[] = [
  { value: 'confirmed', label: 'Potwierdzone', action: 'Potwierdź', color: '#4ade80' },
  { value: 'tentative', label: 'Wstępne', action: 'Oznacz jako wstępne', color: '#f5c26b' },
  { value: 'cancelled', label: 'Odwołane', action: 'Odwołaj', color: '#f87171' },
];

export const MEETING_RESPONSES: MeetingResponseOption[] = [
  { value: 'accepted', label: 'Przyjęte', action: 'Przyjmuję', color: '#4ade80' },
  { value: 'tentative', label: 'Może', action: 'Może', color: '#f5c26b' },
  { value: 'declined', label: 'Odrzucone', action: 'Odrzucam', color: '#f87171' },
  { value: 'pending', label: 'Czeka na odpowiedź', action: 'Bez odpowiedzi', color: '#a8adba' },
];

export const MEETING_KINDS: Array<{ value: MeetingKind; label: string }> = [
  { value: 'company', label: 'Firmowe' },
  { value: 'private', label: 'Prywatne' },
];

export function meetingStatus(value: unknown): MeetingStatus {
  return value === 'tentative' || value === 'cancelled' ? value : 'confirmed';
}

/** Odpowiedź uczestnika; wiersze sprzed wprowadzenia odpowiedzi traktujemy jak przyjęte. */
export function meetingResponse(value: unknown): MeetingResponse {
  return value === 'pending' || value === 'tentative' || value === 'declined' ? value : 'accepted';
}

export function meetingStatusOption(value: unknown): MeetingStatusOption {
  const status = meetingStatus(value);
  return MEETING_STATUSES.find((option) => option.value === status) ?? MEETING_STATUSES[0];
}

export function meetingResponseOption(value: unknown): MeetingResponseOption {
  const response = meetingResponse(value);
  return MEETING_RESPONSES.find((option) => option.value === response) ?? MEETING_RESPONSES[0];
}

export function meetingKind(meeting: { is_private?: boolean | null }): MeetingKind {
  return meeting.is_private ? 'private' : 'company';
}

export function meetingKindLabel(meeting: { is_private?: boolean | null }): string {
  return meeting.is_private ? 'Prywatne' : 'Firmowe';
}

export interface MeetingParticipantLike {
  employee_id?: string | null;
  contact_id?: string | null;
  response?: string | null;
}

export interface MeetingLike {
  created_by?: string | null;
  status?: string | null;
  is_private?: boolean | null;
  participants?: MeetingParticipantLike[] | null;
}

/** Odpowiedź zalogowanej osoby (null — nie jest uczestnikiem; autor zawsze „przyjęte”). */
export function myMeetingResponse(meeting: MeetingLike, employeeId: string | null | undefined): MeetingResponse | null {
  if (!employeeId) return null;
  if (meeting.created_by === employeeId) return 'accepted';
  const row = (meeting.participants ?? []).find((participant) => participant.employee_id === employeeId);
  return row ? meetingResponse(row.response) : null;
}

export function isMeetingOrganizer(meeting: MeetingLike, employeeId: string | null | undefined): boolean {
  return !!employeeId && meeting.created_by === employeeId;
}

/** Liczba odpowiedzi pracowników (bez autora) — „3 przyjęło · 1 czeka”. */
export function meetingResponseSummary(meeting: MeetingLike): Record<MeetingResponse, number> {
  const summary: Record<MeetingResponse, number> = { pending: 0, accepted: 0, tentative: 0, declined: 0 };
  (meeting.participants ?? []).forEach((participant) => {
    if (!participant.employee_id || participant.employee_id === meeting.created_by) return;
    summary[meetingResponse(participant.response)] += 1;
  });
  return summary;
}

export function meetingResponseSummaryText(meeting: MeetingLike): string {
  const summary = meetingResponseSummary(meeting);
  return (['accepted', 'tentative', 'pending', 'declined'] as MeetingResponse[])
    .filter((response) => summary[response] > 0)
    .map((response) => {
      const label = response === 'pending' ? 'Bez odpowiedzi' : meetingResponseOption(response).label;
      return `${label} ${summary[response]}`;
    })
    .join(' · ');
}

/** Spotkanie wymaga mojej odpowiedzi (zaproszenie bez odpowiedzi, spotkanie nieodwołane). */
export function meetingNeedsMyResponse(meeting: MeetingLike, employeeId: string | null | undefined): boolean {
  return meetingStatus(meeting.status) !== 'cancelled' && myMeetingResponse(meeting, employeeId) === 'pending';
}

export interface TimelineSpan {
  start: number;
  end: number;
}

export type TimelinePlacement<T> = T & { column: number; columns: number };

/**
 * Układ nachodzących się spotkań w kolumnie dnia (jak w Teams): grupy spotkań, które się
 * nakładają, dzielą szerokość na tyle kolumn, ile maksymalnie spotkań trwa jednocześnie.
 */
export function layoutTimeline<T extends TimelineSpan>(items: T[]): Array<TimelinePlacement<T>> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Array<TimelinePlacement<T>> = [];
  let cluster: Array<TimelinePlacement<T>> = [];
  let columnsEnd: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = Math.max(1, columnsEnd.length);
    cluster.forEach((item) => {
      item.columns = columns;
    });
    placed.push(...cluster);
    cluster = [];
    columnsEnd = [];
  };

  sorted.forEach((item) => {
    const end = Math.max(item.end, item.start + 1);
    if (cluster.length && item.start >= clusterEnd) flush();
    let column = columnsEnd.findIndex((columnEnd) => columnEnd <= item.start);
    if (column < 0) {
      column = columnsEnd.length;
      columnsEnd.push(end);
    } else {
      columnsEnd[column] = end;
    }
    clusterEnd = cluster.length ? Math.max(clusterEnd, end) : end;
    cluster.push({ ...item, column, columns: 1 });
  });
  if (cluster.length) flush();
  return placed;
}
