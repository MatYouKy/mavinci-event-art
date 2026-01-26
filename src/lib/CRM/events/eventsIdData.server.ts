import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { CookieStoreLike } from '@/lib/supabase/server.app';

function getCookieStore(): CookieStoreLike {
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
};

export type EventCategoryRow = { id: string; name: string; color: string | null };

export async function fetchEventByIdServer(eventId: string): Promise<EventRow> {
  const supabase = createSupabaseServerClient(getCookieStore());

  // auth z cookies (jeśli brak sesji → pusta lista)
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return {} as EventRow;

  // Uwaga: Ty masz RLS i polityki na events/tasks/employees.
  // To oznacza: jeśli user nie ma uprawnień, select i tak wróci pusty.
  // Nie musimy ręcznie robić "admin vs assigned" w JS — RLS to ogarnie.

  const { data, error } = await supabase
      .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (error) throw error;
  return (data ?? {} as EventRow);
}
