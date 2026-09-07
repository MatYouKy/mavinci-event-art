import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { authorizeWeddingDocument, weddingSenderAccounts, WeddingDocumentError, UUID_PATTERN } from '../wedding-card-pdf/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const SOURCE = 'wedding-card-document';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const deliveryFields = 'id,status,scheduled_at,sent_at,last_error,metadata';
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
const deliveryView = (row: any) => row ? ({ id: row.id, status: row.status, scheduledAt: row.scheduled_at, sentAt: row.sent_at, error: row.last_error }) : null;
function failure(error: unknown) {
  if (!(error instanceof WeddingDocumentError)) console.error('Wedding card delivery failed:', error);
  return json({ error: error instanceof WeddingDocumentError ? error.message : 'Nie udało się obsłużyć dokumentu. Spróbuj ponownie.' }, error instanceof WeddingDocumentError ? error.status : 500);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get('eventId') || '';
    const access = await authorizeWeddingDocument(request, eventId);
    const { admin } = access;
    const jobId = url.searchParams.get('jobId');
    if (jobId) {
      if (!UUID_PATTERN.test(jobId)) throw new WeddingDocumentError('Nieprawidłowa wiadomość.');
      const { data, error } = await admin.from('scheduled_emails').select(deliveryFields).eq('id', jobId)
        .eq('metadata->>documentSource', SOURCE).eq('metadata->>eventId', eventId).eq('metadata->>actor', access.actor).maybeSingle();
      if (error) throw error;
      if (!data) throw new WeddingDocumentError('Nie znaleziono zlecenia wysyłki.', 404);
      return json({ delivery: deliveryView(data) });
    }
    const [fileResult, cardResult] = await Promise.all([
      admin.from('event_files').select('id,name,file_path,updated_at').eq('event_id', eventId)
        .like('file_path', `${eventId}/documents/wedding-card/%`).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('wedding_cards').select('id,updated_at').eq('event_id', eventId).maybeSingle(),
    ]);
    if (fileResult.error || cardResult.error) throw fileResult.error || cardResult.error;
    const file = fileResult.data;
    let document = null;
    if (file) {
      const signed = await admin.storage.from('event-files').createSignedUrl(file.file_path, 3600);
      if (signed.error) throw signed.error;
      document = { fileId: file.id, fileName: file.name, storagePath: file.file_path, generatedAt: file.updated_at, signedUrl: signed.data.signedUrl, stale: Boolean(cardResult.data && Date.parse(cardResult.data.updated_at) > Date.parse(file.updated_at)) };
    }
    const people = cardResult.data ? await admin.from('wedding_card_people').select('first_name,last_name,email,role').eq('wedding_card_id', cardResult.data.id).in('role', ['bride', 'groom']) : { data: [], error: null };
    if (people.error) throw people.error;
    let accounts: Awaited<ReturnType<typeof weddingSenderAccounts>> = [];
    let emailUnavailable: string | null = null;
    try { accounts = await weddingSenderAccounts(access); } catch { emailUnavailable = 'Nie udało się pobrać dostępnych skrzynek CRM.'; }
    if (!emailUnavailable && !accounts.length) emailUnavailable = !access.userId
      ? 'Adres logowania administratora Event Rulers musi odpowiadać aktywnemu kontu pracownika w CRM. Generowanie PDF jest dostępne niezależnie od poczty.'
      : 'Nie masz przypisanej aktywnej skrzynki z prawem wysyłania w CRM.';
    return json({ document, accounts, emailUnavailable, recipients: (people.data || []).filter((person) => person.email).map((person) => ({ email: person.email, name: [person.first_name, person.last_name].filter(Boolean).join(' ') })) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.eventId !== 'string') throw new WeddingDocumentError('Brak wydarzenia.');
    const { eventId } = body;
    const access = await authorizeWeddingDocument(request, eventId);
    const { admin, employeeId, userId, actor } = access;
    if (!employeeId || !userId) throw new WeddingDocumentError('Połącz konto administratora z aktywnym pracownikiem CRM.', 403);
    for (const key of ['requestId', 'fileId', 'emailAccountId']) if (typeof body[key] !== 'string' || !UUID_PATTERN.test(body[key])) throw new WeddingDocumentError('Nieprawidłowe dane wiadomości.');
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) || to.length > 320 || /[\r\n]/.test(to)) throw new WeddingDocumentError('Podaj jeden poprawny adres odbiorcy.');
    if (!subject || subject.length > 250 || /[\r\n]/.test(subject) || !message || message.length > 20000) throw new WeddingDocumentError('Uzupełnij poprawny temat i treść wiadomości.');
    const scheduledAt = body.scheduledAt || null;
    if (scheduledAt && (typeof scheduledAt !== 'string' || !Number.isFinite(Date.parse(scheduledAt)))) throw new WeddingDocumentError('Nieprawidłowy termin wysyłki.');
    const fingerprint = createHash('sha256').update(JSON.stringify([eventId, actor, body.fileId, body.storagePath, body.emailAccountId, to, subject, message, scheduledAt])).digest('hex');
    const readJob = async () => {
      const result = await admin.from('scheduled_emails').select(deliveryFields).eq('id', body.requestId).maybeSingle();
      if (result.error) throw result.error;
      if (result.data && (result.data.metadata?.documentSource !== SOURCE || result.data.metadata?.actor !== actor || result.data.metadata?.fingerprint !== fingerprint)) throw new WeddingDocumentError('Ten identyfikator wysyłki dotyczy innej wiadomości.', 409);
      return result.data;
    };
    // Retrying after a lost HTTP response returns the same job instead of sending twice.
    const existing = await readJob();
    if (existing) return json({ delivery: deliveryView(existing) });
    const deliveryTime = scheduledAt ? new Date(scheduledAt) : new Date();
    if (scheduledAt && (deliveryTime.getTime() < Date.now() + 20000 || deliveryTime.getTime() > Date.now() + 366 * 86400000)) throw new WeddingDocumentError('Wybierz termin w przyszłości, maksymalnie rok naprzód.');
    const accounts = await weddingSenderAccounts(access);
    if (!accounts.some((account) => account.id === body.emailAccountId)) throw new WeddingDocumentError('Nie masz prawa wysyłania z wybranej skrzynki.', 403);
    const [fileResult, cardResult] = await Promise.all([
      admin.from('event_files').select('id,name,file_path,updated_at,mime_type').eq('id', body.fileId).eq('event_id', eventId).maybeSingle(),
      admin.from('wedding_cards').select('updated_at').eq('event_id', eventId).maybeSingle(),
    ]);
    if (fileResult.error || cardResult.error) throw fileResult.error || cardResult.error;
    const file = fileResult.data;
    if (!file || file.mime_type !== 'application/pdf' || !file.file_path.startsWith(`${eventId}/documents/wedding-card/`) || file.file_path !== body.storagePath) throw new WeddingDocumentError('Dokument zmienił się. Odśwież podgląd PDF przed wysłaniem.', 409);
    if (!cardResult.data || Date.parse(cardResult.data.updated_at) > Date.parse(file.updated_at)) throw new WeddingDocumentError('Karta została zmieniona po wygenerowaniu PDF. Wygeneruj aktualny dokument.', 409);
    const { data: pdf, error: downloadError } = await admin.storage.from('event-files').download(file.file_path);
    if (downloadError || !pdf) throw new WeddingDocumentError('Nie udało się pobrać załącznika.', 503);
    if (pdf.size > 20 * 1024 * 1024) throw new WeddingDocumentError('PDF przekracza limit załącznika 20 MB.');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new WeddingDocumentError('Plik nie jest prawidłowym dokumentem PDF.');
    const path = `scheduled/${body.requestId}/${randomUUID()}.pdf`;
    const uploaded = await admin.storage.from('email-attachments').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (uploaded.error) throw new WeddingDocumentError('Nie udało się przygotować załącznika do wysyłki.', 503);
    const payload = {
      emailAccountId: body.emailAccountId, to, subject,
      body: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${escapeHtml(message).replace(/\n/g, '<br>')}</div>`,
      attachments: [{ filename: file.name, contentType: 'application/pdf', contentDisposition: 'attachment', scheduledStorage: { bucket: 'email-attachments', path } }],
    };
    const queued = await admin.from('scheduled_emails').insert({
      id: body.requestId, created_by: userId, employee_id: employeeId, email_account_id: body.emailAccountId,
      function_name: 'send-email', payload,
      metadata: { documentSource: SOURCE, actor, fingerprint, eventId, documentFileId: file.id, documentStoragePath: file.file_path, actionUrl: `/crm/events/${eventId}` },
      timezone: 'Europe/Warsaw', scheduled_at: deliveryTime.toISOString(), next_attempt_at: deliveryTime.toISOString(),
    }).select(deliveryFields).single();
    if (queued.error) {
      // An insert may have succeeded even when its response was lost. Never remove
      // its attachment unless another, confirmed job owns a different snapshot.
      const recovered = await readJob();
      if (recovered) {
        const winner = await admin.from('scheduled_emails').select('payload').eq('id', body.requestId).single();
        if (!winner.error && winner.data?.payload?.attachments?.[0]?.scheduledStorage?.path !== path) await admin.storage.from('email-attachments').remove([path]);
        return json({ delivery: deliveryView(recovered) });
      }
      throw new WeddingDocumentError('Nie potwierdzono zapisu do kolejki. Ponów tę samą próbę — nie utworzy drugiej wiadomości.', 503);
    }
    return json({ delivery: deliveryView(queued.data) }, 202);
  } catch (error) { return failure(error); }
}
