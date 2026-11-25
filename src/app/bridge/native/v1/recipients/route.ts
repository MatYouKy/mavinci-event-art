import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import {
  RECIPIENT_SUGGESTION_LIMIT, recipientSuggestionFromRow, type RecipientSuggestion,
} from '@/lib/CRM/messages/recipientSuggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Podpowiedzi adresatów w polach „Do”, „DW” i „UDW” (aplikacja na Maca; CRM i telefon wołają funkcję bazy bezpośrednio).
 * GET ?q=<fragment>&limit=<1–20> → { suggestions: [{ email, name, kind, contactId, organizationId, organizationName,
 * employeeId, sentCount, receivedCount, lastAt }] }. Funkcja bazy `email_recipient_suggestions` działa tokenem pracownika
 * (RLS) — podpowiada tylko kontakty, organizacje i korespondencję, które ta osoba widzi w CRM. Bez wymogu dostępu do skrzynek:
 * w oknach wysyłki ofert, umów czy kalkulacji podpowiadają się co najmniej kontakty i pracownicy.
 * Przed migracją bazy — pusta lista (`available: false`), pole działa jak zwykłe pole adresu.
 */

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const requested = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(20, Math.round(requested)) : RECIPIENT_SUGGESTION_LIMIT;
  if (!query) return nativeJson({ suggestions: [], available: true });
  const { data, error } = await ctx.supabase.rpc('email_recipient_suggestions', { p_query: query, p_limit: limit });
  if (error) {
    console.warn('[native-recipients]', error.message);
    return nativeJson({ suggestions: [], available: false });
  }
  const suggestions = ((data || []) as Array<Record<string, unknown>>)
    .map(recipientSuggestionFromRow)
    .filter((item): item is RecipientSuggestion => Boolean(item));
  return nativeJson({ suggestions, available: true });
}
