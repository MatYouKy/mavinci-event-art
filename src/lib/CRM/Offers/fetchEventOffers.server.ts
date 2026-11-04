import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Oferty wydarzenia w kontekście zalogowanego użytkownika (klient z cookies → RLS ofert).
 * Wcześniej odczyt szedł kluczem service role i trafiał do danych strony u każdego, kto widział wydarzenie
 * (magazyn, ekipa) — razem z kwotami i kosztami. Wywołuj tylko z obszarem „oferta / umowa” albo „kwoty”.
 */
export async function fetchEventOffersServer(client: SupabaseClient, eventId: string) {
  const { data, error } = await client
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
    // Brak dostępu nie blokuje strony wydarzenia — po prostu bez ofert.
    console.error('[fetchEventOffersServer] supabase error:', error.message);
    return [];
  }

  return data || [];
}
