'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { canEditWebsite } from '@/lib/permissions';
import { servicePath } from '@/lib/SEO/serviceUrls';

export async function updateServiceSEO(serviceId: string, _slug: string, data: {
  name: string; description: string; seo_title?: string | null;
  seo_description?: string | null; seo_keywords?: string | null;
}) {
  try {
    const employee = await getCurrentEmployeeServerCached();
    if (!employee || employee.is_active === false || !canEditWebsite(employee)) {
      return { success: false, error: 'Brak uprawnień do edycji strony.' };
    }
    if (!data.name.trim()) return { success: false, error: 'Nazwa usługi jest wymagana.' };
    const db = createSupabaseServerClient(cookies());
    const { data: saved, error } = await db.from('conferences_service_items').update({
      name: data.name.trim(), description: data.description,
      seo_title: data.seo_title || null, seo_description: data.seo_description || null,
      seo_keywords: data.seo_keywords || null, updated_at: new Date().toISOString(),
    }).eq('id', serviceId).select('id,slug').single();
    if (error || !saved) return { success: false, error: 'Nie udało się zapisać danych usługi.' };
    revalidatePath(servicePath(saved));
    revalidatePath('/uslugi');
    revalidatePath('/sitemap-uslugi.xml');
    return { success: true };
  } catch {
    return { success: false, error: 'Nie udało się zapisać zmian. Spróbuj ponownie.' };
  }
}
