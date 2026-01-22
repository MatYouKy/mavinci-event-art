import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cache } from 'react';
import { cookies } from 'next/headers';

export type Preferences = Record<string, any>;

export async function getEmployeePreferences(employeeId: string): Promise<Preferences> {
  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase
    .from('employees')
    .select('preferences')
    .eq('id', employeeId)
    .single();

  if (error) throw error;
  return (data?.preferences ?? {}) as Preferences;
}

export const getEmployeePreferencesCached = cache(getEmployeePreferences);
