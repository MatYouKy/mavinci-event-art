import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  if (
    mode === 'subscribe' &&
    challenge &&
    process.env.META_WEBHOOK_VERIFY_TOKEN &&
    token === process.env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Nieprawidłowa weryfikacja webhooka.' }, { status: 403 });
}

function validSignature(rawBody: string, signature: string | null) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return process.env.NODE_ENV !== 'production';
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Nieprawidłowy podpis webhooka.' }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody);
    if (payload.object !== 'page') return NextResponse.json({ received: true });
    const admin = createSupabaseAdminClient();
    let inserted = 0;

    for (const entry of payload.entry || []) {
      const pageId = String(entry.id || '');
      if (!pageId) continue;
      const { data: integration, error: integrationError } = await admin
        .from('marketing_integrations')
        .select('id, company_id')
        .eq('provider', 'meta')
        .contains('settings', { page_id: pageId })
        .maybeSingle();
      if (integrationError || !integration) continue;

      for (const event of entry.messaging || []) {
        const message = event.message;
        if (!message?.mid || message.is_echo) continue;
        const preview = String(
          message.text ||
            message.attachments?.[0]?.payload?.title ||
            (message.attachments?.length ? '[Załącznik]' : '[Wiadomość]'),
        ).slice(0, 500);
        const { error } = await admin.from('marketing_messages').upsert(
          {
            company_id: integration.company_id,
            integration_id: integration.id,
            provider: 'meta',
            external_thread_id: event.sender?.id || null,
            external_message_id: String(message.mid),
            sender_external_id: event.sender?.id || null,
            sender_name: null,
            message_preview: preview,
            received_at: event.timestamp
              ? new Date(Number(event.timestamp)).toISOString()
              : new Date().toISOString(),
            metadata: {
              source: 'webhook',
              attachments: message.attachments?.map((attachment: any) => attachment.type) || [],
            },
          },
          { onConflict: 'integration_id,external_message_id', ignoreDuplicates: true },
        );
        if (!error) inserted += 1;
      }
    }

    return NextResponse.json({ received: true, inserted });
  } catch (error) {
    console.error('[meta marketing webhook]', error);
    return NextResponse.json({ error: 'Nie udało się przetworzyć webhooka.' }, { status: 500 });
  }
}
