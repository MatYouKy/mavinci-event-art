'use client';

import { canView, Employee, isAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase/browser';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useEffect, useMemo, useState } from 'react';
import { allNavigation } from '../mock/navigation';

type AccessState = 'granted' | 'denied' | 'checking';

function getSyncAccess(pathname: string, employee: Employee | null): AccessState {
  if (!employee) return 'checking';

  if (pathname === '/crm') return 'granted';

  if (isAdmin(employee)) return 'granted';

  const currentNav = allNavigation.find(
    (nav) => pathname.startsWith(nav.href) && nav.href !== '/crm',
  );

  if (!currentNav?.module) return 'granted';

  const employeeIdMatch = pathname.match(/^\/crm\/employees\/([a-f0-9-]+)$/);
  if (employeeIdMatch && employeeIdMatch[1] === employee.id) {
    return 'granted';
  }

  // Jeśli user ma zwykłe uprawnienie modułowe, wpuszczamy od razu
  if (canView(employee, currentNav.module)) {
    return 'granted';
  }

  // Task detail / event detail mogą wymagać dopiero dopytania bazy
  const isTaskDetails = /^\/crm\/tasks\/([a-f0-9-]+)$/.test(pathname);
  const isEventDetails = /^\/crm\/events\/([a-f0-9-]+)$/.test(pathname);

  if (isTaskDetails || isEventDetails) {
    return 'checking';
  }

  return 'denied';
}

export function TaskAccessWrapper({
  pathname,
  employee,
  router,
  children,
}: {
  pathname: string;
  employee: Employee | null;
  router: AppRouterInstance;
  children: React.ReactNode;
}) {
  const syncAccess = useMemo(() => getSyncAccess(pathname, employee), [pathname, employee]);
  const [accessState, setAccessState] = useState<AccessState>(syncAccess);

  useEffect(() => {
    setAccessState(syncAccess);
  }, [syncAccess]);

  useEffect(() => {
    if (!employee?.id) return;
    if (syncAccess !== 'checking') return;

    let cancelled = false;

    const checkAccess = async () => {
      try {
        const taskIdMatch = pathname.match(/^\/crm\/tasks\/([a-f0-9-]+)$/);
        if (taskIdMatch) {
          const taskId = taskIdMatch[1];

          const { data: task } = await supabase
            .from('tasks')
            .select('id, is_private, owner_id')
            .eq('id', taskId)
            .maybeSingle();

          if (cancelled) return;

          if (task) {
            if (task.is_private && task.owner_id === employee.id) {
              setAccessState('granted');
              return;
            }

            const { data: assignee } = await supabase
              .from('task_assignees')
              .select('employee_id')
              .eq('task_id', taskId)
              .eq('employee_id', employee.id)
              .maybeSingle();

            if (cancelled) return;

            setAccessState(assignee ? 'granted' : 'denied');
            return;
          }

          setAccessState('denied');
          return;
        }

        const eventIdMatch = pathname.match(/^\/crm\/events\/([a-f0-9-]+)$/);
        if (eventIdMatch) {
          const eventId = eventIdMatch[1];

          const { data: assignment } = await supabase
            .from('employee_assignments')
            .select('employee_id')
            .eq('event_id', eventId)
            .eq('employee_id', employee.id)
            .eq('status', 'accepted')
            .maybeSingle();

          if (cancelled) return;

          setAccessState(assignment ? 'granted' : 'denied');
          return;
        }

        setAccessState('denied');
      } catch {
        if (!cancelled) setAccessState('denied');
      }
    };

    checkAccess();

    return () => {
      cancelled = true;
    };
  }, [pathname, employee?.id, syncAccess]);

  if (accessState === 'checking') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-lg text-[#d3bb73]">Sprawdzanie uprawnień...</div>
      </div>
    );
  }

  if (accessState === 'denied') {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center px-6">
        <div className="mb-4 text-6xl">🔒</div>
        <h2 className="mb-2 text-2xl font-light text-[#e5e4e2]">Brak uprawnień</h2>
        <p className="mb-6 max-w-md text-center text-[#e5e4e2]/60">
          Nie masz uprawnień do przeglądania tej strony.
        </p>
        <button
          onClick={() => router.push('/crm')}
          className="rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          Wróć do Dashboard
        </button>
      </div>
    );
  }

  return <>{children}</>;
}