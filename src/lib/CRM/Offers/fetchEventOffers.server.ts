import 'server-only';
import { createClient } from '@supabase/supabase-js';

// ✅ użyj zmiennych serwerowych (Service Role albo anon + RLS + cookies)
// Jeśli chcesz czytać w kontekście usera (RLS), lepiej użyć @supabase/auth-helpers-nextjs (niżej dopiszę wariant).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // <- tylko na serwerze!
  { auth: { persistSession: false } },
);

export async function fetchEventOffersServer(eventId: string) {
  const { data, error } = await supabaseAdmin
    .from('offers')
    .select(
      `
      *,
      organization:organizations!organization_id(name),
      contact:contacts!contact_id(first_name, last_name, full_name),
      creator:employees!created_by(name, surname)
    `,
    )
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[fetchEventOffersServer] supabase error:', error);
    throw new Error(error.message);
  }

  return data || [];
}