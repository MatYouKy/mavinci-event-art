import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const fields = 'id,filename,content_type,size_bytes,storage_path';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function list(admin: Admin, id: string) {
  const result = await admin.from('email_attachments').select(fields).eq('email_type', 'sent').eq('email_id', id).order('created_at');
  if (result.error) throw new Error('Nie udało się odczytać archiwum załączników.');
  return result.data || [];
}

// Restore only a delivery explicitly bound to this Message-ID. Never infer a
// version from the subject, recipient, nearest date, or the current document.
async function recoverSalesPdf(admin: Admin, email: any) {
  if (!email.message_id) return;
  const escaped = String(email.message_id).replace(/[\\%_]/g, '\\$&');
  const direct = await admin.from('inquiry_activity').select('delivery_key,metadata')
    .eq('kind', 'delivery').like('delivery_key', `%:${escaped}`).limit(10);
  if (direct.error) throw new Error('Nie udało się odczytać historii wysyłki.');
  const deliveries = (direct.data || []).filter(row =>
    ['offer', 'calculation'].some(kind => row.delivery_key === `${kind}:${row.metadata?.document_id}:${email.message_id}`));

  const scheduled = await admin.from('scheduled_emails').select('id,function_name')
    .eq('provider_message_id', email.message_id).eq('email_account_id', email.email_account_id)
    .eq('status', 'sent').in('function_name', ['send-offer-email', 'send-email']).limit(2);
  if (scheduled.error) throw new Error('Nie udało się odczytać historii zaplanowanej wysyłki.');
  if (scheduled.data?.length === 1) {
    const history = await admin.from('inquiry_activity').select('delivery_key,metadata')
      .eq('kind', 'delivery').eq('delivery_key', `scheduled:${scheduled.data[0].id}`).maybeSingle();
    if (history.error) throw new Error('Nie udało się odczytać historii wysyłki.');
    if (history.data) deliveries.push(history.data);
  }
  if (deliveries.length !== 1) return;
  const delivery = deliveries[0];
  const metadata = delivery.metadata;
  if (!metadata?.document_id || !metadata?.storage_path || metadata.recipient !== email.to_address) return;
  const isOffer = delivery.delivery_key.startsWith('offer:') ||
    (delivery.delivery_key.startsWith('scheduled:') && scheduled.data?.[0]?.function_name === 'send-offer-email');
  const bucket = isOffer ? 'generated-offers' : 'event-files';
  const registered = await admin.from('sales_document_files').select('id')
    .eq(isOffer ? 'offer_id' : 'calculation_id', metadata.document_id)
    .eq('storage_bucket', bucket).eq('storage_path', metadata.storage_path).maybeSingle();
  if (registered.error) throw new Error('Nie udało się sprawdzić zapisanej wersji PDF.');
  if (!registered.data) return;
  const source = await admin.storage.from(bucket).download(metadata.storage_path);
  if (source.error || !source.data) throw new Error('Historia wskazuje wysłany PDF, ale nie udało się pobrać jego archiwalnej wersji.');
  const hash = createHash('sha256').update(`${email.id}:${bucket}:${metadata.storage_path}`).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  // Historical metadata did not retain the attachment's original filename.
  const filename = isOffer ? 'Wyslana-oferta.pdf' : 'Wyslana-kalkulacja.pdf';
  const path = `sent/${email.id}/recovered-${id}.pdf`;
  const upload = await admin.storage.from('email-attachments').upload(path, source.data, { contentType: 'application/pdf', upsert: true });
  if (upload.error) throw new Error('Nie udało się zapisać odzyskanego załącznika.');
  const saved = await admin.from('email_attachments').upsert({
    id, email_id: email.id, email_type: 'sent', filename, content_type: 'application/pdf',
    size_bytes: source.data.size, storage_path: path,
  }, { onConflict: 'id' });
  if (saved.error) throw new Error('Nie udało się zapisać listy załączników.');
  await admin.from('sent_emails').update({ has_attachments: true }).eq('id', email.id);
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== request.headers.get('host')) return json({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    const input = await request.json().catch(() => null);
    if (typeof input?.messageId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.messageId)) return json({ error: 'Nieprawidłowa wiadomość.' }, 400);
    const client = createSupabaseServerClient(cookies());
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: 'Zaloguj się ponownie.' }, 401);
    // Check mailbox access using the caller's RLS before accessing the archive.
    const authorized = await client.from('sent_emails').select('*').eq('id', input.messageId).maybeSingle();
    if (authorized.error) return json({ error: 'Nie udało się sprawdzić dostępu do wiadomości.' }, 503);
    if (!authorized.data) return json({ error: 'Brak dostępu do wiadomości.' }, 403);
    const email = authorized.data;
    const admin = createSupabaseAdminClient();
    let attachments = await list(admin, email.id);
    const archive = email.delivery_archive?.attachments;
    if (attachments.length === 0 && !(archive?.status === 'complete' && archive.expected === 0)) {
      try {
        await recoverSalesPdf(admin, email);
        attachments = await list(admin, email.id);
      } catch {
        return json({ attachments, syncError: 'Nie udało się odzyskać archiwalnego załącznika. Spróbuj ponownie.' });
      }
    }
    return json({ attachments });
  } catch {
    return json({ error: 'Nie udało się odczytać archiwum załączników.' }, 503);
  }
}
