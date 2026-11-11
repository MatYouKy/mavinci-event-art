import { randomUUID } from 'node:crypto';
import { nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { activeTimer, invalidateTasks, taskAccess, tasksItems, tasksState, type TaskBoard } from '@/lib/native/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Zadania dla aplikacji na Maca — te same zapisy co CRM (`tasksApi.ts`, `TasksPageClient`, `PrivateTasksBoardTab`,
 * `TaskDetailClient`): zadanie firmowe z przypisaniami (+ powiadomienie push), zadanie prywatne (idempotentny zapis z id
 * z aplikacji), przeniesienie kolumny z osobą pracującą, licznik czasu (`time_entries`), komentarze i załączniki
 * (`event-files/task-attachments`). Tokenem pracownika — RLS jak w przeglądarce.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const columns = ['todo', 'in_progress', 'review', 'completed'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const boardOf = (value: unknown): TaskBoard => (value === 'company' ? 'company' : 'mine');
const dateOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
};

async function stopTimer(ctx: NativeContext) {
  const { error } = await ctx.supabase.from('time_entries').update({ end_time: new Date().toISOString() })
    .eq('employee_id', ctx.employee.id).is('end_time', null);
  if (error) throw error;
}
async function startTimer(ctx: NativeContext, taskId: string) {
  const { error } = await ctx.supabase.from('time_entries').insert({
    employee_id: ctx.employee.id, task_id: taskId, event_id: null, title: null, description: null,
    start_time: new Date().toISOString(), end_time: null, is_billable: false, tags: [],
  });
  if (error) throw error;
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
        const access = await taskAccess(ctx, board);
        if (board === 'company' && !access.canMove) return failure('Nie masz dostępu do zadań firmowych.', 403);
        const [state, timer] = await Promise.all([tasksState(ctx, board, q('hash') || undefined), activeTimer(ctx)]);
        return nativeJson({ ...state, access, timer });
      }
      case 'timer':
        return nativeJson({ timer: await activeTimer(ctx) });
      case 'detail': {
        const id = q('id');
        if (!uuid.test(id)) return failure('Nieprawidłowe zadanie.');
        const [task, comments, attachments] = await Promise.all([
          ctx.supabase.from('tasks').select('id,created_by').eq('id', id).maybeSingle(),
          ctx.supabase.from('task_comments').select('id,employee_id,content,created_at,employees(name,surname)').eq('task_id', id).order('created_at'),
          ctx.supabase.from('task_attachments').select('id,file_name,file_url,file_type,file_size,created_at,is_linked,employees(name,surname)').eq('task_id', id).order('created_at', { ascending: false }),
        ]);
        if (!task.data) return failure('Nie znaleziono zadania lub nie masz do niego dostępu.', 404);
        const person = (e: any) => (e ? `${e.name ?? ''} ${e.surname ?? ''}`.trim() : '');
        const creator = task.data.created_by
          ? (await ctx.supabase.from('employees').select('name,surname').eq('id', task.data.created_by).maybeSingle()).data
          : null;
        return nativeJson({
          creatorName: person(creator),
          comments: (comments.data || []).map((c: any) => ({ id: c.id, employeeId: c.employee_id, name: person(c.employees), content: c.content, createdAt: c.created_at })),
          attachments: (attachments.data || []).map((a: any) => ({
            id: a.id, fileName: a.file_name, fileUrl: a.file_url, fileType: a.file_type, fileSize: Number(a.file_size || 0),
            createdAt: a.created_at, name: person(a.employees), linked: !!a.is_linked,
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
  const id = body.id ? String(body.id) : '';
  const done = (payload: Record<string, unknown> = {}) => { invalidateTasks(); return nativeJson({ ok: true, ...payload }); };
  try {
    const access = await taskAccess(ctx, board);
    switch (op) {
      case 'items':
        return nativeJson(await tasksItems(ctx, board, Array.isArray(body.buckets) ? body.buckets : []));

      case 'save': {
        const data = body.data && typeof body.data === 'object' ? body.data : {};
        const title = String(data.title || '').trim();
        const column = String(data.boardColumn || 'todo');
        const priority = String(data.priority || 'medium');
        const due = dateOrNull(data.dueDate);
        if (!title) return failure('Tytuł zadania jest wymagany');
        if (!columns.includes(column) || !priorities.includes(priority)) return failure('Nieprawidłowe dane zadania.');
        if (due === undefined) return failure('Podaj poprawną datę w formacie DD.MM.RRRR.');
        const fields = { title, description: String(data.description || '').trim() || null, priority, board_column: column, due_date: due };
        const assignees = Array.isArray(body.assignees)
          ? [...new Set(body.assignees.map(String).filter((value: string) => uuid.test(value)))] as string[]
          : null;

        if (id && !uuid.test(id)) return failure('Nieprawidłowe zadanie.');
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
          if (!access.canManage) return failure('Nie masz uprawnień do edycji zadań.', 403);
          const { data: saved, error } = await ctx.supabase.from('tasks').update(fields).eq('id', id).select('id');
          if (error) return failure(errorText(error, 'Błąd podczas zapisywania zadania'));
          if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zadania.', 403);
          if (assignees) {
            const { data: current, error: currentError } = await ctx.supabase.from('task_assignees').select('employee_id').eq('task_id', id);
            if (currentError) throw currentError;
            const before = new Set((current || []).map((row) => String(row.employee_id)));
            const remove = [...before].filter((value) => !assignees.includes(value));
            const add = assignees.filter((value) => !before.has(value));
            if (remove.length) {
              const { error: removeError } = await ctx.supabase.from('task_assignees').delete().eq('task_id', id).in('employee_id', remove);
              if (removeError) throw removeError;
            }
            if (add.length) {
              const { data: inserted, error: addError } = await ctx.supabase.from('task_assignees')
                .upsert(add.map((employee_id) => ({ task_id: id, employee_id, assigned_by: ctx.employee.id })), { onConflict: 'task_id,employee_id', ignoreDuplicates: true })
                .select('id');
              if (addError) throw addError;
              await pushAssignments(ctx, (inserted || []).map((row) => String(row.id)));
            }
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
            .select('id');
          if (assignError) return failure('Zadanie jest zapisane, ale nie udało się przypisać pracowników. Edytuj zadanie i zapisz ponownie.');
          await pushAssignments(ctx, (inserted || []).map((row) => String(row.id)));
        }
        return done({ id: taskId });
      }

      case 'move': {
        const column = String(body.column || '');
        if (!uuid.test(id) || !columns.includes(column)) return failure('Nieprawidłowe dane.');
        if (!access.canMove) return failure('Nie masz uprawnień do przenoszenia zadań.', 403);
        const update: Record<string, unknown> = { board_column: column };
        if (column !== 'in_progress') update.currently_working_by = null;
        else if (body.working) update.currently_working_by = ctx.employee.id;
        const { data: saved, error } = await ctx.supabase.from('tasks').update(update).eq('id', id).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas przenoszenia zadania'));
        if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zadania.', 403);
        if (body.startTimer) await startTimer(ctx, id);
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
          await startTimer(ctx, id);
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

