import 'server-only';
import type { NativeContext } from './auth';
import { collectionItems, collectionState, invalidateNativeSync, invalidateNativeSyncPrefix } from './sync';
import { formatSystemSubject } from '@/lib/ui/systemLabels';

/*
 * Zadania na Macu — te same tablice co w CRM:
 *  - „Zadania firmowe” (`/crm/tasks`, `TasksPageClient` + `tasksApi.getTasksList`): zadania niebędące prywatnymi, zapytaniami
 *    ani zadaniami wydarzeń,
 *  - „Moje zadania” (`/crm/tasks/mine`, `PrivateTasksBoardTab`): prywatne zadania pracownika i zadania, do których jest przypisany,
 *  - „Zadania wydarzenia” (karta wydarzenia, `EventTasksBoard`): wszystkie zadania z `event_id` wydarzenia.
 * Tokenem pracownika (RLS). Przypisania, osoba pracująca, liczba komentarzy i załączników — zbiorczo, zmiany wykrywa skrót koszyków.
 */

export type TaskBoard = 'company' | 'mine' | 'event';
export const taskSet = (board: TaskBoard, eventId?: string | null) => (board === 'event' ? `tasks-event-${eventId}` : `tasks-${board}`);
const PAGE = 1000;
const CHUNK = 150;

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

const FIELDS = 'id,title,description,priority,status,board_column,order_index,due_date,created_by,created_at,updated_at,currently_working_by,inquiry_id,event_id,is_private,owner_id';

async function pages(build: () => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function inChunks(ids: string[], load: (part: string[]) => Promise<Row[]>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) rows.push(...(await load(ids.slice(i, i + CHUNK))));
  return rows;
}

const name = (e: Row | null | undefined) => (e ? `${e.name ?? ''} ${e.surname ?? ''}`.trim() : '');
/** Kadrowanie zdjęcia jak `EmployeeAvatar` w CRM (`avatar_metadata.desktop`: przesunięcie w %, skala, dopasowanie). */
const avatar = (e: Row | null | undefined) => {
  const desktop = e?.avatar_metadata?.desktop;
  const position = desktop?.position;
  if (!position && !desktop?.objectFit) return null;
  return {
    x: Number(position?.posX) || 0,
    y: Number(position?.posY) || 0,
    scale: Number(position?.scale) || 1,
    fit: typeof desktop?.objectFit === 'string' ? desktop.objectFit : 'cover',
  };
};

async function loadBoard(ctx: NativeContext, board: TaskBoard, eventId?: string | null): Promise<Item[]> {
  const s = ctx.supabase;
  let tasks: Row[];
  if (board === 'company') {
    tasks = await pages(() => s.from('tasks').select(FIELDS).eq('is_private', false).eq('is_inquiry', false).is('event_id', null));
  } else if (board === 'event') {
    tasks = await pages(() => s.from('tasks').select(FIELDS).eq('event_id', eventId));
  } else {
    const [own, assigned] = await Promise.all([
      pages(() => s.from('tasks').select(FIELDS).eq('is_private', true).eq('owner_id', ctx.employee.id)),
      pages(() => s.from('tasks').select(`${FIELDS},task_assignees!inner(employee_id)`)
        .eq('task_assignees.employee_id', ctx.employee.id).eq('is_private', false)),
    ]);
    const byId = new Map<string, Row>();
    for (const task of [...own, ...assigned]) byId.set(String(task.id), task);
    tasks = [...byId.values()];
  }
  const ids = tasks.map((t) => String(t.id));
  const [assignees, comments, attachments] = await Promise.all([
    inChunks(ids, async (part) => {
      const { data, error } = await s.from('task_assignees')
        .select('task_id,employee_id,employees:employees!task_assignees_employee_id_fkey(name,surname,avatar_url,avatar_metadata)').in('task_id', part);
      if (error) throw error;
      return data || [];
    }),
    inChunks(ids, async (part) => {
      const { data, error } = await s.from('task_comments').select('task_id').in('task_id', part);
      if (error) throw error;
      return data || [];
    }),
    inChunks(ids, async (part) => {
      const { data } = await s.from('task_attachments').select('task_id').in('task_id', part);
      return data || [];
    }),
  ]);
  const working = [...new Set(tasks.map((t) => t.currently_working_by).filter(Boolean))] as string[];
  const workers = working.length
    ? ((await s.from('employees').select('id,name,surname').in('id', working)).data || [])
    : [];
  const workerName = new Map(workers.map((e: Row) => [String(e.id), name(e)]));
  type Person = { id: string; name: string; avatarUrl: string | null; avatar: ReturnType<typeof avatar> };
  const people = new Map<string, Person[]>();
  for (const a of assignees) {
    const list = people.get(String(a.task_id)) || [];
    list.push({ id: String(a.employee_id), name: name(a.employees) || 'Pracownik', avatarUrl: a.employees?.avatar_url || null, avatar: avatar(a.employees) });
    people.set(String(a.task_id), list);
  }
  const count = (rows: Row[]) => rows.reduce((map, r) => map.set(String(r.task_id), (map.get(String(r.task_id)) || 0) + 1), new Map<string, number>());
  const commentCount = count(comments);
  const attachmentCount = count(attachments);

  return tasks.map((t) => {
    const id = String(t.id);
    return {
      id,
      item: {
        id,
        title: String(t.title || ''),
        titleLabel: formatSystemSubject(t.title) || String(t.title || ''),
        description: String(t.description || ''),
        priority: String(t.priority || 'medium'),
        boardColumn: String(t.board_column || t.status || 'todo'),
        orderIndex: Number(t.order_index || 0),
        dueDate: t.due_date ?? null,
        createdBy: t.created_by ?? null,
        createdAt: t.created_at,
        isPrivate: !!t.is_private,
        ownerId: t.owner_id ?? null,
        eventId: t.event_id ?? null,
        inquiryId: t.inquiry_id ?? null,
        workingBy: t.currently_working_by ?? null,
        workingName: t.currently_working_by ? workerName.get(String(t.currently_working_by)) || '' : '',
        assignees: (people.get(id) || []).sort((a, b) => (a.id < b.id ? -1 : 1)),
        comments: commentCount.get(id) || 0,
        attachments: attachmentCount.get(id) || 0,
      },
    };
  });
}

/** Uprawnienia tablicy jak w CRM i ustawienie automatycznego licznika czasu (`shouldAutomateTaskTimer`). */
/**
 * Zarządzanie zadaniami wydarzenia jak `canManageTeam` w karcie CRM: administrator, uprawnienie `events_manage`, autor
 * lub opiekun sprzedaży wydarzenia, albo członek zespołu z zaakceptowanym przypisaniem i prawem zapraszania.
 */
export async function canManageEventTasks(ctx: NativeContext, eventId: string) {
  const e = ctx.employee;
  if (e.isAdmin || e.permissions.includes('events_manage')) return true;
  const [event, sells, assignment] = await Promise.all([
    ctx.supabase.from('events').select('created_by').eq('id', eventId).maybeSingle(),
    ctx.supabase.rpc('current_employee_sells_event', { p_event_id: eventId }),
    ctx.supabase.from('employee_assignments').select('status,can_invite_members').eq('event_id', eventId).eq('employee_id', e.id).maybeSingle(),
  ]);
  const creator = event.data?.created_by ? String(event.data.created_by) : '';
  if (creator && (creator === e.id || creator === e.authUserId)) return true;
  if (!sells.error && sells.data === true) return true;
  return assignment.data?.status === 'accepted' && assignment.data?.can_invite_members === true;
}

export async function taskAccess(ctx: NativeContext, board: TaskBoard, eventId?: string | null) {
  const e = ctx.employee;
  const has = (scope: string) => e.isAdmin || e.permissions.includes(scope);
  let autoTimer = true;
  if (e.isAdmin) {
    const { data } = await ctx.supabase.from('employees').select('preferences').eq('id', e.id).maybeSingle();
    autoTimer = (data?.preferences as Row | null)?.notifications?.autoStartTaskTimer !== false;
  }
  if (board === 'event') {
    const manage = eventId ? await canManageEventTasks(ctx, eventId) : false;
    return { employeeId: e.id, isAdmin: e.isAdmin, canCreate: manage, canManage: manage, canMove: manage, autoTimer };
  }
  return {
    employeeId: e.id,
    isAdmin: e.isAdmin,
    canCreate: board === 'mine' || has('tasks_create') || has('tasks_manage'),
    canManage: board === 'mine' || has('tasks_manage'),
    canMove: board === 'mine' || has('tasks_view') || has('tasks_manage'),
    autoTimer,
  };
}

/** Licznik czasu pracy zalogowanego pracownika (wpis bez końca). */
export async function activeTimer(ctx: NativeContext) {
  const { data } = await ctx.supabase.from('time_entries')
    .select('id,task_id,title,start_time,tasks(title)').eq('employee_id', ctx.employee.id).is('end_time', null)
    .order('start_time', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const task = (data as Row).tasks as Row | null;
  return {
    id: String(data.id),
    taskId: data.task_id ?? null,
    title: formatSystemSubject(task?.title || data.title || '') || 'Bez nazwy',
    startTime: data.start_time,
  };
}

export const tasksState = (ctx: NativeContext, board: TaskBoard, hash?: string, eventId?: string | null) =>
  collectionState(ctx, taskSet(board, eventId), (c) => loadBoard(c, board, eventId), hash);
export const tasksItems = (ctx: NativeContext, board: TaskBoard, buckets: unknown[], eventId?: string | null) =>
  collectionItems(ctx, taskSet(board, eventId), (c) => loadBoard(c, board, eventId), buckets);
/** Po zmianie zadania wszystkie tablice (firmowa, moja, wydarzeń i karty aplikacji) widzą ją od razu — u wszystkich pracowników. */
export const invalidateTasks = () => {
  invalidateNativeSync([taskSet('company'), taskSet('mine'), 'tasks']);
  invalidateNativeSyncPrefix('tasks-event-');
};
