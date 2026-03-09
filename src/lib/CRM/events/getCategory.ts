import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getCookieStore } from './eventsIdData.server';

export async function getCategoryById(categoryId: string) {
  const supabase = createSupabaseServerClient(getCookieStore());
  const { data, error } = await supabase.from('event_categories').select('*').eq('id', categoryId).maybeSingle();
  if (error) throw error;
  return data;
}