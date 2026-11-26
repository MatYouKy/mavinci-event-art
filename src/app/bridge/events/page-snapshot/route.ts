import { NextResponse } from 'next/server';
import { requireSessionEmployee } from '@/lib/auth/requireEmployee.server';
import { fetchEventsPageSnapshot } from '@/lib/CRM/events/eventsPageSnapshot.server';

export const dynamic = 'force-dynamic';

/**
 * Odświeżenie listy eventów w CRM (`EventsPageClient`): ten sam zestaw danych co strona (`fetchEventsPageSnapshot` — eventy,
 * płatności, etapy operacyjne, eventy kolegów ze sprzedaży), sesją pracownika z ciasteczek (RLS). Metoda GET — odczyt działa
 * także w trybie testowym „widok jako” (`docs/test-mode.md`), w którym akcje serwera Next są wyłączone.
 */
export async function GET(request: Request) {
  const access = await requireSessionEmployee(request);
  if (!access.ok) return access.response;
  try {
    const snapshot = await fetchEventsPageSnapshot();
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[events/page-snapshot]', error);
    return NextResponse.json({ error: 'Nie udało się odświeżyć listy eventów.' }, { status: 500 });
  }
}
