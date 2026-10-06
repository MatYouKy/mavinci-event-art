import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { demoAdmin, demoJson, demoNetworkHash, demoSessionCookie, getDemoBrochure, isDemoUuid, readDemoSession } from '@/lib/seller/demo.server';
import { demoCookieName, resolveDemoAttribution } from '@/lib/seller/demoAttribution.server';
import { claimDemoPreview } from '@/lib/seller/demoPreview.server';
import { DEFAULT_DEMO, demoInputError, parseSellerDemoInput, validateDemoImage, validateDemoPortrait } from '@/lib/seller/demo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let generationId: string | null = null;
  let storedPath: string | null = null;
  const admin = demoAdmin();
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== request.headers.get('host') || !request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Otwórz formularz na stronie Mavinci.' }, 403);
    const brochure = await getDemoBrochure(params.id);
    if (!brochure) return json({ error: 'Ta demonstracja jest niedostępna.' }, 404);
    const payload = await demoJson(request);
    const source = request.nextUrl.searchParams.get('source') || '';
    if (source.length > 2048) return json({ error: 'Nieprawidłowy link demonstracji.' },400);
    const cookieName = demoCookieName(source);
    const cookieScope = params.id + ':' + source;
    let sessionId = readDemoSession(request.cookies.get(cookieName)?.value, source ? cookieScope : params.id);
    if (payload.action === 'visit') {
      const visitId = String(payload.visitId || '');
      if (!isDemoUuid(visitId)) return json({ error: 'Nieprawidłowe wejście.' }, 400);
      const attribution = source ? await resolveDemoAttribution(source, params.id) : null;
      sessionId ||= randomUUID();
      const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const { error } = await admin.rpc('record_seller_demo_visit', { p_session: sessionId, p_brochure: params.id, p_visit: visitId, p_network: demoNetworkHash(ip) });
      if (error) return json({ error: error.message.includes('Limit') ? 'Zbyt wiele prób. Wróć do demo za chwilę.' : 'Nie udało się rozpocząć demonstracji. Spróbuj ponownie.' }, error.message.includes('Limit') ? 429 : 503);
      if (attribution) {
        const { error: attributionError } = await admin.from('seller_demo_sessions').update({ brand_config: { attribution } }).eq('id',sessionId).eq('brochure_id',params.id);
        if (attributionError) throw new Error('Nie udało się przypisać sesji do broszury.');
      }
      const response = json({ ok: true });
      response.cookies.set(cookieName, demoSessionCookie(sessionId, source ? cookieScope : params.id), { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: `/bridge/seller-demo/${params.id}`, maxAge: 7200 });
      return response;
    }
    if (!sessionId) return json({ error: 'Sesja demonstracji wygasła. Odśwież stronę.' }, 401);
    const { data: session, error: sessionError } = await admin.from('seller_demo_sessions').select('id,brand_config').eq('id',sessionId).eq('brochure_id',params.id).maybeSingle();
    if (sessionError || !session) return json({ error: 'Nie udało się odczytać sesji demonstracji. Odśwież stronę.' }, 401);
    if (payload.action === 'download') {
      const id = String(payload.generationId || '');
      if (!isDemoUuid(id)) return json({ error: 'Nieprawidłowy dokument.' }, 400);
      const { error } = await admin.from('seller_demo_generations').update({ download_started_at: new Date().toISOString() }).eq('id',id).eq('session_id',sessionId).eq('status','ready').is('download_started_at',null);
      if (error) throw new Error('Nie udało się zapisać informacji o pobraniu.');
      return json({ ok: true });
    }
    if (payload.action === 'preview') {
      // Only cover inputs are accepted. Incomplete contact details and prices
      // must not block editing the cover or enter the preview payload.
      const raw = payload.input as Record<string, unknown> | undefined;
      const input = parseSellerDemoInput({ ...DEFAULT_DEMO, organization: raw?.organization, title: raw?.title,
        primary: raw?.primary, accent: raw?.accent, logo: raw?.logo, cover: raw?.cover });
      for (const field of ['logo','cover'] as const) {
        if (raw?.[field] && !input[field]) return json({ error: 'Grafika jest za duża lub ma nieobsługiwany format.' },400);
        validateDemoImage(input[field]);
      }
      const release = claimDemoPreview(sessionId);
      if (!release) return json({ error: 'Podgląd jest zajęty. Spróbuj ponownie za chwilę.' },429);
      try {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const result = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1/generate-offer-pdf', {
          method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputMode: 'demo_cover', offerId: sessionId, demo: input }), signal: AbortSignal.timeout(90000),
        });
        if (!result.ok || result.headers.get('X-Offer-Demo-Cover') !== 'cover-v1' || !result.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('Nie udało się odświeżyć okładki. Spróbuj ponownie.');
        const pdf = Buffer.from(await result.arrayBuffer());
        if (pdf.subarray(0,5).toString('ascii') !== '%PDF-' || pdf.length > 20*1024*1024) throw new Error('Nie udało się odczytać okładki.');
        return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
      } finally { release(); }
    }
    if (!['lead','pdf'].includes(String(payload.action))) return json({ error: 'Nieznana operacja.' },400);
    const input = parseSellerDemoInput(payload.input);
    const { logo, cover, portrait, ...details } = input;
    if (payload.action === 'pdf') {
      const message = demoInputError(input); if (message) return json({ error: message },400);
      if (typeof (payload.input as any)?.logo === 'string' && (payload.input as any).logo && !logo) return json({ error: 'Logo jest za duże lub ma nieobsługiwany format.' },400);
      if ((payload.input as any)?.cover && !cover) return json({ error: 'Zdjęcie jest za duże lub ma nieobsługiwany format.' },400);
      if ((payload.input as any)?.portrait && !portrait) return json({ error: 'Zdjęcie stopki jest za duże lub ma nieobsługiwany format.' },400);
      try { validateDemoPortrait(portrait); } catch (error) { return json({error: error instanceof Error ? error.message : 'Nieprawidłowe zdjęcie stopki.'},400); }
      validateDemoImage(logo);
      validateDemoImage(cover);
    }
    const { error: leadError } = await admin.from('seller_demo_sessions').update({ full_name: input.fullName, organization: input.organization, email: input.email, phone: input.phone, logo_added: Boolean(logo), brand_config: { attribution: session.brand_config?.attribution || null, primary: input.primary, accent: input.accent, surface: input.surface, coverAdded: Boolean(cover), portraitAdded: Boolean(portrait), website: input.website, title: input.title, prices: input.prices }, updated_at: new Date().toISOString() }).eq('id',sessionId).eq('brochure_id',params.id);
    if (leadError) throw new Error('Nie udało się zapisać próby. Spróbuj ponownie.');
    if (payload.action === 'lead') return json({ ok: true });
    const requestedGeneration = String(payload.generationId || '');
    if (!isDemoUuid(requestedGeneration)) return json({ error: 'Nieprawidłowe żądanie dokumentu.' },400);
    const { data: claimed, error: claimError } = await admin.rpc('claim_seller_demo_pdf',{ p_session: sessionId, p_generation: requestedGeneration });
    if (claimError) throw new Error('Nie udało się rozpocząć generowania PDF. Spróbuj ponownie.');
    if (!claimed) return json({ error: 'Generowanie już trwa lub wykorzystano limit prób. Spróbuj ponownie później.' },429);
    generationId = requestedGeneration;
    const { error: snapshotError } = await admin.from('seller_demo_generations').update({ snapshot: { ...details, attribution: session.brand_config?.attribution || null, logoAdded: Boolean(logo), coverAdded: Boolean(cover), portraitAdded: Boolean(portrait) } }).eq('id',generationId);
    if (snapshotError) throw new Error('Nie udało się zapisać danych dokumentu.');
    const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1/generate-offer-pdf';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers = { Authorization: 'Bearer ' + key, apikey: key };
    const capabilities = await fetch(endpoint,{method:'OPTIONS',headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
    if (capabilities.headers.get('X-Offer-Demo') !== 'demo-v2') throw new Error('Demonstracja PDF jest chwilowo niedostępna. Spróbuj później.');
    const result = await fetch(endpoint,{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({outputMode:'demo_binary',offerId:generationId,demo:input}),signal:AbortSignal.timeout(150000)});
    if (!result.ok || result.headers.get('X-Offer-Demo') !== 'demo-v2' || !result.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('Nie udało się przygotować PDF. Spróbuj ponownie za chwilę.');
    const pdf = Buffer.from(await result.arrayBuffer());
    if (pdf.subarray(0,5).toString('ascii') !== '%PDF-' || pdf.length > 20 * 1024 * 1024) throw new Error('Generator zwrócił nieprawidłowy dokument.');
    storedPath = `${params.id}/${sessionId}/${generationId}.pdf`;
    const { error: uploadError } = await admin.storage.from('seller-demo-pdfs').upload(storedPath,pdf,{contentType:'application/pdf',upsert:false});
    if (uploadError) throw new Error('Nie udało się zapisać próbnej oferty. Spróbuj ponownie.');
    const { error: doneError } = await admin.from('seller_demo_generations').update({status:'ready',pdf_path:storedPath,completed_at:new Date().toISOString()}).eq('id',generationId);
    if (doneError) {
      console.error('[seller-demo] History save failed', { generationId, code: doneError.code });
      throw new Error('Nie udało się zapisać historii próby. Spróbuj ponownie.');
    }
    return new NextResponse(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="oferta-demonstracyjna.pdf"','Cache-Control':'no-store','X-Demo-Generation':generationId}});
  } catch (error) {
    if (generationId) {
      if (storedPath) await admin.storage.from('seller-demo-pdfs').remove([storedPath]);
      await admin.from('seller_demo_generations').update({status:'failed',completed_at:new Date().toISOString()}).eq('id',generationId);
    }
    return json({error:error instanceof Error ? error.message : 'Nie udało się obsłużyć demonstracji.'},500);
  }
}
