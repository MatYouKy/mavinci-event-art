import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/*
 * Pracownik natywnego API: token Supabase z aplikacji (Bearer) → klient Supabase z tym tokenem (RLS jak w CRM) i profil pracownika.
 * Bez klucza serwisowego — aplikacja widzi i zmienia dokładnie to, co pracownik w przeglądarce.
 */
export type NativeEmployee = {
  id: string;
  authUserId: string;
  name: string;
  surname: string;
  role: string;
  accessLevel: string;
  permissions: string[];
  financeScope: string;
  isAdmin: boolean;
};
export type NativeContext = { supabase: SupabaseClient; employee: NativeEmployee; client: 'mac' | 'phone' | 'web' };

export const can = (employee: NativeEmployee, scope: string) => employee.isAdmin || employee.permissions.includes(scope);

export async function nativeContext(request: Request): Promise<NativeContext | null> {
  const authorization = request.headers.get('authorization') || '';
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!token) return null;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error } = await supabase.auth.getUser(token);
  if (error || !auth.user) return null;
  const { data, error: profileError } = await supabase
    .from('employees')
    .select('id,auth_user_id,name,surname,role,access_level,permissions,finance_access_scope,is_active')
    .eq('auth_user_id', auth.user.id)
    .eq('is_active', true)
    .limit(2);
  if (profileError || !data || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown>;
  const permissions = Array.isArray(row.permissions) ? (row.permissions as unknown[]).map(String) : [];
  const role = String(row.role || '');
  const accessLevel = String(row.access_level || '');
  const header = (request.headers.get('x-mavinci-client') || '').toLowerCase();
  return {
    supabase,
    client: header === 'phone' ? 'phone' : header === 'web' ? 'web' : 'mac',
    employee: {
      id: String(row.id),
      authUserId: String(row.auth_user_id),
      name: String(row.name || ''),
      surname: String(row.surname || ''),
      role,
      accessLevel,
      permissions,
      financeScope: String(row.finance_access_scope || ''),
      isAdmin: role === 'admin' || accessLevel === 'admin' || permissions.includes('admin'),
    },
  };
}

const headers = { 'Cache-Control': 'private, no-store' };
export const nativeJson = (body: unknown, status = 200) => Response.json(body, { status, headers });
export const nativeUnauthorized = () => nativeJson({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, 401);
export async function readJson(request: Request, limit: number): Promise<any> {
  const text = await request.text();
  if (text.length > limit) throw new Error('too_large');
  return text ? JSON.parse(text) : {};
}
