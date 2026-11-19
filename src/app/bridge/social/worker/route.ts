import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { errorMessage, runSocialPublishing, syncSocialComments } from '@/lib/social/socialMeta.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Social media — zadania z harmonogramu bazy (pg_cron → `invoke_social_worker`): `publish` — publikacja postów w terminie
 * (i dokończenie przerwanych), `comments` — odświeżenie komentarzy postów z ostatnich 30 dni. Nagłówek
 * `x-marketing-cron-secret` = `MARKETING_CRON_SECRET` (ten sam sekret co synchronizacja marketingu, w vault bazy:
 * `marketing_cron_secret`).
 */

function authorised(request: NextRequest) {
  const expected = process.env.MARKETING_CRON_SECRET || '';
  const actual = request.headers.get('x-marketing-cron-secret') || '';
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: 'Brak dostępu.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const task = String(body?.task || '');
  try {
    if (task === 'publish') {
      // Najwyżej 3 posty na wywołanie (każdy kanał Instagram to kontener + publikacja) — reszta za minutę.
      const results = await runSocialPublishing({ limit: 3 });
      return NextResponse.json({
        ok: true,
        published: results.filter((result) => result.status === 'published').length,
        failed: results.filter((result) => result.status === 'failed').length,
        results,
      });
    }
    if (task === 'comments') {
      return NextResponse.json({ ok: true, ...(await syncSocialComments({ limit: 100 })) });
    }
    return NextResponse.json({ error: 'Nieznane zadanie.' }, { status: 400 });
  } catch (error) {
    console.error('[social-worker]', task, error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
