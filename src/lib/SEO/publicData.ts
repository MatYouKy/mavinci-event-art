import 'server-only';
import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

/** Anonymous public reads only; never put user sessions into a shared cache. */
export function publicSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

export const getPublicGlobalConfig = cache(async () => {
  const { data } = await publicSupabase().from('schema_org_global').select('*').maybeSingle();
  return data;
});

export const getPublicPageMetadata = cache(async (pageSlug: string) => {
  const { data } = await publicSupabase().from('schema_org_page_metadata').select('*')
    .eq('page_slug', pageSlug).eq('is_active', true).maybeSingle();
  return data;
});

/** Same publication predicate for conference pages and their sitemap. */
export const getPublishedConferenceCities = cache(async () => {
  const { data, error } = await publicSupabase().from('schema_org_places').select('*')
    .eq('is_global', true).eq('is_active', true).order('display_order');
  if (error) throw new Error('Nie udało się odczytać opublikowanych lokalizacji konferencji.');
  return (data || []).filter((city) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.locality || ''));
});
