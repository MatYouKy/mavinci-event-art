/**
 * Kroki realizacji wydarzenia — wspólne typy, etykiety, reguły przycisków i treść pomocy.
 * Identyczna kopia: mobile/src/lib/eventSteps.ts (pilnuje scripts/ci/check-shared-copies.mjs).
 * Stan kroków zmienia wyłącznie baza (RPC update_event_step / add_event_step, migracja 20261104200000);
 * ten plik tylko opisuje dane i podpowiada interfejsowi, które przyciski pokazać.
 * Bez importów — plik musi działać w Next.js i w React Native.
 */

export type EventStepRole = 'sales' | 'warehouse' | 'manager' | 'driver' | 'admin' | 'author';
export type EventStepStatus = 'open' | 'in_progress' | 'done' | 'problem' | 'skipped' | 'archived';
export type EventStepStage =
  | 'formalities'
  | 'handoff'
  | 'preparation'
  | 'dispatch'
  | 'realization'
  | 'return'
  | 'settlement';
export type EventStepKind = 'handoff' | 'order' | 'stock_check' | 'venue_confirmation' | 'task' | 'approval';
export type EventStepSource = 'system' | 'product' | 'equipment' | 'shortage' | 'rental' | 'manual';
export type EventStepAction = 'take' | 'start' | 'done' | 'problem' | 'reopen' | 'skip';
export type ManualEventStepRole = Exclude<EventStepRole, 'author'>;
export type ManualEventStepKind = Exclude<EventStepKind, 'handoff' | 'approval'>;

export type EventStepHistoryEntry = {
  action: string;
  to_status: EventStepStatus | null;
  note: string | null;
  by: string | null;
  at: string;
};

export type EventStep = {
  id: string;
  event_id: string;
  key: string;
  stage: EventStepStage;
  kind: EventStepKind;
  source: EventStepSource;
  title: string;
  details: string | null;
  quantity: number | null;
  unit: string | null;
  supplier: string | null;
  owner_role: EventStepRole;
  due_at: string | null;
  status: EventStepStatus;
  status_note: string | null;
  ordered_at: string | null;
  expected_at: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  blocks_ready: boolean;
  sort_order: number;
  is_mine: boolean;
  completed_by_me: boolean;
  assignee: { id: string; name: string | null; phone: string | null } | null;
  blocked_by: { key: string; title: string; owner_role: EventStepRole }[];
  overdue: boolean;
  can_act: boolean;
  can_override: boolean;
  system_managed: boolean;
  history: EventStepHistoryEntry[];
};

export type EventStepsSnapshot = {
  event_id: string;
  my_roles: Record<EventStepRole, boolean>;
  can_override: boolean;
  can_add: boolean;
  steps: EventStep[];
  waiting_for: EventStep[];
  progress: Partial<Record<EventStepStage, { total: number; done: number }>>;
  /** Czy bieżąca osoba widzi etapy handlowe (Formalności, Rozliczenie). */
  show_commercial?: boolean;
};

export type MyEventStep = EventStep & {
  event: { id: string; name: string; event_date: string | null; location: string | null };
};

export const EVENT_STEP_ROLE_LABELS: Record<EventStepRole, string> = {
  sales: 'Sprzedawca',
  warehouse: 'Magazyn',
  manager: 'Kierownik realizacji',
  driver: 'Kierowca',
  admin: 'Administrator',
  author: 'Prowadzący wydarzenie',
};

export const EVENT_STEP_STAGE_LABELS: Record<EventStepStage, string> = {
  formalities: 'Formalności',
  handoff: 'Przekazanie',
  preparation: 'Przygotowanie i zamówienia',
  dispatch: 'Wydanie sprzętu',
  realization: 'Realizacja',
  return: 'Zwrot sprzętu',
  settlement: 'Rozliczenie',
};

export const EVENT_STEP_STAGE_ORDER: EventStepStage[] = [
  'formalities',
  'handoff',
  'preparation',
  'dispatch',
  'realization',
  'return',
  'settlement',
];

export const EVENT_STEP_STATUS_LABELS: Record<EventStepStatus, string> = {
  open: 'Do zrobienia',
  in_progress: 'W toku',
  done: 'Zrobione',
  problem: 'Problem',
  skipped: 'Pominięte',
  archived: 'Archiwum',
};

export const EVENT_STEP_KIND_LABELS: Record<EventStepKind, string> = {
  handoff: 'Przekazanie',
  order: 'Zamówienie',
  stock_check: 'Sprawdzenie stanu',
  venue_confirmation: 'Potwierdzenie z klientem / obiektem',
  task: 'Zadanie',
  approval: 'Potwierdzenie',
};

export const EVENT_STEP_ANCHOR_LABELS: Record<'event' | 'loading', string> = {
  event: 'przed wydarzeniem',
  loading: 'przed załadunkiem',
};

export const MANUAL_EVENT_STEP_ROLES: ManualEventStepRole[] = ['warehouse', 'sales', 'manager', 'driver', 'admin'];
export const MANUAL_EVENT_STEP_KINDS: ManualEventStepKind[] = ['task', 'order', 'stock_check', 'venue_confirmation'];

/** Kolor statusu: 'neutral' | 'progress' | 'success' | 'danger' | 'muted' | 'warning' (po terminie) — każdy interfejs mapuje go na własną paletę. */
export type EventStepTone = 'neutral' | 'progress' | 'success' | 'danger' | 'muted' | 'warning';

export function eventStepTone(step: Pick<EventStep, 'status' | 'overdue' | 'blocked_by'>): EventStepTone {
  if (step.status === 'problem') return 'danger';
  if (step.status === 'done') return 'success';
  if (step.status === 'skipped' || step.status === 'archived') return 'muted';
  if (step.overdue) return 'warning';
  if (step.status === 'in_progress') return 'progress';
  return step.blocked_by.length ? 'muted' : 'neutral';
}

/** Etapy widoczne tylko dla obszaru handlowego (baza filtruje je także w RLS). */
export const EVENT_STEP_COMMERCIAL_STAGES: EventStepStage[] = ['formalities', 'settlement'];

/** Kroki wynikające z procesu: zamykają się same i nie da się ich „otworzyć ponownie” z listy kroków. */
const PROCESS_STEP_KEYS = new Set([
  'warehouse_accept',
  'warehouse_ready',
  'manager_appointed',
  'dispatch_out',
  'realization_start',
  'realization_complete',
  'settlement_invoice',
  'settlement_paid',
  'settlement_summary',
  'settlement_summary_approval',
  'formal_details',
  'formal_contract',
  'formal_deposit',
  'wedding_card',
  'team_ready',
  'agenda_ready',
  'transport_planned',
]);

/** Zakładka wydarzenia, w której zamyka się krok (link „Przejdź”). */
export const EVENT_STEP_TARGET_TAB: Record<string, string> = {
  formal_details: 'details',
  formal_contract: 'contract',
  formal_deposit: 'finances',
  wedding_card: 'agenda',
  team_ready: 'team',
  agenda_ready: 'agenda',
  transport_planned: 'logistics',
  manager_appointed: 'team',
  dispatch_out: 'equipment',
  warehouse_ready: 'equipment',
  return_check: 'equipment',
  settlement_invoice: 'finances',
  settlement_paid: 'finances',
  settlement_summary: 'summary',
  settlement_summary_approval: 'summary',
};

const LIVE_STATUSES: EventStepStatus[] = ['open', 'in_progress', 'problem'];

export function isEventStepLive(step: Pick<EventStep, 'status'>): boolean {
  return LIVE_STATUSES.includes(step.status);
}

/** Przyciski, które można pokazać przy kroku (kolejność = kolejność w interfejsie). Ostatecznie decyduje baza. */
export function eventStepAvailableActions(step: EventStep): EventStepAction[] {
  const actions: EventStepAction[] = [];
  const live = isEventStepLive(step);
  if (live && step.can_act) {
    if (!step.system_managed) actions.push('done');
    if (step.source !== 'system' && step.status !== 'in_progress') actions.push('start');
    if (!step.is_mine) actions.push('take');
    actions.push('problem');
  }
  if (live && step.can_override) actions.push('skip');
  const reopenable = step.status === 'skipped' || (step.status === 'done' && !PROCESS_STEP_KEYS.has(step.key));
  if (reopenable && (step.can_override || step.completed_by_me)) actions.push('reopen');
  return actions;
}

/** Główny przycisk kroku (np. w „Moje kroki”): otwarte zamówienie → „Zamówione”, w pozostałych przypadkach „Gotowe”. */
export function eventStepPrimaryAction(step: EventStep, actions: EventStepAction[] = eventStepAvailableActions(step)): EventStepAction | null {
  if (step.kind === 'order' && actions.includes('start')) return 'start';
  if (actions.includes('done')) return 'done';
  if (actions.includes('start')) return 'start';
  if (actions.includes('take')) return 'take';
  return null;
}

/** Godzina przyjmowana, gdy w polu terminu lub dostawy podano samą datę (CRM i aplikacja). */
export const EVENT_STEP_DEFAULT_HOUR = 10;

/** Czy przycisk jest zablokowany przez niezamknięte wcześniejsze kroki. */
export function eventStepActionBlocked(step: EventStep, action: EventStepAction): boolean {
  return (action === 'done' || action === 'start') && step.blocked_by.length > 0;
}

const PRIMARY_LABELS: Record<string, string> = {
  sales_handoff: 'Przekazane do magazynu',
  warehouse_accept: 'Przyjmuję do przygotowania',
  warehouse_ready: 'Gotowe do wydania',
  dispatch_out: 'Wydane — załadunek zgodny',
  dispatch_receive: 'Odebrane — zgodne z listą',
  realization_start: 'Przejmuję realizację',
  realization_complete: 'Zakończ z raportem',
  return_handover: 'Oddane do magazynu',
  return_check: 'Zwrot przyjęty — OK',
  client_requirements: 'Potwierdzone',
};

const KIND_DONE_LABELS: Record<EventStepKind, string> = {
  order: 'Dostarczone',
  stock_check: 'Sprawdzone — OK',
  venue_confirmation: 'Potwierdzone',
  handoff: 'Przekazane',
  task: 'Zrobione',
  approval: 'Potwierdzone',
};

export function eventStepActionLabel(step: Pick<EventStep, 'key' | 'kind'>, action: EventStepAction): string {
  switch (action) {
    case 'done':
      return PRIMARY_LABELS[step.key] ?? KIND_DONE_LABELS[step.kind] ?? 'Gotowe';
    case 'start':
      return step.kind === 'order' ? 'Zamówione' : 'Rozpoczynam';
    case 'take':
      return 'Biorę to';
    case 'problem':
      return 'Zgłoś problem';
    case 'reopen':
      return 'Otwórz ponownie';
    case 'skip':
      return 'Pomiń';
  }
}

export type EventStepNoteRule = { required: boolean; minLength: number; label: string; placeholder: string };

/** Notatka przy czynności: kiedy wymagana i co w niej napisać (te same progi co w bazie). */
export function eventStepNoteRule(step: Pick<EventStep, 'key' | 'kind'>, action: EventStepAction): EventStepNoteRule | null {
  if (action === 'problem') {
    return { required: true, minLength: 5, label: 'Opis problemu', placeholder: 'Co się stało, ile brakuje, co proponujesz' };
  }
  if (action === 'skip') {
    return { required: true, minLength: 5, label: 'Powód pominięcia', placeholder: 'Dlaczego ten krok nie jest potrzebny' };
  }
  if (action === 'reopen') {
    return { required: true, minLength: 1, label: 'Powód ponownego otwarcia', placeholder: 'Co trzeba poprawić' };
  }
  if (action === 'done' && step.key === 'realization_complete') {
    return { required: true, minLength: 5, label: 'Raport z realizacji', placeholder: 'Przebieg, dodatkowe godziny, uwagi klienta, szkody' };
  }
  if (action === 'done' && step.key === 'dispatch_out') {
    return { required: false, minLength: 5, label: 'Rozbieżności załadunku', placeholder: 'Wymagane, gdy nie wszystkie pozycje są odhaczone' };
  }
  if (action === 'start' && step.kind === 'order') {
    return { required: false, minLength: 0, label: 'Notatka do zamówienia', placeholder: 'Numer zamówienia, ustalenia' };
  }
  if (action === 'done' || action === 'start') {
    return { required: false, minLength: 0, label: 'Notatka (opcjonalnie)', placeholder: 'Z kim, kiedy, co ustalono' };
  }
  return null;
}

/** Czy czynność ma pola zamówienia (dostawca, data dostawy). */
export function eventStepNeedsOrderFields(step: Pick<EventStep, 'kind'>, action: EventStepAction): boolean {
  return action === 'start' && step.kind === 'order';
}

/** Czy czynność wymaga okna (notatka wymagana albo pola zamówienia); pozostałe można wykonać jednym dotknięciem. */
export function eventStepActionNeedsForm(step: Pick<EventStep, 'key' | 'kind'>, action: EventStepAction): boolean {
  const rule = eventStepNoteRule(step, action);
  return Boolean(rule?.required) || eventStepNeedsOrderFields(step, action) || (action === 'done' && step.key === 'dispatch_out');
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatEventStepDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** „do 12.11.2026, 10:00”, „dziś do 10:00”, „po terminie 2 dni”. */
export function eventStepDueLabel(step: Pick<EventStep, 'due_at' | 'status'>, now: Date = new Date()): string {
  if (!step.due_at) return '';
  const due = new Date(step.due_at);
  if (Number.isNaN(due.getTime())) return '';
  if (!isEventStepLive(step)) return `termin ${formatEventStepDate(step.due_at)}`;
  const diffMs = due.getTime() - now.getTime();
  if (diffMs < 0) {
    const days = Math.floor(-diffMs / 86_400_000);
    const hours = Math.floor(-diffMs / 3_600_000);
    if (days >= 1) return `po terminie ${days} ${days === 1 ? 'dzień' : 'dni'}`;
    return hours >= 1 ? `po terminie ${hours} godz.` : 'termin minął';
  }
  const sameDay = due.toDateString() === now.toDateString();
  if (sameDay) return `dziś do ${pad(due.getHours())}:${pad(due.getMinutes())}`;
  return `do ${formatEventStepDate(step.due_at)}`;
}

export function eventStepOwnerLabel(step: Pick<EventStep, 'owner_role' | 'assignee'>): string {
  const role = EVENT_STEP_ROLE_LABELS[step.owner_role];
  return step.assignee?.name ? `${step.assignee.name} · ${role}` : `${role} (nieprzypisane)`;
}

export function eventStepQuantityLabel(step: Pick<EventStep, 'quantity' | 'unit'>): string {
  if (step.quantity == null) return '';
  const value = Number(step.quantity);
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace('.', ',');
  return step.unit ? `${text} ${step.unit}` : text;
}

const HISTORY_ACTION_LABELS: Record<string, string> = {
  add: 'dodano krok',
  take: 'przejęto krok',
  start: 'rozpoczęto',
  done: 'zamknięto',
  problem: 'zgłoszono problem',
  reopen: 'otwarto ponownie',
  skip: 'pominięto',
  auto_done: 'zamknięto automatycznie',
  auto_reopen: 'otwarto ponownie w procesie',
};

export function eventStepHistoryLabel(entry: EventStepHistoryEntry): string {
  const action = HISTORY_ACTION_LABELS[entry.action] ?? 'zmiana kroku';
  return [formatEventStepDate(entry.at), entry.by, action].filter(Boolean).join(' · ');
}

/** Kroki pogrupowane według etapów (tylko etapy, które mają kroki). */
export function groupEventStepsByStage(steps: EventStep[]): { stage: EventStepStage; label: string; steps: EventStep[] }[] {
  return EVENT_STEP_STAGE_ORDER.map(stage => ({
    stage,
    label: EVENT_STEP_STAGE_LABELS[stage],
    steps: steps.filter(step => step.stage === stage),
  })).filter(group => group.steps.length > 0);
}

/** Komunikat błędu z bazy (RPC zwraca czytelne komunikaty po polsku). */
export function eventStepErrorMessage(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  if (/Failed to fetch|Network request failed|fetch failed/i.test(message)) {
    return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  }
  return message || 'Nie udało się zapisać kroku. Spróbuj ponownie.';
}

// ---------------------------------------------------------------------------------------------------------------
// Pomoc: zakres odpowiedzialności i jak zamknąć swój zakres — ta sama treść w CRM i w aplikacji.
// ---------------------------------------------------------------------------------------------------------------

export type EventStepsHelpRole = Exclude<EventStepRole, 'author'>;

export type EventStepsHelpSection = {
  role: EventStepsHelpRole;
  title: string;
  summary: string;
  responsibilities: string[];
  steps: { title: string; how: string }[];
  closeScope: string[];
  notYours: string;
};

export const EVENT_STEPS_HELP: EventStepsHelpSection[] = [
  {
    role: 'sales',
    title: 'Sprzedawca',
    summary:
      'Sprzedajesz i przekazujesz wydarzenie do realizacji. Odpowiadasz za to, żeby magazyn i kierownik dostali komplet informacji, a klient i obiekt znali wymagania usług.',
    responsibilities: [
      'Zaakceptowana oferta z pełną listą usług; sprzęt zarezerwowany, braki zaznaczone przy rezerwacji.',
      'Dane wydarzenia: miejsce, godziny, osoba kontaktowa na miejscu, uwagi dla ekipy.',
      'Wymagania usług wobec klienta i obiektu (np. zgoda na dym ciężki, wyłączenie czujek, zasilanie) — potwierdzone przed wydarzeniem.',
      'Kontakt z klientem do końca realizacji. Zmianę zakresu wprowadzasz w ofercie — kroki przeliczą się same.',
    ],
    steps: [
      {
        title: 'Formalności',
        how: 'Etap „Formalności” pokazuje: kluczowe dane wydarzenia (data, miejsce, klient), podpisaną umowę i zaliczkę z harmonogramu płatności. Kroki zamykają się same, gdy uzupełnisz dane w zakładkach Szczegóły, Umowa i Finanse. Widzą je tylko osoby z dostępem handlowym.',
      },
      {
        title: 'Przekaż realizację do magazynu',
        how: 'Na wydarzeniu w sekcji „Kroki realizacji” kliknij „Przekazane do magazynu”, gdy oferta, sprzęt i dane są kompletne. Krok zamknie się sam, jeśli magazyn przyjmie realizację wcześniej.',
      },
      {
        title: 'Potwierdź z klientem i obiektem wymagania usług',
        how: 'Krok pokazuje listę wymagań z usług. Potwierdź każdy punkt (mail lub telefon), w notatce wpisz z kim i kiedy, kliknij „Potwierdzone”. Gdy obiekt się nie zgadza — „Zgłoś problem” z opisem; kierownik i prowadzący dostaną powiadomienie.',
      },
      {
        title: 'Wyznacz kierownika realizacji (prowadzący wydarzenie)',
        how: 'Zakładka „Zespół” → kierownik realizacji. Krok zamknie się sam. Bez kierownika magazyn nie oznaczy przygotowania jako gotowego.',
      },
      {
        title: 'Zespół, agenda i transport (prowadzący wydarzenie)',
        how: 'Kroki zamykają się same: zespół — gdy wszyscy zaproszeni potwierdzą udział; agenda — po jej przygotowaniu; transport — gdy każde auto ma kierowcę. Na weselu dochodzi „Karta weselna wysłana do akceptacji”.',
      },
      {
        title: 'Dodatkowe ustalenia',
        how: '„Dodaj krok” na wydarzeniu, np. „Potwierdź godzinę wjazdu z obiektem”. Wybierz właściciela i termin — dostanie przypomnienie.',
      },
      {
        title: 'Wyślij podsumowanie wydarzenia',
        how: 'Po wydarzeniu zakładka „Podsumowanie”: przychody i koszty netto uzupełniają się same (faktury, koszty, podwykonawcy, ekipa, prowizje). Potwierdź netto przy kosztach wpisanych ręcznie, dopisz brakujące pozycje, oznacz wykonawców zewnętrznych i kliknij „Wyślij do zatwierdzenia”. Krok zamknie się sam; po zatwierdzeniu przez administratora prowizje są do wypłaty.',
      },
    ],
    closeScope: [
      'Formalności zamknięte: dane wydarzenia, podpisana umowa, zaliczka (jeśli jest w harmonogramie).',
      'Kroki „Przekaż realizację”, „Potwierdź wymagania usług” i (jako prowadzący) „Wyznacz kierownika”, zespół, agenda i transport są zrobione.',
      'Na wydarzeniu nie ma Twoich kroków „Do zrobienia” ani „Problem” — sprawdzisz to w „Moje kroki”.',
      'Po wydarzeniu: podsumowanie wysłane do zatwierdzenia (zakładka Podsumowanie) — z niego liczą się prowizje. Fakturę wystawia administrator.',
    ],
    notYours:
      'Nie przyjmujesz realizacji za magazyn, nie potwierdzasz załadunku i nie pomijasz kroków innych ról — system na to nie pozwala (rozdział odpowiedzialności).',
  },
  {
    role: 'warehouse',
    title: 'Magazyn',
    summary:
      'Przygotowujesz sprzęt, zamówienia z wyprzedzeniem i sprawdzenia stanu, wydajesz sprzęt i przyjmujesz zwrot. Osoba, która przyjmie wydarzenie, zostaje jego opiekunem w magazynie.',
    responsibilities: [
      'Przyjęcie realizacji w terminie: do 2 dni od akceptacji oferty, najpóźniej dzień przed wydarzeniem.',
      'Zamówienia z wyprzedzeniem z konfiguracji usług (np. suchy lód min. 4 dni przed wydarzeniem): zamówione, potem dostarczone.',
      'Sprawdzenie stanu sprzętu oznaczonego „Sprawdzić stan przed wydaniem” (np. wytwornica dymu, termobox).',
      'Braki z rezerwacji i wynajmy zewnętrzne — zapewnione przed „Gotowe do wydania”.',
      'Wydanie zgodne z listą załadunku; przyjęcie zwrotu i zgłoszenie braków lub uszkodzeń.',
    ],
    steps: [
      {
        title: 'Przyjmij realizację',
        how: '„Przyjmuję do przygotowania” w krokach (albo w panelu Magazyn). Kroki magazynu zostaną przypisane do Ciebie. Inna osoba z magazynu może przejąć pojedynczy krok przyciskiem „Biorę to”.',
      },
      {
        title: 'Zamówienia z wyprzedzeniem',
        how: '„Zamówione” — podaj dostawcę i datę dostawy. Po odbiorze „Dostarczone”. Gdy dostawca zawodzi — „Zgłoś problem”: kierownik i prowadzący dostaną powiadomienie.',
      },
      {
        title: 'Sprawdzenie stanu',
        how: 'Wykonaj test według instrukcji w kroku i kliknij „Sprawdzone — OK” albo „Zgłoś problem” z opisem usterki.',
      },
      {
        title: 'Braki i wynajmy',
        how: 'Zapewnij sprzęt (wynajem, zakup, zamiana w rezerwacji). Brak rozwiązany w rezerwacji zamyka się sam.',
      },
      {
        title: 'Gotowe do wydania',
        how: 'Możliwe dopiero, gdy wszystkie kroki przygotowania są zamknięte i jest kierownik realizacji. Kłódka przy kroku i lista „Czekamy na” pokazują, czego brakuje i u kogo.',
      },
      {
        title: 'Wydanie sprzętu',
        how: 'Odhacz pozycje na liście załadunku (zakładka Sprzęt), potem „Wydane — załadunek zgodny”. Nieodhaczone pozycje wymagają notatki. Wydanie blokuje listę załadunku.',
      },
      {
        title: 'Przyjęcie zwrotu',
        how: 'Po realizacji sprawdź sprzęt z listą: „Zwrot przyjęty — OK” albo „Zgłoś problem” (brak, uszkodzenie) z opisem.',
      },
    ],
    closeScope: [
      'Wszystkie kroki magazynu na wydarzeniu są „Zrobione” (albo „Pominięte” z powodem przez administratora).',
      'Zwrot przyjęty, braki i uszkodzenia opisane w kroku.',
      'W „Moje kroki” nie masz kroków po terminie.',
    ],
    notYours:
      'Nie przyjmujesz do przygotowania wydarzeń, które sam sprzedałeś lub prowadzisz — wtedy robi to inna osoba z magazynu.',
  },
  {
    role: 'manager',
    title: 'Kierownik realizacji',
    summary:
      'Prowadzisz wydarzenie na miejscu: przejmujesz sprzęt od magazynu, startujesz i kończysz realizację, oddajesz sprzęt do magazynu.',
    responsibilities: [
      'Odbiór sprzętu zgodnego z listą (gdy na wydarzenie nie jedzie kierowca).',
      'Start realizacji na miejscu i kontakt z klientem w trakcie.',
      'Raport końcowy: przebieg, dodatkowe godziny, uwagi klienta, szkody.',
      'Oddanie sprzętu do magazynu z opisem braków i uszkodzeń.',
    ],
    steps: [
      {
        title: 'Przed wyjazdem',
        how: 'Pobierz „Kartę imprezy” (kontakty, harmonogram, auta, sprzęt, wytyczne). Sprawdź „Czekamy na” — jeśli coś blokuje wyjazd, zadzwoń do osoby z kroku.',
      },
      {
        title: 'Odbierz sprzęt i auto',
        how: '„Odebrane — zgodne z listą” albo „Zgłoś problem”. Od tej chwili odpowiadasz za sprzęt w drodze i na miejscu.',
      },
      {
        title: 'Przejmij realizację',
        how: 'Na miejscu „Przejmuję realizację”. Wymaga gotowości magazynu.',
      },
      {
        title: 'Zakończ z raportem',
        how: '„Zakończ z raportem” i krótki opis przebiegu. Raport trafia do prowadzącego i do rozliczenia.',
      },
      {
        title: 'Oddaj sprzęt',
        how: '„Oddane do magazynu”. Braki i uszkodzenia wpisz w notatce albo zgłoś jako problem.',
      },
    ],
    closeScope: [
      'Start, zakończenie z raportem i oddanie sprzętu są zrobione.',
      'Każdy problem z miejsca jest zgłoszony w kroku (nie tylko telefonicznie).',
    ],
    notYours: 'Nie oznaczasz gotowości magazynu i nie przyjmujesz zwrotu za magazyn.',
  },
  {
    role: 'driver',
    title: 'Kierowca',
    summary: 'Odbierasz auto i sprzęt, odpowiadasz za nie w drodze i przekazujesz je na miejscu oraz po powrocie.',
    responsibilities: [
      'Odbiór auta ze stanem licznika i sprawdzenie załadunku z listą.',
      'Bezpieczny transport sprzętu i ludzi według planu trasy.',
      'Zwrot auta ze stanem licznika.',
    ],
    steps: [
      {
        title: 'Odbierz sprzęt i auto',
        how: 'Zapisz odbiór auta z licznikiem w aplikacji (Flota) — krok „Odbierz sprzęt i auto” zamknie się sam. Możesz też kliknąć „Odebrane — zgodne z listą” w krokach.',
      },
      {
        title: 'Rozbieżności',
        how: 'Brakuje czegoś na liście albo auto ma usterkę — „Zgłoś problem” z opisem. Kierownik i prowadzący dostaną powiadomienie.',
      },
    ],
    closeScope: ['Odbiór i zwrot auta zapisane z licznikiem.', 'Sprzęt przekazany kierownikowi lub magazynowi.'],
    notYours: 'Nie potwierdzasz wydania z magazynu — to robi magazyn.',
  },
  {
    role: 'admin',
    title: 'Administrator',
    summary: 'Pilnujesz terminów całego procesu i rozliczenia wydarzenia.',
    responsibilities: [
      'Faktura i wpłata za wydarzenie — kroki rozliczenia zamykają się same po wystawieniu faktury i zaksięgowaniu wpłaty.',
      'Zatwierdzenie podsumowania wydarzenia — zamraża prowizje sprzedawców do wypłaty.',
      'Reakcja na eskalacje (krok 2 dni po terminie).',
      'Pominięcie kroku, który nie jest potrzebny — zawsze z powodem.',
      'Konfiguracja usług („Przygotowanie i zamówienia”) i sprzętu („Sprawdzić stan przed wydaniem”).',
    ],
    steps: [
      {
        title: 'Konfiguracja usług',
        how: 'Oferty → Produkty → usługa → „Przygotowanie i zamówienia”: co zamówić lub sprawdzić, ile dni przed wydarzeniem lub załadunkiem, kto odpowiada, dostawca i ilość na sztukę usługi.',
      },
      {
        title: 'Sprzęt ze sprawdzeniem stanu',
        how: 'Magazyn → sprzęt → „Sprawdzić stan przed każdym wydaniem” i instrukcja testu. Każde wydarzenie z tym sprzętem dostanie krok dla magazynu.',
      },
      {
        title: 'Zatwierdź podsumowanie',
        how: 'Zakładka „Podsumowanie”: sprawdź przychody, koszty netto i prowizje (pracownik 5% / 10% od zysku, sprzedawca zewnętrzny od faktury netto minus wykonawcy zewnętrzni). „Zatwierdź” zamraża kwoty do wypłaty; „Zwróć do poprawy” z uwagą odsyła sprzedawcy. Zmiana po wypłacie tworzy dopłatę albo potrącenie.',
      },
      {
        title: 'Eskalacje i pomijanie',
        how: 'Po eskalacji skontaktuj się z właścicielem kroku. Krok zbędny — „Pomiń” z powodem; powód widać w historii kroku.',
      },
    ],
    closeScope: ['Faktura wystawiona, wpłata zaksięgowana, podsumowanie zatwierdzone.', 'Żadna eskalacja nie czeka bez reakcji.'],
    notYours: 'Nie zamykasz kroków innych ról „za kogoś” bez powodu — użyj „Pomiń” z wyjaśnieniem albo poproś właściciela.',
  },
];

export const EVENT_STEPS_RULES: string[] = [
  'Każdy krok ma właściciela (rolę i osobę) oraz termin. Krok zamyka jego właściciel przyciskiem — system zapisuje kto i kiedy.',
  '„Czekamy na” pokazuje kroki, które można wykonać teraz: kto, co i do kiedy. Kłódka oznacza krok czekający na wcześniejsze kroki.',
  'Kroki z procesu (dane wydarzenia, umowa, zaliczka, zespół, agenda, transport, przyjęcie przez magazyn, gotowość, kierownik, załadunek, start, zakończenie, faktura, wpłata, podsumowanie) zamykają się same, gdy zdarzy się to w systemie.',
  'Formalności i rozliczenie widzą tylko osoby z dostępem handlowym. Magazyn, kierownik realizacji i ekipa widzą kroki realizacji bez kwot i dokumentów.',
  'Zmiana oferty, sprzętu, etapów lub dat przelicza kroki i terminy automatycznie.',
  'Powiadomienia: nowy krok (najwcześniej tydzień przed terminem), dzień przed terminem, po terminie (także kierownik i prowadzący), 2 dni po terminie — administratorzy.',
  'Problem zgłaszaj w kroku z opisem — kierownik i prowadzący dostaną powiadomienie, a krok zostanie oznaczony na czerwono.',
  'Pominąć krok może administrator albo osoba z uprawnieniem do zarządzania wydarzeniami — zawsze z powodem.',
];

/** Sekcje pomocy w kolejności: najpierw role bieżącej osoby na tym wydarzeniu, potem pozostałe. */
export function eventStepsHelpForRoles(myRoles?: Partial<Record<EventStepRole, boolean>> | null): {
  mine: EventStepsHelpSection[];
  others: EventStepsHelpSection[];
} {
  const has = (role: EventStepsHelpRole) => Boolean(myRoles?.[role] || (role === 'sales' && myRoles?.author));
  const mine = EVENT_STEPS_HELP.filter(section => has(section.role) && !(section.role === 'admin' && !myRoles?.admin));
  const others = EVENT_STEPS_HELP.filter(section => !mine.includes(section));
  return { mine, others };
}
