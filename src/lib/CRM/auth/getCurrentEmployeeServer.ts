import type { IEmployee } from '@/app/(crm)/crm/employees/type';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cache } from 'react';
import { cookies } from 'next/headers';

export async function getCurrentEmployeeServer(): Promise<IEmployee | null> {
  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (error.name === 'AuthSessionMissingError') return null;
    console.error('[getCurrentEmployeeServer] auth.getUser error:', error);
    return null;
  }

  const userId = data.user?.id;
  if (!userId) return null;

  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('*')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (empError) {
    console.error('[getCurrentEmployeeServer] employees query error:', empError);
    return null;
  }

  return (employee ?? null) as IEmployee | null;
}

export const getCurrentEmployeeServerCached = cache(getCurrentEmployeeServer);