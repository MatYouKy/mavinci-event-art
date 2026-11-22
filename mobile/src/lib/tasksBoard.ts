import { supabase } from './supabase';
import { showcaseOfferDraftId } from './showcaseShared';

/*
 * Zadania w aplikacji — to samo API co aplikacja na Maca (`/bridge/native/v1/tasks`, `src/lib/native/tasks.ts`; token sesji
 * pracownika, RLS jak w CRM). Tablice: „Moja tablica zadań” (`/crm/tasks/mine` — prywatne zadania i zadania, do których jesteś
 * przypisany) i „Zadania firmowe” (`/crm/tasks`). Lista: `op=state` (skrót, uprawnienia, licznik czasu) + `op=items` (karty
 * z koszyków); bez zmian na serwerze — ostatnia tablica z pamięci. Zapis zadania (prywatne — z identyfikatorem nadanym w aplikacji,
 * więc ponowienie nie tworzy duplikatu), przeniesienie z licznikiem czasu, usunięcie, licznik, komentarze i załączniki
 * (`event-files/task-attachments`) — te same operacje co na Macu.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/tasks`;

export type TaskBoardKind = 'mine' | 'company';
export type TaskColumnId = 'todo' | 'in_progress' | 'review' | 'completed';
export type TaskPriorityId = 'low' | 'medium' | 'high' | 'urgent';

/** Kadrowanie zdjęcia jak `EmployeeAvatar` w CRM (przesunięcie w %, skala, dopasowanie). */
export type TaskAvatarCrop = { x: number; y: number; scale: number; fit: string };
export type TaskPerson = { id: string; name: string; avatarUrl: string | null; avatar: TaskAvatarCrop | null };

export type BoardTask = {
  id: string;
  title: string;
  titleLabel: string;
  description: string;
  priority: TaskPriorityId;
  boardColumn: TaskColumnId;
  orderIndex: number;
  dueDate: string | null;
  createdBy: string | null;
  createdAt: string | null;
  isPrivate: boolean;
  ownerId: string | null;
  eventId: string | null;
  inquiryId: string | null;
  workingBy: string | null;
  workingName: string;
  assignees: TaskPerson[];
  comments: number;
  attachments: number;
};

export type TaskBoardAccess = {
  employeeId: string; isAdmin: boolean; canCreate: boolean; canManage: boolean; canMove: boolean; autoTimer: boolean;
};
export type ActiveTaskTimer = { id: string; taskId: string | null; title: string; startTime: string };
export type TaskEmployee = { id: string; name: string; nickname: string };

export const TASK_COLUMNS: ReadonlyArray<{ id: TaskColumnId; color: string }> = [
  { id: 'todo', color: '#eab308' },
  { id: 'in_progress', color: '#3b82f6' },
  { id: 'review', color: '#a855f7' },
  { id: 'completed', color: '#22c55e' },
];

/** Nazwy kolumn jak na tablicach w CRM i na Macu (tablica prywatna: „Do sprawdzenia”, „Ukończone”). */
export function taskColumnLabel(column: TaskColumnId, board: TaskBoardKind): string {
  switch (column) {
    case 'todo': return 'Do zrobienia';
    case 'in_progress': return 'W trakcie';
    case 'review': return board === 'company' ? 'Sprawdzenie' : 'Do sprawdzenia';
    case 'completed': return board === 'company' ? 'Zakończone' : 'Ukończone';
  }
}

export const taskColumnColor = (column: TaskColumnId) => TASK_COLUMNS.find((item) => item.id === column)?.color || '#eab308';

export const TASK_PRIORITIES: ReadonlyArray<{ id: TaskPriorityId; label: string; color: string; rank: number }> = [
  { id: 'low', label: 'Niski', color: '#9ca3af', rank: 1 },
  { id: 'medium', label: 'Średni', color: '#60a5fa', rank: 2 },
  { id: 'high', label: 'Wysoki', color: '#fb923c', rank: 3 },
  { id: 'urgent', label: 'Pilne', color: '#f87171', rank: 4 },
];
export const taskPriority = (priority: string) => TASK_PRIORITIES.find((item) => item.id === priority) || TASK_PRIORITIES[1];

const isColumn = (value: unknown): value is TaskColumnId => TASK_COLUMNS.some((column) => column.id === value);
const isPriority = (value: unknown): value is TaskPriorityId => TASK_PRIORITIES.some((priority) => priority.id === value);

/** Dzień terminu (`YYYY-MM-DD`, czas polski) z zapisu w bazie (data albo znacznik czasu). */
export function taskDueDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Dzisiejszy dzień w czasie polskim (`YYYY-MM-DD`). */
export const taskToday = (now: Date = new Date()) => taskDueDay(now.toISOString()) || now.toISOString().slice(0, 10);

/** Termin na karcie: „Dziś”, „Jutro”, „Wczoraj” albo „12.11.2026”; stan — po terminie, wkrótce, później. */
export function taskDueBadge(value: string | null | undefined, done: boolean, now: Date = new Date()): { label: string; state: 'overdue' | 'soon' | 'later' | 'done' } | null {
  const day = taskDueDay(value);
  if (!day) return null;
  const today = taskToday(now);
  const shift = (days: number) => taskToday(new Date(now.getTime() + days * 86_400_000));
  const [year, month, date] = day.split('-');
  const label = day === today ? 'Dziś' : day === shift(1) ? 'Jutro' : day === shift(-1) ? 'Wczoraj' : `${date}.${month}.${year}`;
  if (done) return { label, state: 'done' };
  if (day < today) return { label, state: 'overdue' };
  if (day <= shift(1)) return { label, state: 'soon' };
  return { label, state: 'later' };
}

/** Kolejność kart jak w CRM i na Macu: priorytet (od pilnych), termin (najbliższy, bez terminu na końcu), kolejność na tablicy. */
export function sortBoardTasks<T extends Pick<BoardTask, 'priority' | 'dueDate' | 'orderIndex'>>(tasks: T[]): T[] {
  const due = (task: T) => {
    const time = task.dueDate ? Date.parse(task.dueDate) : NaN;
    return Number.isNaN(time) ? null : time;
  };
  return [...tasks].sort((a, b) => {
    const rank = taskPriority(b.priority).rank - taskPriority(a.priority).rank;
    if (rank) return rank;
    const x = due(a);
    const y = due(b);
    if (x !== null && y !== null && x !== y) return x - y;
    if (x !== null && y === null) return -1;
    if (x === null && y !== null) return 1;
    return a.orderIndex - b.orderIndex;
  });
}

/** Pozycja, na której karta stanie w kolumnie po przeniesieniu (ta sama kolejność co na tablicy). */
export function boardDropIndex(columnTasks: BoardTask[], task: BoardTask): number {
  const others = columnTasks.filter((item) => item.id !== task.id);
  return sortBoardTasks([...others, task]).findIndex((item) => item.id === task.id);
}

// MARK: Połączenie z serwerem

async function headers(json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'x-mavinci-client': 'phone',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

async function tasksGet<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers(false) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

async function tasksPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

// MARK: Tablica

type StateReply = { hash: string; buckets?: Record<string, string>; access?: TaskBoardAccess; timer?: ActiveTaskTimer | null };
type ItemsReply = { buckets?: Record<string, { hash: string; items: Record<string, unknown>[] }>; more?: string[] };
export type TaskBoardData = { tasks: BoardTask[]; access: TaskBoardAccess | null; timer: ActiveTaskTimer | null };

const text = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const textOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null);

function normalizeTask(raw: Record<string, unknown>): BoardTask | null {
  const id = text(raw.id);
  if (!id) return null;
  const people = Array.isArray(raw.assignees) ? (raw.assignees as Record<string, unknown>[]) : [];
  const avatar = (value: unknown): TaskAvatarCrop | null => {
    if (!value || typeof value !== 'object') return null;
    const crop = value as Record<string, unknown>;
    return { x: Number(crop.x) || 0, y: Number(crop.y) || 0, scale: Number(crop.scale) || 1, fit: text(crop.fit) || 'cover' };
  };
  return {
    id,
    title: text(raw.title),
    titleLabel: text(raw.titleLabel) || text(raw.title),
    description: text(raw.description),
    priority: isPriority(raw.priority) ? raw.priority : 'medium',
    boardColumn: isColumn(raw.boardColumn) ? raw.boardColumn : 'todo',
    orderIndex: Number(raw.orderIndex) || 0,
    dueDate: textOrNull(raw.dueDate),
    createdBy: textOrNull(raw.createdBy),
    createdAt: textOrNull(raw.createdAt),
    isPrivate: raw.isPrivate === true,
    ownerId: textOrNull(raw.ownerId),
    eventId: textOrNull(raw.eventId),
    inquiryId: textOrNull(raw.inquiryId),
    workingBy: textOrNull(raw.workingBy),
    workingName: text(raw.workingName),
    assignees: people.map((person) => ({
      id: text(person.id), name: text(person.name) || 'Pracownik', avatarUrl: textOrNull(person.avatarUrl), avatar: avatar(person.avatar),
    })).filter((person) => person.id),
    comments: Number(raw.comments) || 0,
    attachments: Number(raw.attachments) || 0,
  };
}

/** Ostatnia tablica zalogowanego pracownika (osobno „Moja” i „Firmowe”; po zmianie konta — pobierana od nowa). */
const cache = new Map<TaskBoardKind, { user: string; hash: string; data: TaskBoardData }>();

/** Karty tablicy, uprawnienia i licznik czasu. `force` — pełne pobranie mimo zgodnego skrótu. */
export async function loadTaskBoard(board: TaskBoardKind, force = false): Promise<TaskBoardData> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user?.id || '';
  const cached = cache.get(board);
  const known = cached && cached.user === user && !force ? cached : null;
  let state = await tasksGet<StateReply>('state', { board, hash: known?.hash || '' });
  if (known && state.hash === known.hash) {
    const fresh = { ...known.data, access: state.access ?? known.data.access, timer: state.timer ?? null };
    cache.set(board, { ...known, data: fresh });
    return fresh;
  }
  // Skrót się zmienił, ale serwer nie wysłał koszyków (odpowiedź dla zgodnego skrótu) — pełny stan.
  if (!state.buckets) state = await tasksGet<StateReply>('state', { board });
  const items: BoardTask[] = [];
  let pending = Object.keys(state.buckets || {});
  for (let round = 0; pending.length && round < 100; round += 1) {
    const reply = await tasksPost<ItemsReply>('items', { board, buckets: pending });
    Object.values(reply.buckets || {}).forEach((bucket) => {
      (bucket.items || []).forEach((raw) => {
        const task = normalizeTask(raw);
        if (task) items.push(task);
      });
    });
    // `more` — koszyki, które nie zmieściły się w odpowiedzi; bez postępu (pusta odpowiedź) — koniec, bez pętli.
    if (!Object.keys(reply.buckets || {}).length) break;
    pending = Array.isArray(reply.more) ? reply.more : [];
  }
  const tasks = Array.from(new Map(items.map((task) => [task.id, task])).values());
  const fresh: TaskBoardData = { tasks, access: state.access ?? null, timer: state.timer ?? null };
  cache.set(board, { user, hash: state.hash, data: fresh });
  return fresh;
}

/** Zmiana zadania — następne odświeżenie pobiera tablice od nowa (bez czekania na skrót). */
export const forgetTaskBoards = () => {
  cache.forEach((entry, board) => cache.set(board, { ...entry, hash: '' }));
};

/** Ostatnio pobrana tablica (pokazywana od razu po wejściu na ekran, zanim przyjdzie odpowiedź). */
export async function cachedTaskBoard(board: TaskBoardKind): Promise<TaskBoardData | null> {
  const { data } = await supabase.auth.getSession();
  const entry = cache.get(board);
  return entry && entry.user === (data.session?.user?.id || '') ? entry.data : null;
}

// MARK: Zapis

export type TaskSaveInput = {
  /** Edycja — id zadania; nowe zadanie prywatne — id nadane w formularzu (ponowienie nie tworzy duplikatu). */
  id: string | null;
  existing: boolean;
  title: string;
  description: string;
  priority: TaskPriorityId;
  boardColumn: TaskColumnId;
  /** `YYYY-MM-DD` albo `null` (bez terminu). */
  dueDate: string | null;
  /** Tablica firmowa — przypisani pracownicy (`null` — bez zmian). */
  assignees: string[] | null;
};

/** Nowy identyfikator zadania prywatnego (raz na formularz). */
export const newTaskId = () => showcaseOfferDraftId();

/** Zapis zadania (nowe albo edycja) — zwraca id zadania. */
export async function saveBoardTask(board: TaskBoardKind, input: TaskSaveInput): Promise<string> {
  const reply = await tasksPost<{ id?: string }>('save', {
    board,
    id: input.id || undefined,
    existing: input.existing,
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
      priority: input.priority,
      boardColumn: input.boardColumn,
      dueDate: input.dueDate,
    },
    ...(input.assignees ? { assignees: input.assignees } : {}),
  });
  forgetTaskBoards();
  const id = reply.id || input.id;
  if (!id) throw new Error('Serwer nie potwierdził zapisu zadania.');
  return id;
}

/** Zapis jednego pola z karty (priorytet, termin) — pozostałe dane bez zmian. */
export function saveBoardTaskFields(board: TaskBoardKind, task: BoardTask, change: Partial<Pick<TaskSaveInput, 'priority' | 'dueDate' | 'boardColumn' | 'title' | 'description'>>) {
  return saveBoardTask(board, {
    id: task.id,
    existing: true,
    title: change.title ?? task.title,
    description: change.description ?? task.description,
    priority: change.priority ?? task.priority,
    boardColumn: change.boardColumn ?? task.boardColumn,
    dueDate: change.dueDate !== undefined ? change.dueDate : taskDueDay(task.dueDate),
    assignees: null,
  });
}

/** Przeniesienie do kolumny; `working` — osoba pracująca (W trakcie), `startTimer` — nowy licznik czasu. */
export async function moveBoardTask(board: TaskBoardKind, id: string, column: TaskColumnId, options: { working?: boolean; startTimer?: boolean } = {}) {
  const reply = await tasksPost<{ timer?: ActiveTaskTimer | null }>('move', {
    board, id, column, working: options.working === true, startTimer: options.startTimer === true,
  });
  forgetTaskBoards();
  return reply.timer ?? null;
}

export async function deleteBoardTask(board: TaskBoardKind, id: string) {
  await tasksPost('delete', { board, id });
  forgetTaskBoards();
}

/** Licznik czasu: start (gdy nie działa inny), stop, switch (zakończ bieżący i rozpocznij dla zadania). */
export async function boardTaskTimer(board: TaskBoardKind, action: 'start' | 'stop' | 'switch', id?: string) {
  const reply = await tasksPost<{ timer?: ActiveTaskTimer | null }>('timer', { board, action, id });
  forgetTaskBoards();
  return reply.timer ?? null;
}

let employeesCache: TaskEmployee[] | null = null;
/** Aktywni pracownicy do przypisania (tablica firmowa). */
export async function taskEmployees(): Promise<TaskEmployee[]> {
  if (employeesCache) return employeesCache;
  const reply = await tasksGet<{ employees?: TaskEmployee[] }>('employees');
  employeesCache = Array.isArray(reply.employees) ? reply.employees : [];
  return employeesCache;
}

/** Komentarz do zadania (ten sam zapis co CRM i Mac; tablice od razu widzą nową liczbę komentarzy). */
export async function addTaskComment(id: string, content: string) {
  await tasksPost('comment', { id, content });
  forgetTaskBoards();
}

// MARK: Załączniki

/** Plik wybrany w aplikacji do dołączenia (zdjęcie, film, dokument, obraz ze schowka). */
export type TaskUploadFile = { uri: string; name: string; mimeType: string; size: number };

/** Największy plik przyjmowany przez serwer (jak w CRM i na Macu). */
export const TASK_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Jeden załącznik: plik z telefonu do serwera CRM (magazyn `event-files/task-attachments/<zadanie>/…` i wpis w zadaniu). */
export async function uploadTaskAttachment(taskId: string, file: TaskUploadFile): Promise<void> {
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) throw new Error(`Plik „${file.name}” jest większy niż 50 MB.`);
  const form = new FormData();
  // React Native wysyła plik z dysku po adresie (`uri`) — bez wczytywania całego pliku do pamięci.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
  const auth = await headers(false);
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?op=attach&id=${encodeURIComponent(taskId)}`, { method: 'POST', headers: auth, body: form });
  } catch {
    throw new Error(`Nie udało się wysłać pliku „${file.name}”. Sprawdź połączenie i spróbuj ponownie.`);
  }
  await parse(response);
  forgetTaskBoards();
}
