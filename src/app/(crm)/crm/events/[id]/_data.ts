// src/app/(crm)/crm/events/[id]/_data.ts
import { unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

import { createSupabaseServerClient } from '@/lib/supabase/server.app';

/**
 * Service-role server client (no cookies, safe for cached functions).
 * IMPORTANT: `SUPABASE_SERVICE_ROLE_KEY` must be set only on the server.
 */
function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchEventDetailsForUser(eventId: string, userId: string) {
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase.rpc('get_event_details_for_user', {
    event_id: eventId,
    user_id: userId,
  });

  if (error) {
    console.error('RPC error:', error);
    throw new Error(error.message);
  }

  if (!data || (data as any)?.error) return null;

  return {
    ...(data as any).event,
    organization: (data as any).organization || null,
    contact_person: (data as any).contact_person || null,
    category: (data as any).category || null,
    creator: (data as any).creator || null,
    employees: (data as any).employees || [],
    equipment: (data as any).equipment || [],
    vehicles: (data as any).vehicles || [],
    offers: (data as any).offers || [],
    event_attachments: (data as any).event_attachments || [],
  };
}

/**
 * ✅ Cached fetch.
 *
 * Why it previously returned null / errored:
 * - `unstable_cache` cannot call dynamic sources like `cookies()` INSIDE the cached function.
 *
 * Fix:
 * - Read cookies + user OUTSIDE cache.
 * - Cache a pure function that takes (eventId, userId) and uses service-role client.
 * - Include `userId` in cache key to avoid leaking data across users.
 */
export async function getEventDetailsCached(eventId: string) {
  // dynamic data source must be OUTSIDE cached function
  const cookieStore = cookies();
  const supabaseAuth = createSupabaseServerClient(cookieStore);

  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user?.id) return null;

  const cached = unstable_cache(
    () => fetchEventDetailsForUser(eventId, user.id),
    [`event-details:${eventId}:user:${user.id}`],
    { tags: [`event:${eventId}`, `event-user:${user.id}`], revalidate: 60 },
  );

  return cached();
}