'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';

const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

export async function updateServiceSEO(
  serviceId: string,
  slug: string,
  data: {
    name: string;
    description: string;
    seo_title?: string | null;
    seo_description?: string | null;
    seo_keywords?: string | null;
  }
) {
  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('conferences_service_items')
      .update({
        name: data.name,
        description: data.description,
        seo_title: data.seo_title || null,
        seo_description: data.seo_description || null,
        seo_keywords: data.seo_keywords || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', serviceId);

    if (error) {
      console.error('Error updating service:', error);
      return { success: false, error: error.message };
    }

    // Revalidate the service page and services list
    revalidatePath(`/uslugi/${slug}`);
    revalidatePath('/uslugi');

    return { success: true };
  } catch (error) {
    console.error('Error in updateServiceSEO:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
