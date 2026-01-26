import { ILocation } from '@/app/(crm)/crm/locations/type';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';


export const getLocationById = cache(async (id: string): Promise<ILocation | null> => {
  if (!id) return null;

  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    // loguj, ale NIE crashuj RSC
    console.error('[getLocationById]', error.message);
    return null;
  }

  return data as ILocation;
});