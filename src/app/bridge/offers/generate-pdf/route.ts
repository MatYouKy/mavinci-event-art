import { streamOfferPdf } from '@/lib/offer-pdf/progressStream';
import { createClient } from '@supabase/supabase-js';
import { generateOfferPdf } from '@/lib/offer-pdf/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
    });
    const { data: { user }, error } = await caller.auth.getUser();
    if (error || !user) return Response.json({ error: 'Zaloguj się ponownie.' }, { status: 401 });
    const body = await request.json();
    if (typeof body.offerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.offerId) || !['pl','en'].includes(body.language || 'pl')) return Response.json({ error: 'Nieprawidłowe dane oferty.' }, { status: 400 });
    const permission = await caller.rpc('sales_can_manage_offer', { p_offer: body.offerId });
    if (permission.error || !permission.data) return Response.json({ error: 'Brak uprawnień do tej oferty.' }, { status: 403 });
    const employee = await caller.from('employees').select('id').or(`id.eq.${user.id},auth_user_id.eq.${user.id}`).eq('is_active', true).limit(1).maybeSingle();
    if (employee.error || !employee.data) return Response.json({ error: 'Brak aktywnego konta pracownika.' }, { status: 403 });
    // Public endpoint always creates a CRM document. Private/demo modes are internal only.
    const renderRequest = new Request(request.url, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId: body.offerId, language: body.language || 'pl', expectedEnglishSignature: body.expectedEnglishSignature, employeeId: employee.data.id, outputMode: 'crm' }),
    });
    return request.headers.get('accept')?.includes('application/x-ndjson')
      ? streamOfferPdf(renderRequest)
      : await generateOfferPdf(renderRequest);
  } catch (error) {
    console.error('[offer-pdf-bridge]', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Nie udało się wygenerować oferty PDF.' }, { status: 500 });
  }
}
