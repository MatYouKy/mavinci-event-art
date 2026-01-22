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
};

export type EventCategoryRow = { id: string; name: string; color: string | null };

export async function fetchEventsInitialServer(): Promise<EventRow[]> {
  const supabase = createSupabaseServerClient(getCookieStore());

  // auth z cookies (jeśli brak sesji → pusta lista)
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return [];

  // Uwaga: Ty masz RLS i polityki na events/tasks/employees.
  // To oznacza: jeśli user nie ma uprawnień, select i tak wróci pusty.
  // Nie musimy ręcznie robić "admin vs assigned" w JS — RLS to ogarnie.

  const { data, error } = await supabase
    .from('events')
    .select(
      `
        id, name, event_date, event_end_date, location, status, category_id,
        expected_revenue, created_by, created_at,
        organizations(name, alias),
        contacts(first_name, last_name),
        event_categories(name, color),
        locations(name, formatted_address, address, city, postal_code)
      `,
    )
    .order('event_date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as EventRow[];
}

export async function fetchEventCategoriesServer(): Promise<EventCategoryRow[]> {
  const supabase = createSupabaseServerClient(getCookieStore());

  const { data, error } = await supabase
    .from('event_categories')
    .select('id, name, color')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as EventCategoryRow[];
}