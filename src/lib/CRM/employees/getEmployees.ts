import { cache } from 'react';

import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';

/**
 * CRM: pobiera wszystkich pracowników.
 * Uwaga: service role = pełny dostęp (trzymaj tylko po stronie serwera).
 */
export async function getEmployees(): Promise<IEmployee[]> {
  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getEmployees] Supabase error:', error);
    throw error;
  }

  return (data ?? []) as IEmployee[];
}

export const getEmployeesCached = cache(getEmployees);
