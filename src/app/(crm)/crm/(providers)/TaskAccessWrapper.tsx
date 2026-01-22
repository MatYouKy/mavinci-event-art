'use client';

import { canView, Employee, isAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase/browser';

import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useEffect, useState } from 'react';
import { allNavigation } from '../mock/navigation';

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
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      if (pathname === '/crm') {
        setHasAccess(true);
        setLoading(false);
        return;
      }

      const currentNav = allNavigation.find(
        (nav) => pathname.startsWith(nav.href) && nav.href !== '/crm',
      );

      if (!currentNav?.module) {
        setHasAccess(true);
        setLoading(false);
        return;
      }

      const taskIdMatch = pathname.match(/^\/crm\/tasks\/([a-f0-9-]+)$/);
      if (taskIdMatch && employee?.id) {
        const taskId = taskIdMatch[1];

        const { data: task } = await supabase
          .from('tasks')
          .select('id, is_private, owner_id')
          .eq('id', taskId)
          .maybeSingle();

        if (task) {
          if (task.is_private && task.owner_id === employee.id) {
            setHasAccess(true);
            setLoading(false);
            return;
          }

          const { data: assignee } = await supabase
            .from('task_assignees')
            .select('employee_id')
            .eq('task_id', taskId)
            .eq('employee_id', employee.id)
            .maybeSingle();

          if (assignee) {
            setHasAccess(true);
            setLoading(false);
            return;
          }
        }
      }

      const eventIdMatch = pathname.match(/^\/crm\/events\/([a-f0-9-]+)$/);
      if (eventIdMatch && employee?.id) {
        const eventId = eventIdMatch[1];

        if (isAdmin(employee) || employee.permissions?.includes('events_manage')) {
          setHasAccess(true);
          setLoading(false);
          return;
        }

        if (employee.permissions?.includes('events_view')) {
          const { data: assignment } = await supabase
            .from('employee_assignments')
            .select('employee_id')
            .eq('event_id', eventId)
            .eq('employee_id', employee.id)
            .eq('status', 'accepted')
            .maybeSingle();

          if (assignment) {
            setHasAccess(true);
            setLoading(false);
            return;
          }
        }
      }

      const employeeIdMatch = pathname.match(/^\/crm\/employees\/([a-f0-9-]+)$/);
      if (employeeIdMatch && employee?.id) {
        const profileEmployeeId = employeeIdMatch[1];
        if (profileEmployeeId === employee.id) {
          setHasAccess(true);
          setLoading(false);
          return;
        }
      }

      const hasPermission = employee && (isAdmin(employee) || canView(employee, currentNav.module));

      setHasAccess(hasPermission);
      setLoading(false);
    };

    checkAccess();
  }, [pathname, employee?.id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-lg text-[#d3bb73]">Sprawdzanie uprawnień...</div>
      </div>
    );
  }

  if (!hasAccess) {
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
