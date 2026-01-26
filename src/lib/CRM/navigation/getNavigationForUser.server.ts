import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { allNavigation, type NavKey } from './registry.server';
import type { NavigationItem } from '@/app/(crm)/crm/mock/navigation';

const hasPermission = (perms: string[], required: string) => {
  if (perms.includes('admin')) return true;
  if (perms.includes(required)) return true;

  // manage => view
  if (required.endsWith('_view')) {
    const manage = required.replace(/_view$/, '_manage');
    if (perms.includes(manage)) return true;
  }
  return false;
};

const hasAll = (perms: string[], required?: string[]) => {
  if (!required?.length) return true;
  return required.every((r) => hasPermission(perms, r));
};

export async function getNavigationForUserServer(): Promise<{
  navigation: Omit<NavigationItem, 'icon'>[]; // server-safe
  employeeId: string | null;
}> {
  const supabase = createSupabaseServerClient(cookies());

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return { navigation: [], employeeId: null };

  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, permissions, role, navigation_order, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!employee) return { navigation: [], employeeId: null };

  const perms: string[] = Array.isArray(employee.permissions) ? employee.permissions : [];

  // ✅ ADMIN WIDZI WSZYSTKO
  const isAdmin = employee.role === 'admin' || perms.includes('admin');

  let allowed = isAdmin
    ? allNavigation.map(({ permissions, ...dto }) => dto)
    : allNavigation
        .filter((item) => hasAll(perms, item.permissions))
        .map(({ permissions, ...dto }) => dto);

  // ✅ kolejność (navigation_order)
  const orderRaw = employee.navigation_order;
  const order: string[] | null = Array.isArray(orderRaw) ? orderRaw : null;

  if (order?.length) {
    const map = new Map(allowed.map((x) => [x.key, x] as const));
    const ordered: typeof allowed = [];

    for (const k of order) {
      const it = map.get(k as NavKey);
      if (it) {
        ordered.push(it);
        map.delete(k as NavKey);
      }
    }
    allowed = [...ordered, ...Array.from(map.values())];
  }

  return { navigation: allowed, employeeId: employee.id };
}