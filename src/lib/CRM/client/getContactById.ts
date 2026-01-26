import { ContactRow, UUID } from '@/app/(crm)/crm/contacts/types';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';
import { cache } from 'react';

export const getContactById = cache(async (id: UUID): Promise<ContactRow | null> => {
  if (!id) return null;

  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('[getContactById]', error.message);
    return null;
  }

  return data as ContactRow;
});