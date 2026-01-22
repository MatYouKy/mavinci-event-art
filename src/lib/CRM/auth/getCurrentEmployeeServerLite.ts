import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';
interface EmployeeLite {
  id: string;
  name: string;
  surname: string;
  avatar_url?: string | null;
  avatar_metadata?: any;
}

export async function getCurrentEmployeeServerLite(): Promise<EmployeeLite | null> {
  const supabase = createSupabaseServerClient(cookies());

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) return null;

  const { data, error } = await supabase
    .from('employees')
    .select('id, role, access_level, permissions, navigation_order, last_active_at')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error('[getCurrentEmployeeServerLite] employees query error:', error);
    return null;
  }

  return (data ?? null) as unknown as EmployeeLite | null;
}
