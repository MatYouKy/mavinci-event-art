'use client';

import { canView, Employee, isAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase/browser';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useEffect, useMemo, useState } from 'react';
import { allNavigation, type NavigationItem } from '../mock/navigation';
import { hasAnyFinanceCompanyLevel } from '@/lib/financeCompanyAccess';

type AccessState = 'granted' | 'denied' | 'checking';

/** Ścieżka strony pozycji menu bez parametrów (`/crm/offers?tab=catalog` → `/crm/offers`). */
const pagePath = (href: string) => href.split('?')[0];

/** Najdłuższa ścieżka z menu, pod którą leży adres (`/crm/tasks/123` → `/crm/tasks`). Pulpit (`/crm`) nie obejmuje innych stron. */
function menuSection(pathname: string, paths: string[]): string | null {
  let best: string | null = null;
  for (const path of paths) {
    if (path === '/crm') continue;
    if ((pathname === path || pathname.startsWith(`${path}/`)) && (!best || path.length > best.length)) best = path;
  }
  return best;
}

/** Ścieżki stron, które pracownik ma w menu (pozycje bez podmenu; menu z serwera — `navigationForUser`). */
function allowedMenuPaths(items: NavigationItem[]): Set<string> {
  const allowed = new Set<string>();
  const walk = (list: NavigationItem[]) => {
    for (const item of list) {
      if (item.children?.length) walk(item.children);
      else allowed.add(pagePath(item.href));
    }
  };
  walk(items);
  return allowed;
}

function getSyncAccess(pathname: string, employee: Employee | null, navigation: NavigationItem[], navigationPaths: string[]): AccessState {
  if (!employee) return 'checking';

  if (pathname === '/crm') return 'granted';

  if (isAdmin(employee)) return 'granted';

  // Finanse: dostęp według działalności (co najmniej „Własna sprzedaż” w którejś działalności),
  // nie według starych uprawnień invoices_view / invoices_manage. Zakres danych pilnuje RLS.
  if (pathname.startsWith('/crm/invoices')) {
    return hasAnyFinanceCompanyLevel(employee.finance_company_access, 'sales') ? 'granted' : 'denied';
  }

  const employeeIdMatch = pathname.match(/^\/crm\/employees\/([a-f0-9-]+)$/);
  if (employeeIdMatch && employeeIdMatch[1] === employee.id) {
    return 'granted';
  }

  const isTaskDetails = /^\/crm\/tasks\/([a-f0-9-]+)$/.test(pathname);
  const isEventDetails = /^\/crm\/events\/([a-f0-9-]+)$/.test(pathname);

  // Strona, której pozycję pracownik ma w menu (Dysk, Eventy, Moje zadania, Zakupy…), zawsze się otwiera — menu i dostęp liczą
  // te same reguły (`navigationForUser`: uprawnienia, finanse według działalności, realizacje). Dotąd strona sprawdzała starą
  // regułę modułu (np. Dysk — „Materiały”), więc pozycja z menu mogła odpowiadać „Brak uprawnień”.
  const section = menuSection(pathname, navigationPaths);
  if (section && allowedMenuPaths(navigation).has(section)) return 'granted';

  // Pozostałe strony — jak dotąd, według modułu z listy `mock/navigation` (zadanie i event — jeszcze po przypisaniu, niżej).
  const currentNav = allNavigation.find(
    (nav) => pathname.startsWith(nav.href) && nav.href !== '/crm',
  );

  if (!currentNav?.module) return 'granted';

  if (canView(employee, currentNav.module)) {
    return 'granted';
  }

  if (isTaskDetails || isEventDetails) {
    return 'checking';
  }

  return 'denied';
}

export function TaskAccessWrapper({
  pathname,
  employee,
  router,
  navigation,
  navigationPaths,
  children,
}: {
  pathname: string;
  employee: Employee | null;
  router: AppRouterInstance;
  /** Menu pracownika z serwera (to samo co pasek boczny). */
  navigation: NavigationItem[];
  /** Ścieżki stron wszystkich pozycji menu (`navigationPagePaths`). */
  navigationPaths: string[];
  children: React.ReactNode;
}) {
  const syncAccess = useMemo(
    () => getSyncAccess(pathname, employee, navigation, navigationPaths),
    [pathname, employee, navigation, navigationPaths],
  );
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
