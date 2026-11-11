import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allNavigation, type NavKey, type NavigationItemDTO } from './registry.server';
import { hasAnyFinanceCompanyLevel } from '@/lib/financeCompanyAccess';
import type { NavigationItem } from '@/app/(crm)/crm/mock/navigation';

const hasPermission = (perms: string[], required: string) => {
  if (perms.includes('admin')) return true;
  if (perms.includes(required)) return true;
  if (required === 'time_tracking_view') return true;

  if (['contracts_view', 'offers_view', 'events_view'].includes(required) && perms.includes(required.replace(/_view$/, '_create'))) return true;

  if (['events_view', 'calendar_view'].includes(required) && perms.includes('equipment_manage')) return true;

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

const hasAny = (perms: string[], options?: string[]) => {
  if (!options?.length) return true;
  return options.some((r) => hasPermission(perms, r));
};

export async function getNavigationForUserServer(): Promise<{
  navigation: Omit<NavigationItem, 'icon'>[]; // server-safe
  employeeId: string | null;
}> {
  const supabase = createSupabaseServerClient(cookies());

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return { navigation: [], employeeId: null };
  return navigationForUser(supabase, user.id);
}

/** Menu CRM pracownika — te same reguły dla przeglądarki i aplikacji na Maca (`/bridge/native/v1/navigation`, klient z tokenem pracownika). */
export async function navigationForUser(supabase: SupabaseClient, userId: string): Promise<{
  navigation: Omit<NavigationItem, 'icon'>[];
  employeeId: string | null;
}> {
  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, permissions, role, access_level, navigation_order, auth_user_id, finance_company_access')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!employee) return { navigation: [], employeeId: null };

  const perms: string[] = Array.isArray(employee.permissions) ? employee.permissions : [];

  // ✅ ADMIN WIDZI WSZYSTKO
  const isAdmin = employee.role === 'admin' || employee.access_level === 'admin' || perms.includes('admin');

  const { data: realizations } = await supabase.rpc('get_my_realizations');
  const hasRealizations = Array.isArray(realizations) && realizations.length > 0;

  // Parents stay visible when at least one permitted child remains.
  const filterItem = (item: NavigationItemDTO): NavigationItemDTO | null => {
    if (item.children?.length) {
      const children = item.children.map(filterItem).filter((child): child is NavigationItemDTO => child !== null);
      return children.length ? { ...item, children, href: children[0].href } : null;
    }
    if (item.financeCompanyAccess) {
      return isAdmin || hasAnyFinanceCompanyLevel(employee.finance_company_access, 'sales') ? item : null;
    }
    return isAdmin || (hasAll(perms, item.permissions) && hasAny(perms, item.anyPermissions)) || (hasRealizations && ['/crm/events','/crm/calendar'].includes(item.href || '')) ? item : null;
  };
  let allowed = allNavigation.map(filterItem).filter((item): item is NavigationItemDTO => item !== null);

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