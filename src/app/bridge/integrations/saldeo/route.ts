import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { saldeoDocumentExclusionReason } from '@/lib/saldeoDeliveryEligibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const DOCUMENT_TYPES = new Set(['FK', 'DS', 'P']);
const SOURCE_TABLES = { external_invoice: 'external_invoices', local_invoice: 'invoices' } as const;
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Metadata = Record<string, unknown>;
type Claim = { id: string; my_company_id: string; recipient: string; delivery_key: string;
  delivery_kind: string; status: string; sent_by: string; metadata: Metadata };
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store, max-age=0' },
});

class SaldeoError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function serverPin() {
  const pin = process.env.PIN_SALDEO?.trim() || '';
  return /^[^\s()\r\n]{4,64}$/.test(pin) ? pin : null;
}

function requiredUuid(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new SaldeoError(message);
  return value;
}

async function authorize(request: NextRequest, companyId: string) {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) throw new SaldeoError('Zaloguj się ponownie przed wysyłką do Saldeo.', 401);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw new SaldeoError('Serwer nie ma kompletnej konfiguracji wysyłki do Saldeo.', 503);
  }
  const admin = createSupabaseAdminClient();
  const authenticated = await admin.auth.getUser(token);
  if (authenticated.error || !authenticated.data.user) {
    throw new SaldeoError('Sesja wygasła. Zaloguj się ponownie.', 401);
  }
  const actor = authenticated.data.user;
  const employee = await admin.from('employees').select('id,role,access_level,is_active')
    .eq('is_active', true).or(`id.eq.${actor.id},auth_user_id.eq.${actor.id}`).maybeSingle();
  if (employee.error || !employee.data ||
    (employee.data.role !== 'admin' && employee.data.access_level !== 'admin')) {
    throw new SaldeoError('Automatyczna autoryzacja Saldeo jest dostępna tylko dla aktywnego administratora CRM.', 403);
  }
  // Company permissions run as the verified user, never with service-role auth.
  const user = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [manage, company, portal] = await Promise.all([
    user.rpc('finance_can_manage'),
    user.rpc('finance_company_visible', { p_company_id: companyId }),
    user.rpc('current_session_is_seller_portal'),
  ]);
  if (manage.error || company.error || portal.error || manage.data !== true ||
    company.data !== true || portal.data !== false) {
    throw new SaldeoError('Nie masz uprawnień do wysyłki dokumentów tej firmy.', 403);
  }
  return { admin, actor, supabaseUrl, serviceKey };
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new SaldeoError('Nieprawidłowy format żądania. Przygotuj pakiet ponownie.', 415);
  }
  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > MAX_REQUEST_BYTES)) {
    throw new SaldeoError('Pakiet przekracza dopuszczalny rozmiar wiadomości.', 413);
  }
  if (!request.body) throw new SaldeoError('Nie wskazano pakietu do wysłania.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new SaldeoError('Pakiet przekracza dopuszczalny rozmiar wiadomości.', 413);
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SaldeoError('Nieprawidłowy pakiet. Przygotuj go ponownie.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SaldeoError('Nieprawidłowy pakiet. Przygotuj go ponownie.');
  }
  return body as Record<string, unknown>;
}

function parseAttachments(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new SaldeoError('Wiadomość musi zawierać od 1 do 10 załączników.');
  }
  let totalBytes = 0;
  const attemptIds = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SaldeoError('Nieprawidłowy załącznik. Przygotuj pakiet ponownie.');
    }
    const { attemptId, filename, content, contentType, contentDisposition } = entry as Record<string, unknown>;
    const id = requiredUuid(attemptId, 'Załącznik nie ma potwierdzonej rezerwacji wysyłki.');
    if (attemptIds.has(id)) throw new SaldeoError('Powtórzona rezerwacja załącznika.');
    attemptIds.add(id);
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 255 ||
      /[\x00-\x1f\x7f/\\]/.test(filename) || typeof contentType !== 'string' ||
      contentType.length > 100 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(contentType) ||
      contentDisposition !== 'attachment' || typeof content !== 'string' || !content ||
      content.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
      throw new SaldeoError('Nieprawidłowy załącznik. Przygotuj pakiet ponownie.');
    }
    const decoded = Buffer.from(content, 'base64');
    if (!decoded.length || decoded.toString('base64') !== content) {
      throw new SaldeoError('Nieprawidłowa zawartość załącznika. Przygotuj pakiet ponownie.');
    }
    totalBytes += decoded.length;
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      throw new SaldeoError('Załączniki jednej wiadomości przekraczają 7 MB. Podziel pakiet.', 413);
    }
    return { attemptId: id, digest: createHash('sha256').update(decoded).digest('hex'),
      filename, content, contentType, contentDisposition: 'attachment' };
  });
}

async function assertSourceEligibility(admin: Admin, metadata: Metadata, companyId: string) {
  const sourceId = requiredUuid(metadata.source_id, 'Rezerwacja nie wskazuje dokumentu źródłowego.');
  const sourceType = metadata.source_type;
  if (sourceType !== 'external_invoice' && sourceType !== 'local_invoice') {
    throw new SaldeoError(saldeoDocumentExclusionReason(String(sourceType || ''), {})!, 409);
  }
  // Re-read source eligibility at the dispatch boundary: a reviewed document
  // may have reached KSeF or changed status since the control file was created.
  const source = await admin.from(SOURCE_TABLES[sourceType]).select('*')
    .eq('id', sourceId).eq('my_company_id', companyId).maybeSingle();
  if (source.error || !source.data) throw new SaldeoError('Nie można potwierdzić dokumentu w wybranej firmie.', 409);
  const exclusion = saldeoDocumentExclusionReason(sourceType, source.data);
  if (exclusion) throw new SaldeoError(exclusion, 409);
  const path = sourceType === 'external_invoice' ? source.data.file_url : source.data.pdf_url;
  if (typeof path !== 'string' || !path.trim()) {
    throw new SaldeoError('Dokument nie ma aktualnego pliku źródłowego. Uzupełnij go i przygotuj paczkę ponownie.', 409);
  }
  if (sourceType === 'local_invoice') {
    const linked = await admin.from('ksef_invoices').select('id,ksef_reference_number')
      .eq('my_company_id', companyId).eq('invoice_id', sourceId)
      .not('ksef_reference_number', 'is', null);
    if (linked.error) throw new SaldeoError('Nie można sprawdzić powiązania faktury z KSeF. Niczego nie wysłano.', 503);
    if ((linked.data || []).some((invoice) => invoice.ksef_reference_number?.trim())) {
      throw new SaldeoError('Faktura CRM ma już odpowiednik w KSeF. Nie wysłano jej ponownie do Saldeo; przygotuj aktualną paczkę.', 409);
    }
  }
}

function failure(error: unknown, deliveryStarted: boolean) {
  if (deliveryStarted) return json({ success: false, deliveryStarted: true,
    error: 'Nie można potwierdzić wyniku wysyłki do Saldeo. Nie ponawiaj jej automatycznie — sprawdź historię wysyłki i odbiór w Saldeo.' }, 502);
  return json({ success: false, deliveryStarted: false,
    error: error instanceof SaldeoError ? error.message : 'Nie udało się przygotować wysyłki do Saldeo. Niczego nie wysłano.' },
  error instanceof SaldeoError ? error.status : 503);
}

export async function GET(request: NextRequest) {
  try {
    const companyId = requiredUuid(request.nextUrl.searchParams.get('companyId'), 'Wybierz firmę przed sprawdzeniem konfiguracji Saldeo.');
    await authorize(request, companyId);
    return json({ success: true, configured: Boolean(serverPin()) });
  } catch (error) { return failure(error, false); }
}

export async function POST(request: NextRequest) {
  let deliveryStarted = false;
  try {
    const body = await readBody(request);
    const companyId = requiredUuid(body.companyId, 'Wybierz firmę przed wysyłką.');
    const { admin, actor, supabaseUrl, serviceKey } = await authorize(request, companyId);
    const pin = serverPin();
    if (!pin) throw new SaldeoError('Brak prawidłowego PIN_SALDEO w konfiguracji serwera. Wiadomość nie została wysłana.', 503);
    const emailAccountId = requiredUuid(body.emailAccountId, 'Wybierz skrzynkę nadawczą CRM.');
    const { periodMonth, periodYear, documentType, controlRevision } = body;
    if (typeof periodMonth !== 'number' || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12 ||
      typeof periodYear !== 'number' || !Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100 ||
      typeof documentType !== 'string' || !DOCUMENT_TYPES.has(documentType) ||
      typeof controlRevision !== 'string' || !SHA256.test(controlRevision)) {
      throw new SaldeoError('Brak prawidłowej kontroli pakietu, okresu lub rodzaju dokumentów.');
    }
    const attachments = parseAttachments(body.attachments);
    if (!Array.isArray(body.attemptIds) || body.attemptIds.length !== attachments.length) {
      throw new SaldeoError('Liczba rezerwacji nie odpowiada zatwierdzonym załącznikom.');
    }
    const attemptIds = body.attemptIds.map((id) => requiredUuid(id, 'Nieprawidłowa rezerwacja wysyłki.'));
    if (new Set(attemptIds).size !== attemptIds.length || attachments.some((file) => !attemptIds.includes(file.attemptId))) {
      throw new SaldeoError('Rezerwacje nie odpowiadają zatwierdzonym załącznikom.');
    }
    const [companyResult, accountResult, claimResult] = await Promise.all([
      admin.from('my_companies').select('saldeo_document_email').eq('id', companyId).maybeSingle(),
      admin.from('employee_email_accounts').select('id,email_address,is_active').eq('id', emailAccountId).eq('is_active', true).maybeSingle(),
      admin.from('accounting_delivery_attempts')
        .select('id,my_company_id,recipient,delivery_key,delivery_kind,status,sent_by,metadata')
        .in('id', attemptIds).eq('my_company_id', companyId).eq('sent_by', actor.id),
    ]);
    if (companyResult.error || accountResult.error || claimResult.error) {
      throw new SaldeoError('Nie udało się odczytać ustawień lub rezerwacji wysyłki. Niczego nie wysłano.', 503);
    }
    const recipient = companyResult.data?.saldeo_document_email?.trim();
    if (!recipient || recipient.length > 254 || !/^[^\s@<>,;]+@dok\.saldeo\.pl$/i.test(recipient) ||
      typeof body.recipient !== 'string' || body.recipient !== recipient) {
      throw new SaldeoError('Adres Saldeo różni się od ustawień firmy lub jest nieprawidłowy. Odśwież kontrolę pakietu.', 409);
    }
    const sender = accountResult.data?.email_address;
    if (!accountResult.data || typeof sender !== 'string' || sender.length > 254 ||
      !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(sender)) {
      throw new SaldeoError('Wybrana skrzynka nie jest aktywnym, poprawnie skonfigurowanym kontem CRM.', 409);
    }
    const claims = (claimResult.data || []) as Claim[];
    if (claims.length !== attachments.length) throw new SaldeoError('Brak własnych rezerwacji dla całego zatwierdzonego pakietu.', 409);
    for (const file of attachments) {
      const claim = claims.find((entry) => entry.id === file.attemptId);
      const metadata = claim?.metadata;
      if (!claim || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        claim.status !== 'sending' || claim.delivery_kind !== 'saldeo_document' ||
        claim.recipient !== recipient.toLowerCase() || metadata.reviewed !== true ||
        metadata.control_revision !== controlRevision || metadata.email_account_id !== emailAccountId ||
        metadata.period_month !== periodMonth || metadata.period_year !== periodYear ||
        metadata.saldeo_document_type !== documentType || metadata.content_sha256 !== file.digest ||
        metadata.filename !== file.filename || metadata.mime_type !== file.contentType ||
        metadata.server_dispatch_started_at != null ||
        claim.delivery_key !== `file:${metadata.source_type}:${metadata.source_id}`) {
        throw new SaldeoError('Pakiet nie odpowiada zatwierdzonemu plikowi kontrolnemu albo jego wysyłka została już rozpoczęta. Nie wysłano nowej wiadomości.', 409);
      }
      await assertSourceEligibility(admin, metadata, companyId);
    }

    // Existing claims are created only after the control file is approved.
    // Bind exact reviewed bytes to those immutable claims, then consume every
    // dispatch once. Partial reservation failures send nothing and stay held.
    const startedAt = new Date().toISOString();
    for (const claim of claims) {
      const reserved = await admin.from('accounting_delivery_attempts')
        .update({ metadata: { ...claim.metadata, server_dispatch_started_at: startedAt } })
        .eq('id', claim.id).eq('my_company_id', companyId).eq('sent_by', actor.id).eq('status', 'sending')
        .is('metadata->>server_dispatch_started_at', null).eq('metadata', JSON.stringify(claim.metadata)).select('id');
      if (reserved.error || reserved.data?.length !== 1) {
        throw new SaldeoError('Nie udało się zarezerwować całej paczki. Nie wysłano wiadomości; rezerwacje pozostają zatrzymane do sprawdzenia.', 409);
      }
    }

    // The PIN crosses only this server-to-server boundary. No PIN, subject,
    // upstream body or provider error is returned to the browser or logged.
    deliveryStarted = true;
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-email`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({ emailAccountId, to: recipient, subject: 'Dokumenty do Saldeo',
        body: '<p>Dokumenty przygotowane i zatwierdzone w CRM do przekazania do Saldeo. Informacje księgowe znajdują się w załącznikach.</p>',
        attachments: attachments.map(({ filename, content, contentType, contentDisposition }) => ({ filename, content, contentType, contentDisposition })),
        saldeoDelivery: { companyId, actorUserId: actor.id, periodMonth, periodYear, documentType, pin },
      }),
    });
    if (!response.ok) throw new Error('Unconfirmed delivery');
    const result = await response.json().catch(() => null);
    if (result?.success !== true || result?.error) throw new Error('Unconfirmed delivery');
    const safeId = (value: unknown) => typeof value === 'string' && value.length <= 300 &&
      !/[\r\n\x00]/.test(value) && !value.includes(pin) ? value : undefined;
    return json({ success: true, messageId: safeId(result.messageId), sentEmailId: safeId(result.sentEmailId) });
  } catch (error) { return failure(error, deliveryStarted); }
}
