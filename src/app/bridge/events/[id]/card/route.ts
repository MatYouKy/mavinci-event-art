import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { buildEventCardHtml } from '@/lib/events/print/buildEventCardHtml';
import { EventCardError, loadEventCardData } from '@/lib/events/print/loadEventCardData.server';
import { documentPrintJob, loadPrintFontCss, pdfContentDisposition, renderHtmlToPdf, resolveCachedPrintLogo } from '@/lib/print/pdfRenderer.server';
import { localRenderRequested, printJobResponse } from '@/lib/print/printJob.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Karta imprezy (PDF) dla kierownika imprezy — generowana na serwerze Next.
 * Dane czytamy klientem zalogowanej osoby (RLS): karta pokazuje tylko to, co ta osoba widzi w CRM,
 * i nigdy nie zawiera cen. Ciasteczko sesji CRM albo `Authorization: Bearer` (aplikacja mobilna / macOS).
 * `?download=1` — plik do pobrania zamiast podglądu. `?render=local` — zadanie wydruku dla lokalnego silnika PDF na Macu.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const eventId = params.id;
  const download = new URL(req.url).searchParams.get('download') === '1';
  if (!UUID.test(eventId)) {
    return NextResponse.json({ error: 'Nieprawidłowy identyfikator wydarzenia.' }, { status: 400 });
  }

  try {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1]?.trim();
    const userClient = bearer
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${bearer}` } },
        })
      : createSupabaseServerClient(cookies());
    const { data: authData } = bearer ? await userClient.auth.getUser(bearer) : await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, { status: 401 });
    }

    const card = await loadEventCardData(userClient, eventId, authData.user.id);

    const admin = createSupabaseAdminClient();
    try {
      card.data.companyLogoUrl = await resolveCachedPrintLogo(admin, card.companyId);
    } catch {
      // Bez logo do druku karta nadal powstaje (z nazwą firmy w nagłówku).
      card.data.companyLogoUrl = null;
    }

    const footer = {
      left: `Karta imprezy · ${card.data.event.name}${card.dateLabel ? ` · ${card.dateLabel}` : ''}`,
      right: card.data.website || '',
    };
    // `?render=local` (aplikacja na Maca): ten sam HTML i te same ustawienia druku — PDF powstaje na komputerze.
    if (localRenderRequested(req)) {
      return printJobResponse(documentPrintJob(buildEventCardHtml(card.data), { html: '', footer }, card.fileName));
    }

    const html = buildEventCardHtml(card.data).replace('/*invoice-print-fonts*/', await loadPrintFontCss());
    const { pdf, pageCount } = await renderHtmlToPdf({ html, footer });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': pdfContentDisposition(card.fileName, download),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Pdf-Pages': String(pageCount),
      },
    });
  } catch (e) {
    const status = e instanceof EventCardError ? e.status : 500;
    if (status >= 500) console.error('Event card PDF error:', e);
    return NextResponse.json(
      { error: e instanceof Error && status < 500 ? e.message : 'Nie udało się przygotować karty imprezy. Spróbuj ponownie.' },
      { status },
    );
  }
}
