import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  admin
    .from('calendar_feed_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token', token)
    .then(() => {});

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
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Missing token', success: false },
        { status: 401 },
      );
    }

    const employeeId = await resolveEmployeeFromToken(token);
    if (!employeeId) {
      return NextResponse.json(
        { error: 'Invalid token', success: false },
        { status: 401 },
      );
    }

    const employee = await verifyEmployee(employeeId);
    if (!employee || employee.is_active === false) {
      return NextResponse.json(
        { error: 'Employee inactive or not found', success: false },
        { status: 403 },
      );
    }

    const { data: assignedRows, error: assErr } = await admin
      .from('task_assignees')
      .select('task_id')
      .eq('employee_id', employeeId);

    if (assErr) throw assErr;

    const assignedTaskIds = (assignedRows ?? []).map((r: any) => r.task_id);

    if (assignedTaskIds.length === 0) {
      return NextResponse.json({
        success: true,
        employee_id: employeeId,
        employee_name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(),
        tasks: [],
        synced_at: new Date().toISOString(),
      });
    }

    const { data: tasks, error: tasksErr } = await admin
      .from('tasks')
      .select(
        `id, title, description, priority, status, board_column, 
         due_date, created_at, updated_at, event_id, is_private`,
      )
      .in('id', assignedTaskIds);

    if (tasksErr) throw tasksErr;

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
      title: t.title,
      description: t.description || null,
      priority: t.priority,
      status: t.status,
      board_column: t.board_column,
      due_date: t.due_date || null,
      event_id: t.event_id || null,
      event_name: t.event_id ? (eventNames[t.event_id] || null) : null,
      is_private: t.is_private,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    return NextResponse.json({
      success: true,
      employee_id: employeeId,
      employee_name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(),
      tasks: formattedTasks,
      synced_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Tasks sync GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', success: false },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Missing token', success: false },
        { status: 401 },
      );
    }

    const employeeId = await resolveEmployeeFromToken(token);
    if (!employeeId) {
      return NextResponse.json(
        { error: 'Invalid token', success: false },
        { status: 401 },
      );
    }

    const employee = await verifyEmployee(employeeId);
    if (!employee || employee.is_active === false) {
      return NextResponse.json(
        { error: 'Employee inactive or not found', success: false },
        { status: 403 },
      );
    }

    const body = await req.json();
    const updates: Array<{ task_id: string; completed: boolean }> = body.updates;

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
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

      const newColumn = update.completed ? 'completed' : 'todo';
      const newStatus = update.completed ? 'completed' : 'todo';

      const { error: updateErr } = await admin
        .from('tasks')
        .update({
          board_column: newColumn,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', update.task_id);

      if (updateErr) {
        results.push({
          task_id: update.task_id,
          success: false,
          error: updateErr.message,
        });
      } else {
        results.push({ task_id: update.task_id, success: true });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      synced_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('Tasks sync POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', success: false },
      { status: 500 },
    );
  }
}
