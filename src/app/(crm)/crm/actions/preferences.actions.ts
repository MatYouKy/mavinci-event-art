'use server';

import { createClient } from '@supabase/supabase-js';

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function updateEmployeePreferences(employeeId: string, preferences: any) {
  const supabase = getServerSupabase();

  const { error } = await supabase
    .from('employees')
    .update({ preferences })
    .eq('id', employeeId);

  if (error) throw error;

  return { ok: true };
}