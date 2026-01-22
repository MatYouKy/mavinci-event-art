import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { CookieStoreLike } from '@/lib/supabase/server.app';

function getCookieStore(): CookieStoreLike {
  const store = cookies();
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name, value, options) => store.set({ name, value, ...options }),
  };
}

export type EmployeeLite = { id: string; name: string; surname: string; email: string };

export type ActiveTimerDTO = any; // możesz później uściślić

export type TaskDTO = any; // jw. – na start nie walcz z typami

export async function fetchTasksInitialServer() {
  const supabase = createSupabaseServerClient(getCookieStore());

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return { tasks: [] as TaskDTO[], employees: [] as EmployeeLite[], activeTimer: null as ActiveTimerDTO };

  // 1) tasks (RLS zrobi filtr – Ty masz polityki)
  const { data: tasks, error: tErr } = await supabase
    .from('tasks')
    .select(`
      *,
      tasks:tasks(
        id
      )
    `);

  // ↑ ten select zostaw w spokoju jeśli masz już w tasksApi “właściwy”
  // Jak chcesz, to wklej dokładny select z tasksApi i ja Ci to przepiszę 1:1.

  if (tErr) throw tErr;

  // 2) employees do assign (tylko podstawowe pola)
  const { data: employees, error: eErr } = await supabase
    .from('employees')
    .select('id, name, surname, email')
    .order('name');

  if (eErr) throw eErr;

  // 3) active timer (jeśli masz tabelę time_entries)
  const { data: activeTimer, error: aErr } = await supabase
    .from('time_entries')
    .select('*, tasks(title)')
    .eq('employee_id', userId)
    .is('end_time', null)
    .maybeSingle();

  if (aErr) throw aErr;

  return {
    tasks: (tasks ?? []) as TaskDTO[],
    employees: (employees ?? []) as EmployeeLite[],
    activeTimer: activeTimer ?? null,
  };
}