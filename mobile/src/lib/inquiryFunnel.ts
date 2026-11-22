/*
 * Lejek zapytań — model jak w CRM (`src/lib/CRM/inquiries/pipeline.ts`, `InquiriesPageClient`) i na Macu (`InquiryModels.swift`):
 * etapy z kolorami i domyślną szansą, kategorie utraty, zakresy (Moje, Współpracuję, Nieprzypisane, Zespół, Wszystkie), filtry
 * „wymaga uwagi”, braki karty i uprawnienia do zarządzania (`canManageInquiry`).
 */

export type InquiryStageId = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export const INQUIRY_STAGES: ReadonlyArray<{ id: InquiryStageId; label: string; shortLabel: string; color: string; probability: number }> = [
  { id: 'new', label: 'Nowe zapytanie', shortLabel: 'Nowe', color: '#fbbf24', probability: 10 },
  { id: 'contacted', label: 'Kontakt podjęty', shortLabel: 'Kontakt', color: '#38bdf8', probability: 20 },
  { id: 'qualified', label: 'Zakwalifikowane', shortLabel: 'Kwalifikacja', color: '#60a5fa', probability: 40 },
  { id: 'proposal', label: 'Oferta wysłana', shortLabel: 'Oferta', color: '#a78bfa', probability: 60 },
  { id: 'negotiation', label: 'Negocjacje', shortLabel: 'Negocjacje', color: '#e879f9', probability: 75 },
  { id: 'won', label: 'Wygrane', shortLabel: 'Wygrane', color: '#34d399', probability: 100 },
  { id: 'lost', label: 'Przegrane', shortLabel: 'Przegrane', color: '#f87171', probability: 0 },
];

export const stageOf = (id: string) => INQUIRY_STAGES.find((stage) => stage.id === id) || INQUIRY_STAGES[0];
export const isClosedStage = (id: string) => id === 'won' || id === 'lost';

export const INQUIRY_LOST_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'price', label: 'Cena' },
  { value: 'availability', label: 'Brak dostępnego terminu' },
  { value: 'competitor', label: 'Wybrano konkurencję' },
  { value: 'no_response', label: 'Brak odpowiedzi klienta' },
  { value: 'scope', label: 'Zakres poza ofertą' },
  { value: 'timing', label: 'Odłożona decyzja' },
  { value: 'market_research', label: 'Badanie rynku' },
  { value: 'duplicate', label: 'Duplikat zapytania' },
  { value: 'other', label: 'Inny powód' },
];

/** Zapytanie z lejka (`src/lib/native/inquiries.ts`). */
export type FunnelInquiry = {
  id: string;
  title: string;
  titleLabel: string;
  sourceLabel: string;
  typeLabels: string[];
  description: string;
  message: string;
  messageClean?: string;
  stage: string;
  ownerId: string | null;
  ownerName: string;
  ownerTeamId: string | null;
  nextActionAt: string | null;
  lastContactAt: string | null;
  firstContactAt: string | null;
  slaDueAt: string | null;
  estimatedValue: number | null;
  probability: number;
  lostReason: string;
  lostReasonCategory: string;
  linkedOfferId: string | null;
  eventId: string | null;
  contactId: string | null;
  organizationId: string | null;
  clientText: string;
  clientCompany: string;
  clientPhone: string;
  clientEmail: string;
  locationText: string;
  scope: string;
  sourceName: string;
  member: boolean;
  createdAt: string;
  termin?: string | null;
  dueDate?: string | null;
  clientLabel?: string;
};

/** Uprawnienia lejka liczone na serwerze tak jak w CRM. */
export type InquiryAccess = {
  employeeId: string;
  salesTeamId: string | null;
  isTeamManager: boolean;
  isAdmin: boolean;
  canViewPool: boolean;
  canViewTeam: boolean;
  canViewAll: boolean;
  canAssign: boolean;
  canClaim: boolean;
  canCreate: boolean;
  manageAll: boolean;
  manageOwn: boolean;
  manageTeam: boolean;
};

export const isOpenInquiry = (inquiry: FunnelInquiry) => !isClosedStage(inquiry.stage);
const time = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};
export const inquiryOverdue = (inquiry: FunnelInquiry, now = Date.now()) => {
  const next = time(inquiry.nextActionAt);
  return isOpenInquiry(inquiry) && next !== null && next < now;
};
export const firstContactBreached = (inquiry: FunnelInquiry, now = Date.now()) => {
  const due = time(inquiry.slaDueAt);
  return isOpenInquiry(inquiry) && Boolean(inquiry.ownerId) && !inquiry.firstContactAt && due !== null && due < now;
};
export const missingNextAction = (inquiry: FunnelInquiry) => isOpenInquiry(inquiry) && Boolean(inquiry.firstContactAt) && !inquiry.nextActionAt;

/** Braki jak na karcie w CRM (`getInquiryWarnings`). */
export function inquiryWarnings(inquiry: FunnelInquiry): string[] {
  if (!isOpenInquiry(inquiry)) return [];
  const result: string[] = [];
  if (!inquiry.ownerId) result.push('Brak opiekuna');
  if (!inquiry.clientEmail && !inquiry.clientPhone) result.push('Brak danych kontaktowych');
  if (!inquiry.nextActionAt) result.push('Brak następnego działania');
  if (['qualified', 'proposal', 'negotiation'].includes(inquiry.stage) && !inquiry.estimatedValue) result.push('Brak wartości');
  if (['proposal', 'negotiation'].includes(inquiry.stage) && !inquiry.linkedOfferId) result.push('Brak powiązanej oferty');
  return result;
}

export const weightedValue = (inquiry: FunnelInquiry) => (isOpenInquiry(inquiry) ? (inquiry.estimatedValue || 0) * inquiry.probability / 100 : 0);

export const inquirySearchText = (inquiry: FunnelInquiry) => [
  inquiry.title, inquiry.titleLabel, inquiry.typeLabels.join(' '), inquiry.sourceLabel, inquiry.description, inquiry.clientText,
  inquiry.clientCompany, inquiry.clientEmail, inquiry.clientPhone, inquiry.locationText, inquiry.scope, inquiry.sourceName,
  inquiry.ownerName, inquiry.lostReason,
].join(' ').toLocaleLowerCase('pl-PL');

/** `canManageInquiry` z CRM: wszystkie, własne albo zespołu (menedżer zespołu). */
export function canManageInquiry(access: InquiryAccess | null, inquiry: FunnelInquiry) {
  if (!access) return false;
  if (access.isAdmin || access.manageAll) return true;
  if (inquiry.ownerId === access.employeeId && access.manageOwn) return true;
  return access.isTeamManager && Boolean(access.salesTeamId) && inquiry.ownerTeamId === access.salesTeamId && access.manageTeam;
}
export const canClaimInquiry = (access: InquiryAccess | null, inquiry: FunnelInquiry) => Boolean(access?.canClaim) && !inquiry.ownerId;

export type InquiryScope = 'mine' | 'collaborating' | 'pool' | 'team' | 'all';
export const INQUIRY_SCOPES: ReadonlyArray<{ key: InquiryScope; label: string }> = [
  { key: 'mine', label: 'Moje' },
  { key: 'collaborating', label: 'Współpracuję' },
  { key: 'pool', label: 'Nieprzypisane' },
  { key: 'team', label: 'Zespół' },
  { key: 'all', label: 'Wszystkie' },
];
/** Zakresy dostępne pracownikowi (jak w CRM: pula, zespół, wszystkie — według uprawnień). */
export const availableScopes = (access: InquiryAccess | null) => INQUIRY_SCOPES.filter(({ key }) => {
  if (key === 'mine' || key === 'collaborating') return true;
  if (!access) return false;
  return key === 'pool' ? access.canViewPool : key === 'team' ? access.canViewTeam : access.canViewAll;
});
export function inScope(inquiry: FunnelInquiry, scope: InquiryScope, access: InquiryAccess | null) {
  const me = access?.employeeId || null;
  switch (scope) {
    case 'mine': return Boolean(inquiry.ownerId) && inquiry.ownerId === me;
    case 'collaborating': return inquiry.member && inquiry.ownerId !== me;
    case 'pool': return !inquiry.ownerId;
    case 'team': return Boolean(access?.salesTeamId) && inquiry.ownerTeamId === access?.salesTeamId;
    default: return true;
  }
}

export type InquiryStatusFilter = 'open' | 'completed' | 'all';
export const INQUIRY_STATUS_FILTERS: ReadonlyArray<{ key: InquiryStatusFilter; label: string }> = [
  { key: 'open', label: 'Aktywne' },
  { key: 'completed', label: 'Zamknięte' },
  { key: 'all', label: 'Wszystkie' },
];

export type InquiryAttention = 'unassigned' | 'firstContact' | 'overdue' | 'missingNext';
export const INQUIRY_ATTENTION: ReadonlyArray<{ key: InquiryAttention; label: string; color: string }> = [
  { key: 'unassigned', label: 'Bez opiekuna', color: '#fbbf24' },
  { key: 'firstContact', label: 'SLA pierwszego kontaktu', color: '#f87171' },
  { key: 'overdue', label: 'Zaległe działania', color: '#fb923c' },
  { key: 'missingNext', label: 'Brak następnego działania', color: '#a78bfa' },
];
export function attentionMatches(inquiry: FunnelInquiry, attention: InquiryAttention, now = Date.now()) {
  switch (attention) {
    case 'unassigned': return isOpenInquiry(inquiry) && !inquiry.ownerId;
    case 'firstContact': return firstContactBreached(inquiry, now);
    case 'overdue': return inquiryOverdue(inquiry, now);
    default: return missingNextAction(inquiry);
  }
}

const ZONE = 'Europe/Warsaw';
const parts = (value: number, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, hourCycle: 'h23', ...options }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));

/** „12.03, 09:30” (czas polski). */
export function formatInquiryShort(value: string | null | undefined) {
  const at = time(value);
  if (at === null) return '';
  const p = parts(at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${p.day}.${p.month}, ${p.hour}:${p.minute}`;
}
/** „12 marca 2027, 09:30” (czas polski). */
export function formatInquiryFull(value: string | null | undefined) {
  const at = time(value);
  if (at === null) return '';
  return new Intl.DateTimeFormat('pl-PL', { timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(at));
}
/** „12 300 zł” (bez groszy). */
export function formatInquiryMoney(value: number | null | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(Math.round(amount))} zł`;
}

/** Termin „za `days` dni, godz. 9:00” czasu polskiego jako ISO (szybkie terminy następnego działania). */
export function plannedAt(days: number, hour = 9) {
  const now = Date.now();
  const p = parts(now + days * 86_400_000, { year: 'numeric', month: '2-digit', day: '2-digit' });
  // Przesunięcie strefy w tym dniu: różnica między zegarem polskim a UTC o północy.
  const utcMidnight = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, 0);
  const local = parts(utcMidnight, { hour: '2-digit', minute: '2-digit' });
  const offsetMinutes = (Number(local.hour) * 60 + Number(local.minute)) - hour * 60;
  return new Date(utcMidnight - offsetMinutes * 60_000).toISOString();
}
