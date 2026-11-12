import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Wersja wdrożonego CRM (znacznik builda z `next.config.js`). Karta przeglądarki porównuje ją ze swoją wersją
 * (`AppVersionWatcher`) — po wdrożeniu stara karta odświeża się sama, zamiast pracować na nieaktualnym kodzie
 * (np. ze starym adresem bazy po przeniesieniu do Frankfurtu).
 */
export function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_APP_BUILD || null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
