import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export type SessionEmployee = {
  id: string;
  authUserId: string;
  role: string | null;
  accessLevel: string | null;
  permissions: string[];
  isAdmin: boolean;
};

type Granted = { ok: true; client: SupabaseClient; employee: SessionEmployee };
type Denied = { ok: false; response: NextResponse };

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

const deny = (error: string, status: number): Denied => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

/**
 * Klient Supabase działający w imieniu zalogowanego użytkownika (RLS obowiązuje).
 * Obsługuje sesję z ciasteczek CRM oraz nagłówek Authorization: Bearer z aplikacji mobilnej.
 */
function sessionClient(request?: Request): SupabaseClient {
  const authorization = request?.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createSupabaseServerClient(cookies()) as unknown as SupabaseClient;
}

/**
 * Wymaga aktywnego pracownika CRM. Konta portalu sprzedawcy są odrzucane.
 * Każdy endpoint /bridge, który używa klucza serwisowego, musi najpierw wywołać tę funkcję.
 */
export async function requireSessionEmployee(request?: Request): Promise<Granted | Denied> {
  const client = sessionClient(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return deny('Zaloguj się ponownie.', 401);

  const portal = await client.rpc('current_session_is_seller_portal');
  if (portal.data === true) return deny('Ta operacja jest dostępna tylko w CRM.', 403);

  const { data: row } = await client
    .from('employees')
    .select('id, auth_user_id, role, access_level, permissions')
    .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!row) return deny('Brak aktywnego konta pracownika.', 403);

  const permissions: string[] = Array.isArray(row.permissions) ? row.permissions : [];
  const isAdmin = row.role === 'admin' || row.access_level === 'admin' || permissions.includes('admin');
  return {
    ok: true,
    client,
    employee: {
      id: row.id,
      authUserId: row.auth_user_id || user.id,
      role: row.role ?? null,
      accessLevel: row.access_level ?? null,
      permissions,
      isAdmin,
    },
  };
}

export function employeeHasAny(employee: SessionEmployee, ...permissions: string[]) {
  return employee.isAdmin || permissions.some((permission) => employee.permissions.includes(permission));
}

/** Ta sama decyzja co w RLS i w interfejsie: public.current_employee_can_manage_event. */
export async function canManageEvent(client: SupabaseClient, eventId: string) {
  const { data, error } = await client.rpc('current_employee_can_manage_event', { p_event_id: eventId });
  if (error) {
    console.error('current_employee_can_manage_event failed:', error.code);
    return false;
  }
  return data === true;
}

/** Dowolny zalogowany użytkownik (pracownik CRM albo konto portalu sprzedawcy). */
export async function requireSessionUser(request?: Request): Promise<{ ok: true; client: SupabaseClient } | Denied> {
  const client = sessionClient(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return deny('Zaloguj się ponownie.', 401);
  return { ok: true, client };
}
