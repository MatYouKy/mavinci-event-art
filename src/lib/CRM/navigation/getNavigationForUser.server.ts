import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { allNavigation, NavKey } from './registry.server';
import type { NavigationItem } from '@/app/(crm)/crm/mock/navigation';

type NavWithRules = (typeof allNavigation)[number];

const hasAll = (userPerms: string[], required?: string[]) => {
  if (!required || required.length === 0) return true;
  return required.every((p) => userPerms.includes(p));
};

const normalizeOrder = (raw: unknown): string[] | null => {
  // navigation_order masz jako jsonb → najczęściej to będzie array
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');

  // czasem ktoś zapisze jako obiekt { order: [...] } albo inne
  if (raw && typeof raw === 'object') {
    const maybeOrder = (raw as any).order;
    if (Array.isArray(maybeOrder)) return maybeOrder.filter((x: any) => typeof x === 'string');
  }

  return null;
};

export async function getNavigationForUserServer(): Promise<{
  navigation: NavigationItem[];
  employeeId: string | null;
}> {
  const supabase = createSupabaseServerClient(cookies());

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user) return { navigation: [], employeeId: null };

  // ✅ powiązanie po auth_user_id (u Ciebie takie pole istnieje)
  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, permissions, role, access_level, navigation_order, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!employee) return { navigation: [], employeeId: null };

  const isAdmin = String(employee.role || '').toLowerCase() === 'admin';

  const perms: string[] = Array.isArray(employee.permissions)
    ? employee.permissions.filter((p: any) => typeof p === 'string')
    : [];

  // 1) filtr: admin -> wszystko, reszta -> permissions
  let allowed: Omit<NavWithRules, 'permissions'>[] = (isAdmin
    ? allNavigation
    : allNavigation.filter((item) => hasAll(perms, item.permissions as string[]))
  ).map(({ permissions, ...dto }) => dto);

  // 2) custom order (tylko dla tego co już allowed)
  const order = normalizeOrder(employee.navigation_order);

  if (order?.length) {
    const map = new Map<string, Omit<NavWithRules, 'permissions'>>(
      allowed.map((x) => [x.key, x]),
    );

    const ordered: Omit<NavWithRules, 'permissions'>[] = [];

    for (const k of order) {
      const it = map.get(k as NavKey);
      if (it) {
        ordered.push(it);
        map.delete(k as NavKey);
      }
    }

    allowed = [...ordered, ...Array.from(map.values())];
  }

  return {
    navigation: allowed as unknown as NavigationItem[],
    employeeId: employee.id,
  };
}