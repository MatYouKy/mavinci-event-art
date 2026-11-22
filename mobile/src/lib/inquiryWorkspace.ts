import { forgetFunnel, inquiriesGet, inquiriesPost } from './inquiriesApi';
import { showcaseOfferDraftId } from './showcaseShared';

/*
 * Karta zapytania (obsługa zapytania) — to samo API co strona `/crm/inquiries/[id]` i karta zapytania na Macu
 * (`/bridge/native/v1/inquiries`, `src/lib/native/inquiryWorkspace.ts` i `inquiryWorkspaceTools.ts`, token pracownika, RLS jak
 * w CRM). Dane karty (`op=workspace`), nazwa, ustalenia, etap, ponowne negocjacje, notatki, przekazanie, oferty (szkic, kopia,
 * akceptacja), klient i organizacja, zespół, zadania, wydarzenie z zapytania, korespondencja (dołączanie i wykluczanie wiadomości),
 * e-mail do klienta (podgląd ze stopką, „Popraw z AI”, załączniki, wysyłka planowana) i analiza z AI (rozmowa, zatwierdzenie
 * podsumowania, liczba osób z korespondencji). Każda zmiana unieważnia skrót listy w lejku.
 */

export type WorkspaceInfo = {
  id: string;
  title: string;
  titleLabel: string;
  sourceLabel: string;
  typeLabels: string[];
  stage: string;
  ownerId: string | null;
  ownerName: string;
  createdAt: string | null;
  nextActionAt: string | null;
  lastContactAt: string | null;
  estimatedValue: number | null;
  probability: number;
  lostReason: string;
  lostReasonCategory: string;
  linkedOfferId: string | null;
  acceptedOfferId: string | null;
  eventId: string | null;
  contactId: string | null;
  organizationId: string | null;
  archived: boolean;
  briefRevision: number;
};

export type WorkspaceQuestion = { question: string; answer: string; status: string };

/** Ustalenia zapytania (`save_inquiry_brief`) — pola jak w formularzu CRM i na Macu. */
export type WorkspaceBrief = {
  termin: string;
  eventSingleDay: boolean;
  eventEndDate: string;
  eventStartTime: string;
  eventEndTime: string;
  eventEndNextDay: boolean;
  locationText: string;
  locationId: string;
  guestCount: string;
  guestCountText: string;
  scope: string;
  budgetMin: string;
  budgetMax: string;
  budgetText: string;
  conversationNotes: string;
  eventGoal: string;
  questions: WorkspaceQuestion[];
};

export type WorkspacePackage = { id: string; name: string; priceNet: number };
export type WorkspaceOffer = {
  id: string;
  number: string;
  title: string;
  status: string;
  statusLabel: string;
  total: number | null;
  guestCount: number | null;
  eventId: string | null;
  packageMode: boolean;
  packages: WorkspacePackage[];
  acceptedPackageId: string | null;
  createdAt: string | null;
  validUntil: string | null;
};
export type WorkspaceCalculation = {
  id: string; name: string; createdAt: string | null; accepted: boolean; total: number; itemsCount: number; pdf: boolean; selected: boolean;
};
export type WorkspaceActivity = { id: string; kind: string; kindLabel: string; body: string; at: string | null };
export type WorkspaceStageChange = { id: string; from: string; to: string; reason: string; at: string | null; by: string };

export type InquiryWorkspace = {
  inquiry: WorkspaceInfo;
  message: { full: string; clean: string; trimmed: boolean; sourceHref: string | null };
  client: { name: string; email: string; phone: string; contactName: string; organizationName: string };
  summary: { schedule: string; location: string; guests: string; guestsHint: string; scope: string; budget: string };
  brief: WorkspaceBrief;
  offers: WorkspaceOffer[];
  calculations: WorkspaceCalculation[];
  activity: WorkspaceActivity[];
  stageHistory: WorkspaceStageChange[];
  teamCount: number;
  /** `canLead` — prowadzenie sprzedaży (opiekun z uprawnieniem, menedżer zespołu, „wszystkie”); `canManage` — także zespół zapytania. */
  permissions: { canLead: boolean; canManage: boolean; canAssign: boolean };
  stages: Array<{ id: string; label: string; probability: number }>;
  lostCategories: Array<{ value: string; label: string }>;
};

export type WorkspacePerson = { id: string; name: string; active?: boolean };
export type WorkspaceTeam = {
  owner: { id: string; name: string } | null;
  members: WorkspacePerson[];
  candidates: WorkspacePerson[];
  canManageTeam: boolean;
  isMember: boolean;
};
export type WorkspaceTask = {
  id: string; title: string; description: string; priority: string; column: string; dueDate: string | null; createdAt: string | null; assignees: string[];
};
export type WorkspaceTasks = { tasks: WorkspaceTask[]; employees: WorkspacePerson[]; canManage: boolean };
export type WorkspaceClientRecord = { id: string; name: string; email?: string; type?: string };
export type WorkspaceClientSetup = {
  contact: WorkspaceClientRecord | null;
  organization: WorkspaceClientRecord | null;
  contactId: string | null;
  organizationId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Organizacja dopasowana jednoznacznie po domenie adresu klienta (bez skrzynek publicznych). */
  suggestedOrganization: WorkspaceClientRecord | null;
};
export type WorkspaceClientReply =
  | { ok: true; contactId: string; organizationId: string | null }
  | { duplicate: 'contact' | 'organization'; message: string; results: WorkspaceClientRecord[] };
export type WorkspaceConvertSetup = {
  name: string;
  /** Termin z zapytania jako czas polski `YYYY-MM-DDTHH:MM` (pusty — brak terminu). */
  dateLocal: string;
  endNote: string;
  location: string;
  categories: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
  companyId: string;
  /** Zaakceptowana oferta — „Przygotuj realizację” (wycena i plan zasobów przechodzą do wydarzenia). */
  realization: boolean;
  needsClient: boolean;
};

export const TASK_PRIORITIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'low', label: 'Niski' }, { id: 'medium', label: 'Średni' }, { id: 'high', label: 'Wysoki' }, { id: 'urgent', label: 'Pilny' },
];
export const TASK_COLUMNS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'todo', label: 'Do zrobienia' }, { id: 'in_progress', label: 'W trakcie' }, { id: 'review', label: 'Do sprawdzenia' }, { id: 'completed', label: 'Zakończone' },
];
export const NOTE_KINDS: ReadonlyArray<{ id: 'note' | 'call_note' | 'contact'; label: string }> = [
  { id: 'note', label: 'Notatka' }, { id: 'call_note', label: 'Rozmowa telefoniczna' }, { id: 'contact', label: 'Kontakt z klientem' },
];

/** Identyfikator żądania (UUID v4) — ponowienie po zerwanym połączeniu nie dubluje notatki ani oferty. */
export const newRequestId = () => showcaseOfferDraftId();

const run = async <T = { ok: boolean }>(op: string, id: string, extra: Record<string, unknown> = {}) => {
  const reply = await inquiriesPost<T>(op, { id, ...extra });
  forgetFunnel();
  return reply;
};

export const loadWorkspace = (id: string) => inquiriesGet<InquiryWorkspace>('workspace', { id });
/** Nazwa — zapis tylko, gdy nikt jej w międzyczasie nie zmienił (`expected`). */
export const saveWorkspaceTitle = (id: string, title: string, expected: string) => run('workspaceTitle', id, { title, expected: expected || null });
/** Ustalenia z kontrolą wersji (`revision`) — równoległa zmiana kończy się komunikatem zamiast nadpisania. */
export const saveWorkspaceBrief = (id: string, brief: WorkspaceBrief, revision: number) => run<{ ok: boolean; revision: number }>('workspaceBrief', id, { brief, revision });
export const changeWorkspaceStage = (id: string, stage: string, expected: string, category: string, reason: string) =>
  run('workspaceStage', id, { stage, expected, category, reason });
export const reopenWorkspace = (id: string, reason: string) => run('workspaceReopen', id, { reason });
export const addWorkspaceNote = (id: string, body: string, kind: string, requestId: string) => run('workspaceNote', id, { body, kind, requestId });
export const workspaceHandoffCandidates = (id: string) => inquiriesGet<{ candidates: WorkspacePerson[] }>('handoffCandidates', { id });
/** Przekazanie osobie (`ownerId`) albo oddanie do puli (`null`). */
export const handOffWorkspace = (id: string, ownerId: string | null) => run('workspaceHandoff', id, { ownerId });
/** Pusty szkic oferty z ustaleń zapytania (jak „Nowa oferta” w CRM) — wymaga klienta zapytania. */
export const createWorkspaceOffer = (id: string, offerId: string) => run<{ ok: boolean; offerId: string }>('workspaceOffer', id, { offerId });
export const duplicateWorkspaceOffer = (id: string, offerId: string) => run('workspaceDuplicate', id, { offerId });
/** Nowa kalkulacja zapytania (z zatwierdzonym podsumowaniem w notatkach) — otwiera się od razu w edytorze. */
export const createWorkspaceCalculation = (id: string) => run<{ ok: boolean; calculationId: string }>('workspaceCalculation', id);
export const acceptWorkspaceOffer = (id: string, offerId: string, note: string, packageId: string | null) => run('workspaceAccept', id, { offerId, note, packageId });
export const workspaceClientSetup = (id: string) => inquiriesGet<WorkspaceClientSetup>('clientSetup', { id });
export const workspaceClientSearch = (id: string, kind: 'contact' | 'organization', query: string) =>
  inquiriesGet<{ results: WorkspaceClientRecord[] }>('clientSearch', { id, kind, query });
export const linkWorkspaceClient = (id: string, body: Record<string, unknown>) => run<WorkspaceClientReply>('workspaceClient', id, body);
export const loadWorkspaceTeam = (id: string) => inquiriesGet<WorkspaceTeam>('team', { id });
export const setWorkspaceTeamMember = (id: string, employeeId: string, active: boolean) => run<WorkspaceTeam>('workspaceTeam', id, { employeeId, active });
export const loadWorkspaceTasks = (id: string) => inquiriesGet<WorkspaceTasks>('tasks', { id });
export const createWorkspaceTask = (id: string, task: { title: string; description: string; priority: string; column: string; dueDate: string | null; assignees: string[] }) =>
  run<{ ok: boolean; taskId: string }>('workspaceTask', id, task);
export const workspaceConvertSetup = (id: string) => inquiriesGet<WorkspaceConvertSetup>('convertSetup', { id });
export const convertWorkspace = (id: string, data: { name: string; date: string; categoryId: string | null; companyId: string | null }) =>
  run<{ ok: boolean; eventId: string }>('workspaceConvert', id, data);

// MARK: Korespondencja, e-mail do klienta, analiza AI

export type MailType = 'received' | 'sent';
export type MailRef = { id: string; type: MailType };
/** Wiadomość powiązana z zapytaniem (od najstarszej): `clean` — treść bez stopek i cytatów, `trimmed` — coś pominięto. */
export type WorkspaceMail = MailRef & { subject: string; from: string; to: string; at: string | null; body: string; clean: string; trimmed: boolean };
export type WorkspaceCorrespondence = { messages: WorkspaceMail[]; excluded: MailRef[]; signature: string; canManage: boolean };
/** Wynik wyszukiwania albo wiadomość z wątku (bez treści). */
export type WorkspaceMailHit = MailRef & { subject: string; from?: string; to?: string; at: string | null };
export type WorkspaceEmailSetup = { accounts: Array<{ id: string; label: string }>; accountId: string; to: string; subject: string; text: string };
export type WorkspaceAttachment = { filename: string; content: string; contentType: string };
/** Punkt analizy AI: treść, etykieta („Wskazane przez klienta” / „Wniosek AI”) i wiadomości źródłowe. */
export type AiItem = { text: string; label: string; sources: MailRef[] };
export type WorkspaceAnalysis = {
  id: string; at: string | null; question: string; reply: string; summary: string; eventGoal: string;
  assumptions: AiItem[]; clientNeeds: AiItem[]; missing: AiItem[]; estimate: string; estimateSummary: string; estimateBasis: AiItem[];
  products: AiItem[]; nextActions: AiItem[]; resources: AiItem[]; risks: AiItem[]; findings: AiItem[]; findingsCount: number;
};
export type WorkspaceAnalysisData = {
  analyses: WorkspaceAnalysis[];
  approved: { summary: string; at: string | null; analysisId: string } | null;
  /** Zatwierdzone podsumowanie jest z ostatniej analizy, aktualnych ustaleń i korespondencji. */
  approvedCurrent: boolean;
  briefRevision: number;
  messageCount: number;
  canManage: boolean;
};
/** Liczba uczestników odczytana z korespondencji: `exact` / `approximate` / `range` / `unknown`, z dosłownym cytatem. */
export type WorkspaceGuests = { kind: string; text: string; evidence: string; count: number | null };

export const loadCorrespondence = (id: string) => inquiriesGet<WorkspaceCorrespondence>('correspondence', { id });
export const searchCorrespondence = (id: string, query: string) => inquiriesGet<{ results: WorkspaceMailHit[] }>('emailSearch', { id, query });
export const correspondenceThread = (id: string, type: MailType, messageId: string) =>
  inquiriesGet<{ messages: WorkspaceMailHit[] }>('emailThread', { id, type, messageId });
/** Dołączenie wiadomości (`thread` — cała konwersacja, także kolejne odpowiedzi), wykluczenie albo przywrócenie. */
export const linkCorrespondence = (id: string, message: MailRef, thread: boolean, excluded: boolean) =>
  run('workspaceLinkEmail', id, { type: message.type, messageId: message.id, thread, excluded });
export const workspaceEmailSetup = (id: string) => inquiriesGet<WorkspaceEmailSetup>('emailSetup', { id });
/** Podgląd z szablonem i stopką wybranej skrzynki (dokument HTML). */
export const workspaceEmailPreview = (id: string, accountId: string, subject: string, text: string) =>
  inquiriesPost<{ html: string }>('workspaceEmailPreview', { id, accountId, subject, text });
/** „Popraw z AI” — język i ton, bez dopisywania cen, terminów ani obietnic. */
export const improveWorkspaceEmail = (id: string, subject: string, text: string) =>
  inquiriesPost<{ subject: string; text: string }>('workspaceEmailImprove', { id, subject, text });
/** Wysyłka teraz albo zaplanowana (`scheduledAt`) — wiadomość trafia do korespondencji i jest zapisana jako kontakt z klientem. */
export const sendWorkspaceEmail = (id: string, mail: {
  accountId: string; to: string; cc: string; bcc: string; subject: string; text: string; scheduledAt: string | null; attachments: WorkspaceAttachment[];
}) => run<{ ok: boolean; scheduled: boolean; scheduledAt: string | null }>('workspaceEmailSend', id, mail);
export const loadAnalysis = (id: string) => inquiriesGet<WorkspaceAnalysisData>('analysis', { id });
/** Pytanie do AI albo (pusta treść) pełna analiza zapytania i korespondencji; ten sam `requestId` przy ponowieniu nie dubluje tury. */
export const askAssistant = (id: string, message: string, requestId: string) => inquiriesPost<WorkspaceAnalysisData>('workspaceAsk', { id, message, requestId });
export const readGuests = (id: string) => inquiriesPost<WorkspaceGuests>('workspaceGuests', { id });
export const approveAnalysis = (id: string, analysisId: string, revision: number) => run('workspaceApprove', id, { analysisId, revision });
/** Łączny limit załączników wiadomości (jak w CRM). */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

/** „Przygotuj realizację” — zaakceptowana oferta, bez wydarzenia i bez wcześniejszego przekazania (jak w CRM i na Macu). */
export const preparesRealization = (data: InquiryWorkspace) =>
  Boolean(data.inquiry.acceptedOfferId) && !data.inquiry.eventId && !data.activity.some((entry) => entry.kind === 'handoff');
/** Notatki zapytania (bez wpisów systemowych). */
export const workspaceNotes = (data: InquiryWorkspace) => data.activity.filter((entry) => ['note', 'call_note', 'contact'].includes(entry.kind));

// MARK: Czas polski w ustaleniach (data `YYYY-MM-DD`, godzina `HH:MM`)

const ZONE = 'Europe/Warsaw';
const warsawParts = (date: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map((part) => [part.type, part.value]),
);
/** Dzień czasu polskiego `YYYY-MM-DD`. */
export const warsawDay = (date: Date) => {
  const p = warsawParts(date);
  return `${p.year}-${p.month}-${p.day}`;
};
/** Godzina czasu polskiego `HH:MM`. */
export const warsawTime = (date: Date) => {
  const p = warsawParts(date);
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};
/** Chwila odpowiadająca dacie i godzinie czasu polskiego (także w dniu zmiany czasu). */
export function warsawDate(day: string, time = '12:00') {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year || 1970, (month || 1) - 1, date || 1, hour || 0, minute || 0);
  const p = warsawParts(new Date(guess));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  return new Date(guess - (wall - guess));
}
/** Wartość z bazy → `YYYY-MM-DD` (termin bywa zapisany jako pełna data z godziną). */
export function briefDay(value: string) {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed) && /T|\s\d/.test(raw)) return warsawDay(new Date(parsed));
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}
/** Wartość z bazy → `HH:MM` (np. „18:00:00”). */
export const briefTime = (value: string) => (/^\d{2}:\d{2}/.test((value || '').trim()) ? value.trim().slice(0, 5) : '');

/** Ustalenia w postaci, którą przyjmuje serwer (daty, godziny, liczby bez spacji). */
export function normalizeBrief(brief: WorkspaceBrief): WorkspaceBrief {
  const termin = briefDay(brief.termin);
  const singleDay = brief.eventSingleDay !== false;
  const end = briefTime(brief.eventEndTime);
  return {
    ...brief,
    termin,
    eventSingleDay: singleDay,
    eventEndDate: singleDay ? '' : briefDay(brief.eventEndDate),
    eventStartTime: briefTime(brief.eventStartTime),
    eventEndTime: end,
    eventEndNextDay: Boolean(singleDay && end && brief.eventEndNextDay),
    locationText: brief.locationText.trim(),
    guestCount: brief.guestCount.replace(/\s/g, ''),
    scope: brief.scope.trim(),
    budgetMin: brief.budgetMin.replace(/\s/g, '').replace(',', '.'),
    budgetMax: brief.budgetMax.replace(/\s/g, '').replace(',', '.'),
  };
}

/** Te same reguły co na serwerze (`saveInquiryBrief`) — komunikat przed wysłaniem. */
export function briefProblem(brief: WorkspaceBrief): string | null {
  const value = normalizeBrief(brief);
  if (value.guestCount && (!/^\d{1,6}$/.test(value.guestCount) || Number(value.guestCount) < 1)) return 'Liczba osób musi być liczbą całkowitą.';
  for (const amount of [value.budgetMin, value.budgetMax]) {
    if (amount && !/^\d+(?:\.\d{1,2})?$/.test(amount)) return 'Nieprawidłowa kwota budżetu.';
  }
  if (value.budgetMin && value.budgetMax && Number(value.budgetMin) > Number(value.budgetMax)) return 'Budżet „od” jest większy niż „do”.';
  if (value.termin && !value.eventSingleDay) {
    if (!value.eventEndDate) return 'Wybierz dzień zakończenia albo zaznacz event jednodniowy.';
    if (value.eventEndDate < value.termin) return 'Dzień zakończenia jest wcześniejszy niż dzień rozpoczęcia.';
  }
  return null;
}
