
import type { IEmployee } from '@/app/(crm)/crm/employees/type';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cache } from 'react';
import { cookies } from 'next/headers';

export async function getCurrentEmployeeServer(): Promise<IEmployee | null> {
  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase.auth.getUser();

  // ✅ brak sesji to normalna sytuacja — nie logujemy jako "error"
  if (error) {
    if (error.name === 'AuthSessionMissingError') return null;
    console.error('[getCurrentEmployeeServer] auth.getUser error:', error);
    return null;
  }

  const email = data.user?.email;
  if (!email) return null;

  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (empError) {
    console.error('[getCurrentEmployeeServer] employees query error:', empError);
    return null;
  }

  return (employee ?? null) as IEmployee | null;
}

export const getCurrentEmployeeServerCached = cache(getCurrentEmployeeServer);