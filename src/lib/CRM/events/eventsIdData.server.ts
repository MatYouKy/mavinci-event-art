import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { CookieStoreLike } from '@/lib/supabase/server.app';
import type { IEmployee } from '@/app/(crm)/crm/employees/type';
import { ViewMode, ViewModePreference } from '@/app/(crm)/crm/settings/page';

export function getCookieStore(): CookieStoreLike {
  const store = cookies();
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name, value, options) => store.set({ name, value, ...options }),
  };
}

export type EventRow = {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  location: string | null;
  status: string;
  category_id: string | null;
  expected_revenue: number | null;
  created_by: string | null;
  created_at: string;

  // relacje (to co selectujesz)
  organizations: { name: string | null; alias: string | null } | null;
  contacts: { first_name: string | null; last_name: string | null } | null;
  event_categories: { name: string | null; color: string | null } | null;
  locations: {
    name: string | null;
    formatted_address: string | null;
    address: string | null;
    city: string | null;
    postal_code: string | null;
  } | null;
  location_id: string | null;
  contact_person_id: string | null;
  category: EventCategoryRow | null;
  viewMode: ViewMode | null;
  creator: IEmployee | null;
};

export type EventCategoryRow = { id: string; name: string; color: string | null };

export async function fetchEventByIdServer(eventId: string): Promise<EventRow> {
  const supabase = createSupabaseServerClient(getCookieStore());



  const { data: auth, error: authError } = await supabase.auth.getUser();

  // ✅ brak sesji to normalna sytuacja — nie logujemy jako "error"
  if (authError) {
    if (authError.name === 'AuthSessionMissingError') return null;
    console.error('[fetchEventByIdServer] auth.getUser error:', authError);
    return null;
  }

  const email = auth.user?.email;
  if (!email) return null;

  const { data, error } = await supabase
      .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (error) throw error;

  const { data: eventCategory, error: eventCategoryError } = await supabase.from('event_categories').select('*').eq('id', data?.category_id).maybeSingle();

  const { data: creator, error: creatorError } = await supabase
  .from("employees")
  .select("id, name, surname, nickname, avatar_url, avatar_metadata, role, occupation, qualifications, is_active")
  .eq("id", data?.created_by)
  .single();


  if (eventCategoryError) throw eventCategoryError;
  return {
    ...data,
    category: eventCategory,
    creator: creator,
  } as unknown as EventRow & { category: EventCategoryRow };
}
