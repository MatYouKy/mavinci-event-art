// lib/seo.ts – SERVER ONLY (bez "use client")

import { supabase } from '@/lib/supabase';

export interface SeoData {
  title: string;
  description: string;
  keywords: string[];
  ogImage: string | null;
  schemaType: string;
  customSchema: any;
  globalConfig: any;
  places: any[];
  offers: any[];
}

function normalizeSlug(slug: string) {
  return slug.replace(/^\/+/, '').replace(/\/+$/, '');
}

export async function getSeoForPage(pageSlug: string): Promise<SeoData | null> {
  const normalizedPageSlug = normalizeSlug(pageSlug);

  const [globalRes, metadataRes, placesRes, offersRes] = await Promise.all([
    supabase.from('schema_org_global').select('*').single(),
    supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', normalizedPageSlug)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
    supabase
      .from('schema_org_places')
      .select('*')
      .eq('is_global', true)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('schema_org_page_offers')
      .select('*')
      .eq('page_slug', normalizedPageSlug)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('schema_org_page_metadata')
      .select('id, page_slug')
      .order('page_slug'),
  ]);

  if (!globalRes.data) return null;

  return {
    title: metadataRes.data?.title ?? '',
    description: metadataRes.data?.description ?? '',
    keywords: metadataRes.data?.keywords ?? [],
    ogImage: metadataRes.data?.og_image ?? globalRes.data.organization_logo,
    schemaType: metadataRes.data?.schema_type ?? 'LocalBusiness',
    customSchema: metadataRes.data?.custom_schema ?? {},
    globalConfig: globalRes.data,
    places: placesRes.data ?? [],
    offers: offersRes.data ?? [],
  };
}