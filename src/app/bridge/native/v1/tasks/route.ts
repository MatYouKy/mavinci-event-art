import { randomUUID } from 'node:crypto';
import { nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { activeTimer, canManageEventTasks, invalidateTasks, taskAccess, tasksItems, tasksState, tasksWidget, type TaskBoard } from '@/lib/native/tasks';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { taskDueFromInput, taskDueParts } from '@/lib/CRM/tasks/taskDue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Zadania dla aplikacji na Maca — te same zapisy co CRM (`tasksApi.ts`, `TasksPageClient`, `PrivateTasksBoardTab`,
 * `TaskDetailClient`): zadanie firmowe z przypisaniami (+ powiadomienie push), zadanie prywatne (idempotentny zapis z id
 * z aplikacji), przeniesienie kolumny z osobą pracującą, licznik czasu (`time_entries`), komentarze i załączniki
 * (`event-files/task-attachments`). Tokenem pracownika — RLS jak w przeglądarce.
 * Termin (`save`: `dueDate` + `dueTime`): dzień i opcjonalna godzina w czasie polskim (`taskDue.ts`; bez godziny — cały dzień,
 * 23:59). Starsza wersja aplikacji wysyła sam dzień (bez `dueTime`) — przy edycji ten sam dzień z godziną zostaje z godziną.
 * GET op=widget — widżet „Moje zadania” na Macu: otwarte zadania z „Moich zadań” i licznik czasu (`tasksWidget`).
 * Panel zadania na Macu (jak `TaskDetailClient` w CRM): `assign` / `unassign` — przypisz się, wypisz się, dodaj i usuń osobę
 * (powiadomienie tylko dla dodanej osoby, nie dla siebie), `deleteAttachment` — usuń plik albo odlinkuj plik wydarzenia.
 * Wypisanie innej osoby: autor zadania, administrator, „Zadania — zarządzanie” albo zarządzający zadaniami wydarzenia (RLS
 * pozwala usunąć tylko własne przypisanie, więc zapis po sprawdzeniu uprawnień idzie kluczem serwera).
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const columns = ['todo', 'in_progress', 'review', 'completed'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const boardOf = (value: unknown): TaskBoard => (value === 'company' ? 'company' : value === 'event' ? 'event' : 'mine');

async function stopTimer(ctx: NativeContext) {
  const { error } = await ctx.supabase.from('time_entries').update({ end_time: new Date().toISOString() })
    .eq('employee_id', ctx.employee.id).is('end_time', null);
  if (error) throw error;
}
async function startTimer(ctx: NativeContext, taskId: string, eventId: string | null = null) {
  const { error } = await ctx.supabase.from('time_entries').insert({
    employee_id: ctx.employee.id, task_id: taskId, event_id: eventId, title: null, description: null,
    start_time: new Date().toISOString(), end_time: null, is_billable: false, tags: [],
  });
  if (error) throw error;
}
type TaskRow = { id: string; created_by: string | null; owner_id: string | null; event_id: string | null; is_private: boolean | null; is_inquiry: boolean | null };
const isMe = (ctx: NativeContext, value: unknown) => typeof value === 'string' && (value === ctx.employee.id || value === ctx.employee.authUserId);

/** Zadanie widoczne dla pracownika (RLS) — pola do sprawdzenia uprawnień panelu. */
async function taskRow(ctx: NativeContext, id: string): Promise<TaskRow | null> {
  const { data, error } = await ctx.supabase.from('tasks').select('id,created_by,owner_id,event_id,is_private,is_inquiry').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as TaskRow | null) ?? null;
}

/** Czy pracownik może wypisywać inne osoby z zadania (jak przycisk usuwania osoby w CRM: autor zadania) — plus zarządzający. */
async function managesAssignees(ctx: NativeContext, task: TaskRow) {
  const e = ctx.employee;
  if (e.isAdmin || e.permissions.includes('tasks_manage') || isMe(ctx, task.created_by)) return true;
  return task.event_id ? canManageEventTasks(ctx, task.event_id) : false;
}

/**
 * Usunięcie przypisań: siebie — zawsze, inne osoby — gdy `manager`. Zwraca komunikat, gdy czegoś nie wolno; zapis kluczem
 * serwera (RLS przepuszcza tylko własne przypisanie).
 */
async function removeAssignees(ctx: NativeContext, taskId: string, ids: string[], manager: boolean): Promise<string | null> {
  if (!ids.length) return null;
  if (!manager && ids.some((value) => !isMe(ctx, value))) return 'możesz wypisać tylko siebie — inne osoby usuwa autor zadania albo osoba zarządzająca zadaniami.';
  const { error } = await createSupabaseAdminClient().from('task_assignees').delete().eq('task_id', taskId).in('employee_id', ids);
  if (error) throw error;
  return null;
}

/** Powiadomienie push o przypisaniu (jak `sendTaskAssignmentPush`) — błąd wysyłki nie cofa zapisu. */
async function pushAssignments(ctx: NativeContext, ids: string[]) {
  await Promise.allSettled(ids.map((assignment_id) =>
    ctx.supabase.functions.invoke('send-task-assignment-push', { body: { assignment_id } })));
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const q = (key: string) => url.searchParams.get(key) || '';
  try {
    switch (q('op')) {
      case 'state': {
        const board = boardOf(q('board'));
        const eventId = board === 'event' ? q('eventId') : null;
        if (board === 'event' && !uuid.test(eventId || '')) return failure('Nieprawidłowy event.');
        const access = await taskAccess(ctx, board, eventId);
        if (board === 'company' && !access.canMove) return failure('Nie masz dostępu do zadań firmowych.', 403);
        const [state, timer] = await Promise.all([tasksState(ctx, board, q('hash') || undefined, eventId), activeTimer(ctx)]);
        return nativeJson({ ...state, access, timer });
      }
      case 'timer':
        return nativeJson({ timer: await activeTimer(ctx) });
      case 'widget':
        return nativeJson(await tasksWidget(ctx));
      case 'detail': {
        const id = q('id');
        if (!uuid.test(id)) return failure('Nieprawidłowe zadanie.');
        const [task, comments, attachments] = await Promise.all([
          ctx.supabase.from('tasks').select('id,created_by').eq('id', id).maybeSingle(),
          ctx.supabase.from('task_comments').select('id,employee_id,content,created_at,employees(name,surname)').eq('task_id', id).order('created_at'),
          ctx.supabase.from('task_attachments').select('id,file_name,file_url,file_type,file_size,created_at,is_linked,uploaded_by,employees(name,surname)').eq('task_id', id).order('created_at', { ascending: false }),
        ]);
        if (!task.data) return failure('Nie znaleziono zadania lub nie masz do niego dostępu.', 404);
        const createdBy = task.data.created_by ? String(task.data.created_by) : null;
        const person = (e: any) => (e ? `${e.name ?? ''} ${e.surname ?? ''}`.trim() : '');
        const creator = task.data.created_by
          ? (await ctx.supabase.from('employees').select('name,surname').eq('id', task.data.created_by).maybeSingle()).data
          : null;
        return nativeJson({
          creatorName: person(creator),
          createdBy,
          comments: (comments.data || []).map((c: any) => ({ id: c.id, employeeId: c.employee_id, name: person(c.employees), content: c.content, createdAt: c.created_at })),
          attachments: (attachments.data || []).map((a: any) => ({
            id: a.id, fileName: a.file_name, fileUrl: a.file_url, fileType: a.file_type, fileSize: Number(a.file_size || 0),
            createdAt: a.created_at, name: person(a.employees), linked: !!a.is_linked, uploadedBy: a.uploaded_by ?? null,
          })),
        });
      }
      case 'employees': {
        const { data, error } = await ctx.supabase.from('employees').select('id,name,surname,email').eq('is_active', true).order('name');
        if (error) throw error;
        return nativeJson({ employees: (data || []).map((e) => ({ id: e.id, name: `${e.name ?? ''} ${e.surname ?? ''}`.trim(), nickname: e.email ?? '' })) });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-tasks]', error);
    return failure(errorText(error, 'Nie udało się pobrać zadań.'), 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);

  // Załączniki: multipart (`?op=attach&id=…`, pole „file”), plik trafia do magazynu jak w przeglądarce.
  if (url.searchParams.get('op') === 'attach') {
    const id = url.searchParams.get('id') || '';
    if (!uuid.test(id)) return failure('Nieprawidłowe zadanie.');
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      if (file.size > 50 * 1024 * 1024) return failure('Plik jest większy niż 50 MB.');
      const extension = file.name.includes('.') ? (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '') : '';
      const path = `task-attachments/${id}/${randomUUID()}${extension ? `.${extension}` : ''}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await ctx.supabase.storage.from('event-files').upload(path, bytes, { contentType: file.type || 'application/octet-stream' });
      if (upload.error) return failure(`Nie udało się przesłać pliku „${file.name}”.`);
      const { data: { publicUrl } } = ctx.supabase.storage.from('event-files').getPublicUrl(path);
      const { error } = await ctx.supabase.from('task_attachments').insert({
        task_id: id, file_name: file.name, file_url: publicUrl, file_type: file.type || 'application/octet-stream',
        file_size: file.size, uploaded_by: ctx.employee.id,
      });
      if (error) {
        await ctx.supabase.storage.from('event-files').remove([path]);
        return failure(`Nie udało się zapisać załącznika „${file.name}”.`);
      }
      invalidateTasks();
      return nativeJson({ ok: true });
    } catch (error) {
      console.error('[native-tasks] attach', error);
      return failure(errorText(error, 'Nie udało się przesłać pliku.'), 500);
    }
  }

  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const board = boardOf(body.board);
  // Tablica zadań wydarzenia (karta wydarzenia na Macu) — zawsze z identyfikatorem wydarzenia.
  const eventId = board === 'event' ? String(body.eventId || '') : null;
  if (board === 'event' && !uuid.test(eventId || '')) return failure('Nieprawidłowy event.');
  const id = body.id ? String(body.id) : '';
  const done = (payload: Record<string, unknown> = {}) => { invalidateTasks(); return nativeJson({ ok: true, ...payload }); };
  try {
    const access = await taskAccess(ctx, board, eventId);
    switch (op) {
      case 'items':
        return nativeJson(await tasksItems(ctx, board, Array.isArray(body.buckets) ? body.buckets : [], eventId));

      case 'save': {
        const data = body.data && typeof body.data === 'object' ? body.data : {};
        const title = String(data.title || '').trim();
        const column = String(data.boardColumn || 'todo');
        const priority = String(data.priority || 'medium');
        const withTime = Object.prototype.hasOwnProperty.call(data, 'dueTime');
        let due = taskDueFromInput(data.dueDate, withTime ? data.dueTime : undefined);
        if (!title) return failure('Tytuł zadania jest wymagany');
        if (!columns.includes(column) || !priorities.includes(priority)) return failure('Nieprawidłowe dane zadania.');
        if (due === undefined) return failure('Podaj poprawny termin: dzień (DD.MM.RRRR) i opcjonalnie godzinę.');
        // Starsza wersja aplikacji (sam dzień, bez `dueTime`): ten sam dzień przy edycji nie kasuje godziny ustawionej gdzie indziej.
        if (!withTime && due && id && uuid.test(id) && /^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate))) {
          const { data: current } = await ctx.supabase.from('tasks').select('due_date').eq('id', id).maybeSingle();
          const before = taskDueParts((current?.due_date as string | null | undefined) ?? null);
          if (before?.time && before.day === String(data.dueDate)) due = String(current?.due_date);
        }
        const fields = { title, description: String(data.description || '').trim() || null, priority, board_column: column, due_date: due };
        const assignees = Array.isArray(body.assignees)
          ? [...new Set(body.assignees.map(String).filter((value: string) => uuid.test(value)))] as string[]
          : null;

        if (id && !uuid.test(id)) return failure('Nieprawidłowe zadanie.');
        if (board === 'event') {
          // Jak `EventTasksBoard.handleSubmit`: status równy kolumnie, kolejność na końcu kolumny, autor — pracownik.
          if (!access.canManage) return failure('Nie masz uprawnień do zarządzania zadaniami eventu.', 403);
          const eventFields = { ...fields, status: column };
          let taskId = id;
          if (id) {
            const { data: saved, error } = await ctx.supabase.from('tasks').update(eventFields).eq('id', id).eq('event_id', eventId).select('id');
            if (error) return failure(errorText(error, 'Błąd podczas zapisywania zadania'));
            if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zadania.', 403);
          } else {
            const { data: last } = await ctx.supabase.from('tasks').select('order_index').eq('event_id', eventId).eq('board_column', column)
              .order('order_index', { ascending: false }).limit(1).maybeSingle();
            const { data: created, error } = await ctx.supabase.from('tasks').insert({
              ...eventFields, event_id: eventId, is_private: false, owner_id: null, created_by: ctx.employee.id,
              order_index: last ? Number(last.order_index || 0) + 1 : 0,
            }).select('id').single();
            if (error) return failure(errorText(error, 'Błąd podczas zapisywania zadania'));
            taskId = String(created.id);
          }
          if (assignees) {
            const { data: current, error: currentError } = await ctx.supabase.from('task_assignees').select('employee_id').eq('task_id', taskId);
            if (currentError) throw currentError;
            const before = new Set((current || []).map((row) => String(row.employee_id)));
            const remove = [...before].filter((value) => !assignees.includes(value));
            const add = assignees.filter((value) => !before.has(value));
            await removeAssignees(ctx, taskId, remove, true);
            if (add.length) {
              const { data: inserted, error: addError } = await ctx.supabase.from('task_assignees')
                .upsert(add.map((employee_id) => ({ task_id: taskId, employee_id, assigned_by: ctx.employee.id })), { onConflict: 'task_id,employee_id', ignoreDuplicates: true })
                .select('id,employee_id');
              if (addError) return failure('Zadanie jest zapisane, ale nie udało się przypisać pracowników. Edytuj zadanie i zapisz ponownie.');
              await pushAssignments(ctx, (inserted || []).filter((row) => !isMe(ctx, row.employee_id)).map((row) => String(row.id)));
              // Jak `handleToggleAssignee`: przypisana osoba trafia do zespołu wydarzenia (rola „Członek zespołu”).
              const { data: team } = await ctx.supabase.from('employee_assignments').select('employee_id').eq('event_id', eventId).in('employee_id', add);
              const inTeam = new Set((team || []).map((row) => String(row.employee_id)));
              const missing = add.filter((value) => !inTeam.has(value));
              if (missing.length) {
                const { error: teamError } = await ctx.supabase.from('employee_assignments')
                  .insert(missing.map((employee_id) => ({ event_id: eventId, employee_id, role: 'Członek zespołu' })));
                if (teamError) console.error('[native-tasks] team', teamError);
              }
            }
          }
          return done({ id: taskId });
        }
        if (board === 'mine') {
          // Prywatne zadanie: nowe — idempotentny zapis z id z aplikacji (ponowienie nie tworzy duplikatu).
          if (body.existing) {
            const { data: saved, error } = await ctx.supabase.from('tasks').update(fields).eq('id', id).select('id');
            if (error) return failure(errorText(error, 'Nie udało się zapisać zadania.'));
            if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zadania.', 403);
            return done({ id });
          }
          const taskId = id || randomUUID();
          const { error } = await ctx.supabase.from('tasks').upsert({
            id: taskId, ...fields, status: column === 'review' ? 'in_progress' : column,
            is_private: true, owner_id: ctx.employee.id, created_by: ctx.employee.id,
          }, { onConflict: 'id' });
          if (error) return failure(errorText(error, 'Nie udało się zapisać zadania.'));
          const { error: assignError } = await ctx.supabase.from('task_assignees').upsert(
            { task_id: taskId, employee_id: ctx.employee.id, assigned_by: ctx.employee.id },
            { onConflict: 'task_id,employee_id', ignoreDuplicates: true });
          if (assignError) return failure('Zadanie jest zapisane, ale nie udało się dokończyć przypisania. Ponów zapis — nie powstanie drugie zadanie.');
          return done({ id: taskId });
        }

        if (id) {
          // Jak w CRM: edytuje zarządzający zadaniami albo właściciel zadania z „Zadania — podgląd” (resztę sprawdza RLS).
          const current = await taskRow(ctx, id);
          if (!current) return failure('Nie znaleziono zadania lub nie masz do niego dostępu.', 404);
          if (!access.canManage && !isMe(ctx, current.owner_id)) return failure('Nie masz uprawnień do edycji tego zadania.', 403);
          const { data: saved, error } = await ctx.supabase.from('tasks').update(fields).eq('id', id).select('id');
          if (error) return failure(errorText(error, 'Błąd podczas zapisywania zadania'));
          if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zadania.', 403);
          if (assignees) {
            const { data: rows, error: currentError } = await ctx.supabase.from('task_assignees').select('employee_id').eq('task_id', id);
            if (currentError) throw currentError;
            const before = new Set((rows || []).map((row) => String(row.employee_id)));
            const remove = [...before].filter((value) => !assignees.includes(value));
            const add = assignees.filter((value) => !before.has(value));
            const problem = await removeAssignees(ctx, id, remove, access.canManage || await managesAssignees(ctx, current));
            if (add.length) {
              const { data: inserted, error: addError } = await ctx.supabase.from('task_assignees')
                .upsert(add.map((employee_id) => ({ task_id: id, employee_id, assigned_by: ctx.employee.id })), { onConflict: 'task_id,employee_id', ignoreDuplicates: true })
                .select('id,employee_id');
              if (addError) throw addError;
              await pushAssignments(ctx, (inserted || []).filter((row) => !isMe(ctx, row.employee_id)).map((row) => String(row.id)));
            }
            if (problem) { invalidateTasks(); return failure(`Zadanie jest zapisane, ale ${problem}`, 403); }
          }
          return done({ id });
        }

        if (!access.canCreate) return failure('Nie masz uprawnień do tworzenia zadań.', 403);
        const { data: created, error } = await ctx.supabase.from('tasks').insert({
          ...fields, status: column === 'review' ? 'in_progress' : column, is_private: false, event_id: null,
          inquiry_id: null, is_inquiry: false, owner_id: ctx.employee.id, created_by: ctx.employee.id,
        }).select('id').single();
        if (error) return failure(errorText(error, 'Błąd podczas zapisywania zadania'));
        const taskId = String(created.id);
        if (assignees?.length) {
          const { data: inserted, error: assignError } = await ctx.supabase.from('task_assignees')
            .upsert(assignees.map((employee_id) => ({ task_id: taskId, employee_id, assigned_by: ctx.employee.id })), { onConflict: 'task_id,employee_id', ignoreDuplicates: true })
            .select('id,employee_id');
          if (assignError) return failure('Zadanie jest zapisane, ale nie udało się przypisać pracowników. Edytuj zadanie i zapisz ponownie.');
          await pushAssignments(ctx, (inserted || []).filter((row) => !isMe(ctx, row.employee_id)).map((row) => String(row.id)));
        }
        return done({ id: taskId });
      }

      case 'move': {
        const column = String(body.column || '');
        if (!uuid.test(id) || !columns.includes(column)) return failure('Nieprawidłowe dane.');
        if (!access.canMove) return failure('Nie masz uprawnień do przenoszenia zadań.', 403);
        const update: Record<string, unknown> = { board_column: column };
        if (board === 'event') update.status = column;
        if (column !== 'in_progress') update.currently_working_by = null;
        else if (body.working) update.currently_working_by = ctx.employee.id;
        const { data: saved, error } = await ctx.supabase.from('tasks').update(update).eq('id', id).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas przenoszenia zadania'));
        if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zadania.', 403);
        if (body.startTimer) await startTimer(ctx, id, eventId);
        return done({ timer: await activeTimer(ctx) });
      }

      case 'delete': {
        if (!uuid.test(id)) return failure('Nieprawidłowe zadanie.');
        if (!access.canManage) return failure('Nie masz uprawnień do usuwania zadań.', 403);
        const { data: removed, error } = await ctx.supabase.from('tasks').delete().eq('id', id).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas usuwania zadania'));
        if (!removed?.length) return failure('Nie masz uprawnień do usunięcia tego zadania.', 403);
        return done();
      }

      case 'timer': {
        // start — nowy licznik; stop — zakończ bieżący; switch — zakończ bieżący i rozpocznij dla zadania.
        const action = String(body.action || '');
        if (action === 'stop') await stopTimer(ctx);
        else if (action === 'start' || action === 'switch') {
          if (!uuid.test(id)) return failure('Nieprawidłowe zadanie.');
          if (action === 'switch') await stopTimer(ctx);
          else if (await activeTimer(ctx)) return failure('Masz włączony timer dla innego zadania.', 409);
          await startTimer(ctx, id, eventId);
        } else return failure('Nieznana czynność licznika.');
        return done({ timer: await activeTimer(ctx) });
      }

      case 'comment': {
        const content = String(body.content || '').trim();
        if (!uuid.test(id) || !content) return failure('Wpisz treść komentarza.');
        const { error } = await ctx.supabase.from('task_comments').insert({ task_id: id, employee_id: ctx.employee.id, content });
        if (error) return failure(errorText(error, 'Nie udało się dodać komentarza.'));
        return done();
      }
      case 'assign': {
        // Przypisz się / dodaj osobę (jak „Dodaj osobę” w CRM) — powiadomienie tylko dla dodanej osoby.
        const employeeId = String(body.employeeId || '');
        if (!uuid.test(id) || !uuid.test(employeeId)) return failure('Nieprawidłowe dane.');
        const task = await taskRow(ctx, id);
        if (!task) return failure('Nie znaleziono zadania lub nie masz do niego dostępu.', 404);
        if (task.is_private) return failure('Zadanie prywatne ma tylko właściciela.');
        if (task.is_inquiry) return failure('Zespół zapytania zmienisz w zapytaniu.');
        const { data: inserted, error } = await ctx.supabase.from('task_assignees')
          .insert({ task_id: id, employee_id: employeeId, assigned_by: ctx.employee.id }).select('id').single();
        if (error) {
          if (error.code === '23505') return failure('Ta osoba jest już przypisana do zadania.', 409);
          return failure(errorText(error, 'Nie udało się przypisać osoby.'));
        }
        if (!isMe(ctx, employeeId)) await pushAssignments(ctx, [String(inserted.id)]);
        return done();
      }
      case 'unassign': {
        // Wypisz się / usuń osobę: siebie — zawsze, inne osoby — autor zadania i zarządzający.
        const employeeId = String(body.employeeId || '');
        if (!uuid.test(id) || !uuid.test(employeeId)) return failure('Nieprawidłowe dane.');
        const task = await taskRow(ctx, id);
        if (!task) return failure('Nie znaleziono zadania lub nie masz do niego dostępu.', 404);
        if (task.is_private) return failure('Zadanie prywatne ma tylko właściciela.');
        if (task.is_inquiry) return failure('Zespół zapytania zmienisz w zapytaniu.');
        const { data: assigned } = await ctx.supabase.from('task_assignees').select('id').eq('task_id', id).eq('employee_id', employeeId).maybeSingle();
        if (!assigned) return failure('Ta osoba nie jest przypisana do zadania.', 404);
        const problem = await removeAssignees(ctx, id, [employeeId], isMe(ctx, employeeId) || await managesAssignees(ctx, task));
        if (problem) return failure(`Nie można: ${problem}`, 403);
        return done();
      }
      case 'deleteAttachment': {
        // Plik zadania (jak w CRM): usuwa autor pliku, administrator albo „Zadania — zarządzanie” (RLS); plik wydarzenia — tylko odlinkowanie.
        const attachmentId = String(body.attachmentId || '');
        if (!uuid.test(attachmentId)) return failure('Nieprawidłowy plik.');
        const { data: removed, error } = await ctx.supabase.from('task_attachments').delete().eq('id', attachmentId).select('id,task_id,file_url,is_linked');
        if (error) return failure(errorText(error, 'Nie udało się usunąć pliku.'));
        if (!removed?.length) return failure('Możesz usunąć tylko własny plik.', 403);
        const row = removed[0] as { task_id: string; file_url: string | null; is_linked: boolean | null };
        const path = !row.is_linked && row.file_url ? decodeURIComponent(String(row.file_url).split('/event-files/')[1] || '') : '';
        if (path.startsWith(`task-attachments/${row.task_id}/`) && !path.includes('..')) {
          const { error: storageError } = await ctx.supabase.storage.from('event-files').remove([path]);
          if (storageError) console.error('[native-tasks] attachment file', storageError);
        }
        return done();
      }
      case 'deleteComment': {
        const commentId = String(body.commentId || '');
        if (!uuid.test(commentId)) return failure('Nieprawidłowy komentarz.');
        const { data: removed, error } = await ctx.supabase.from('task_comments').delete().eq('id', commentId).select('id');
        if (error) return failure(errorText(error, 'Nie udało się usunąć komentarza.'));
        if (!removed?.length) return failure('Możesz usunąć tylko własny komentarz.', 403);
        return done();
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-tasks]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}

