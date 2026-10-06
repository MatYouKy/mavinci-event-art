import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, init?: { status?: number }) => NextResponse.json(body, {
  ...init, headers: { 'Cache-Control': 'no-store' },
});
const tokenFor = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('token');
// Same /crm/tasks board as fetchTasksServer, restricted further to the token owner's assignment.
const TASK_SCOPE = 'tasks_board_assigned_v1';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function resolveEmployeeFromToken(token: string) {
  const { data, error } = await admin
    .from('calendar_feed_tokens')
    .select('employee_id')
    .eq('token', token)
    .maybeSingle();

  if (error) throw error;
  if (!data?.employee_id) return null;


  return data.employee_id as string;
}

async function verifyEmployee(employeeId: string) {
  const { data, error } = await admin
    .from('employees')
    .select('id, is_active, name, surname')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function GET(req: Request) {
  try {
    const token = tokenFor(req);

    if (!token) {
      return json(
        { error: 'Missing token', success: false },
        { status: 401 },
      );
    }

    const employeeId = await resolveEmployeeFromToken(token);
    if (!employeeId) {
      return json(
        { error: 'Invalid token', success: false },
        { status: 401 },
      );
    }

    const employee = await verifyEmployee(employeeId);
    if (!employee || employee.is_active !== true) {
      return json(
        { error: 'Employee inactive or not found', success: false },
        { status: 403 },
      );
    }

    const assignedTaskIds: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data: rows, error } = await admin.from('task_assignees').select('task_id')
        .eq('employee_id', employeeId).order('task_id').range(offset, offset + 499);
      if (error) throw error;
      assignedTaskIds.push(...(rows || []).map((r: any) => r.task_id));
      if (!rows || rows.length < 500) break;
    }

    if (assignedTaskIds.length === 0) {
      return json({
        success: true,
        task_scope: TASK_SCOPE,
        employee_id: employeeId,
        employee_name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(),
        tasks: [],
        synced_at: new Date().toISOString(),
      });
    }

    const tasks: any[] = [];
    const uniqueIds = [...new Set(assignedTaskIds)];
    for (let offset = 0; offset < uniqueIds.length; offset += 200) {
      const { data, error } = await admin.from('tasks')
        .select('id,title,description,priority,status,board_column,due_date,created_at,updated_at,event_id,is_private,task_assignees!inner(employee_id)')
        .eq('is_private', false).eq('is_inquiry', false).is('event_id', null)
        .eq('task_assignees.employee_id', employeeId)
        .in('id', uniqueIds.slice(offset, offset + 200)).order('id');
      if (error) throw error;
      tasks.push(...(data || []));
    }

    const eventIds = (tasks ?? [])
      .map((t: any) => t.event_id)
      .filter(Boolean) as string[];

    let eventNames: Record<string, string> = {};
    if (eventIds.length > 0) {
      const { data: events } = await admin
        .from('events')
        .select('id, name')
        .in('id', eventIds);

      if (events) {
        eventNames = Object.fromEntries(events.map((e: any) => [e.id, e.name]));
      }
    }

    const formattedTasks = (tasks ?? []).map((t: any) => ({
      id: t.id,
      assigned_employee_id: employeeId,
      title: t.title,
      description: t.description || null,
      priority: t.priority || 'medium',
      status: t.status || 'todo',
      board_column: t.board_column || 'todo',
      due_date: t.due_date || null,
      event_id: t.event_id || null,
      event_name: t.event_id ? (eventNames[t.event_id] || null) : null,
      is_private: Boolean(t.is_private),
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    return json({
      success: true,
      task_scope: TASK_SCOPE,
      employee_id: employeeId,
      employee_name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(),
      tasks: formattedTasks,
      synced_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Tasks sync GET error:', e);
    return json(
      { error: 'Internal server error', success: false },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const token = tokenFor(req);

    if (!token) {
      return json(
        { error: 'Missing token', success: false },
        { status: 401 },
      );
    }

    const employeeId = await resolveEmployeeFromToken(token);
    if (!employeeId) {
      return json(
        { error: 'Invalid token', success: false },
        { status: 401 },
      );
    }

    const employee = await verifyEmployee(employeeId);
    if (!employee || employee.is_active !== true) {
      return json(
        { error: 'Employee inactive or not found', success: false },
        { status: 403 },
      );
    }

    const body = await req.json();
    const updates: Array<{ task_id: string; completed: boolean; expected_updated_at?: string }> = body.updates;

    if (!Array.isArray(updates) || updates.length === 0 || updates.length > 200 || updates.some((u) => !u || typeof u.completed !== 'boolean' || !/^[0-9a-f-]{36}$/i.test(u.task_id) || (u.expected_updated_at !== undefined && !Number.isFinite(Date.parse(u.expected_updated_at))))) {
      return json(
        { error: 'Missing updates array', success: false },
        { status: 400 },
      );
    }

    const taskIds = updates.map((u) => u.task_id);

    const { data: assignedRows, error: assErr } = await admin
      .from('task_assignees')
      .select('task_id')
      .eq('employee_id', employeeId)
      .in('task_id', taskIds);

    if (assErr) throw assErr;

    const allowedTaskIds = new Set((assignedRows ?? []).map((r: any) => r.task_id));

    const results: Array<{ task_id: string; success: boolean; error?: string }> = [];

    for (const update of updates) {
      if (!allowedTaskIds.has(update.task_id)) {
        results.push({
          task_id: update.task_id,
          success: false,
          error: 'Not assigned to this task',
        });
        continue;
      }

      const { data: current, error: readError } = await admin.from('tasks')
        .select('status, board_column, updated_at').eq('id', update.task_id)
        .eq('is_private', false).eq('is_inquiry', false).is('event_id', null).maybeSingle();
      if (readError || !current) { results.push({ task_id: update.task_id, success: false, error: 'Zadanie nie jest dostępne w Twoim zakresie synchronizacji zakładki Zadania.' }); continue; }
      const completed = current.status === 'completed' || current.status === 'cancelled' || current.board_column === 'completed';
      if (completed === update.completed) { results.push({ task_id: update.task_id, success: true }); continue; }
      if (current.status === 'cancelled' || (update.expected_updated_at && Date.parse(update.expected_updated_at) !== Date.parse(current.updated_at))) {
        results.push({ task_id: update.task_id, success: false, error: 'Konflikt zmian. Zadanie zmieniło się w CRM; sprawdź jego stan. Lokalnej zmiany nie usunięto.' }); continue;
      }
      // Preserve the assignment allow-list above AND recheck assignment transactionally.
      const { data: written, error: updateErr } = await admin.rpc('set_personal_synced_task_completion', {
        p_employee_id: employeeId, p_task_id: update.task_id, p_completed: update.completed,
        p_expected_updated_at: current.updated_at,
      });
      if (!updateErr && written !== true) { results.push({ task_id: update.task_id, success: false, error: 'Zmieniono zadanie lub jego przypisanie. Odśwież zadanie w CRM.' }); continue; }

      if (updateErr) {
        results.push({
          task_id: update.task_id,
          success: false,
          error: ['PGRST202', '42883'].includes(updateErr.code)
            ? 'Wymagana migracja personal_task_sync w bazie CRM.' : 'Nie udało się zapisać statusu zadania.',
        });
      } else {
        results.push({ task_id: update.task_id, success: true });
      }
    }

    return json({
      success: true,
      results,
      synced_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Tasks sync POST error:', e);
    return json(
      { error: 'Internal server error', success: false },
      { status: 500 },
    );
  }
}
