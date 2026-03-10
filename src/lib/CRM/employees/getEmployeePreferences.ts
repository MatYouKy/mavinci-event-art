import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cache } from 'react';
import { cookies } from 'next/headers';

export type Preferences = Record<string, any>;

export async function getEmployeePreferences(): Promise<Preferences> {
  const supabase = createSupabaseServerClient(cookies());

  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;


  const { data, error } = await supabase
    .from('employees')
    .select('preferences')
    .eq('id', user.user?.id)
    .single();

  if (error) throw error;
  return (data?.preferences ?? {}) as Preferences;
}
