import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const FIELDS = 'id,filename,content_type,size_bytes,storage_path';
const MARKER = '__mavinci_attachment_sync_v1';
const MAX_BYTES = 32 * 1024 * 1024;
const inFlight = new Map<string, Promise<void>>();
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Email = { id: string; email_account_id: string; message_id: string; raw_headers: any; imap_uid?: number; imap_uidvalidity?: string; imap_mailbox?: string };
type Attachment = { id: string; filename: string; content_type: string; size_bytes: number; storage_path: string };
type RelayAttachment = { part: string; filename: string; contentType: string; sizeBytes: number; content: string };
class ImportError extends Error {}
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const identity = (email: Email) => digest(JSON.stringify([email.email_account_id, email.message_id]));

async function listAttachments(admin: Admin, id: string): Promise<Attachment[]> {
  const { data, error } = await admin.from('email_attachments').select(FIELDS)
    .eq('email_id', id).eq('email_type', 'received').order('created_at');
  if (error) throw new ImportError('Nie udało się odczytać listy załączników. Spróbuj ponownie.');
  return data || [];
}

function isComplete(email: Email, attachments: Attachment[]) {
  const marker = email.raw_headers?.[MARKER];
  return marker?.identity === identity(email) && Array.isArray(marker.attachmentIds) &&
    marker.attachmentIds.every((id: string) => attachments.some((file) => file.id === id));
}

async function synchronize(admin: Admin, email: Email, existing: Attachment[]) {
  const relayUrl = process.env.IMAP_ATTACHMENT_RELAY_URL || process.env.SMTP_RELAY_URL;
  const secret = process.env.IMAP_ATTACHMENT_RELAY_SECRET || process.env.SMTP_RELAY_SECRET;
  if (!relayUrl || !secret) throw new ImportError('Pobieranie załączników nie jest skonfigurowane na serwerze.');
  const { data: account, error: accountError } = await admin.from('employee_email_accounts')
    .select('imap_host,imap_port,imap_username,imap_password,imap_use_ssl,is_active')
    .eq('id', email.email_account_id).single();
  if (accountError || !account?.is_active || !account.imap_host || !account.imap_username || !account.imap_password) {
    throw new ImportError('Skrzynka nie ma aktywnej konfiguracji odbierania poczty.');
  }
  let response: Response;
  try {
    response = await fetch(`${relayUrl.replace(/\/$/, '')}/api/imap/attachments`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(50000),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imapConfig: { host: account.imap_host, port: account.imap_port, username: account.imap_username, password: account.imap_password, secure: account.imap_use_ssl },
        message: { messageId: email.message_id, imapUid: email.imap_uid, imapUidValidity: email.imap_uidvalidity },
        mailbox: email.imap_mailbox || 'INBOX',
      }),
    });
  } catch {
    throw new ImportError('Serwer poczty nie odpowiedział. Spróbuj ponownie.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    const errors: Record<string, string> = {
      MESSAGE_NOT_FOUND: 'Nie znaleziono wiadomości w jej folderze na serwerze pocztowym. Mogła zostać przeniesiona lub usunięta.',
      ATTACHMENTS_TOO_LARGE: 'Załączniki przekraczają łączny limit pobierania 32 MB.',
      TOO_MANY_ATTACHMENTS: 'Wiadomość zawiera więcej niż 100 załączników.',
      BUSY: 'Serwer pobiera załączniki innych wiadomości. Spróbuj za chwilę.',
      TIMEOUT: 'Serwer poczty nie odpowiedział na czas. Spróbuj ponownie.',
    };
    throw new ImportError(errors[result?.code] || 'Nie udało się pobrać załączników z serwera poczty. Spróbuj ponownie.');
  }
  if (!Array.isArray(result.attachments) || result.attachments.length > 100) throw new ImportError('Serwer zwrócił nieprawidłową listę załączników.');
  const bucket = admin.storage.from('email-attachments');
  const usedIds = new Set<string>();
  const attachmentIds: string[] = [];
  let totalBytes = 0;
  for (const file of result.attachments as RelayAttachment[]) {
    if (typeof file.part !== 'string' || !/^\d+(\.\d+)*$/.test(file.part) ||
        typeof file.content !== 'string' || typeof file.filename !== 'string' ||
        !file.filename || typeof file.contentType !== 'string') throw new ImportError('Serwer zwrócił nieprawidłowy załącznik.');
    const bytes = Buffer.from(file.content, 'base64');
    totalBytes += bytes.length;
    if (bytes.length !== file.sizeBytes || totalBytes > MAX_BYTES) throw new ImportError('Nie udało się pobrać pełnej zawartości załączników.');
    const hash = digest(bytes);
    // Match old imports by content as well as name/size; equal filenames alone are not unique.
    let matching: Attachment | undefined;
    for (const candidate of existing.filter((entry) => !usedIds.has(entry.id) && entry.filename === file.filename && entry.size_bytes === bytes.length)) {
      const stored = await bucket.download(candidate.storage_path);
      if (!stored.error && stored.data && digest(Buffer.from(await stored.data.arrayBuffer())) === hash) {
        matching = candidate;
        break;
      }
    }
    if (matching) {
      usedIds.add(matching.id);
      attachmentIds.push(matching.id);
      continue;
    }
    // Stable primary keys make retries and concurrent app processes idempotent without a migration.
    const hex = digest(`received-attachment-v1:${email.id}:${file.part}:${hash}`);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const path = `received/${email.id}/${id}`;
    const uploaded = await bucket.upload(path, bytes, { contentType: file.contentType, upsert: true });
    if (uploaded.error) throw new ImportError('Nie udało się zapisać pliku. Spróbuj ponownie.');
    const saved = await admin.from('email_attachments').upsert({
      id, email_id: email.id, email_type: 'received', filename: file.filename,
      content_type: file.contentType, size_bytes: bytes.length, storage_path: path,
    }, { onConflict: 'id' });
    if (saved.error) throw new ImportError('Nie udało się zapisać listy załączników. Spróbuj ponownie.');
    attachmentIds.push(id);
  }
  // Store completion only after every file is saved, including messages without attachments.
  // Compare-and-set preserves headers changed by another synchronizer in the meantime.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await admin.from('received_emails').select('raw_headers').eq('id', email.id).single();
    if (current.error) throw new ImportError('Nie udało się zapisać stanu pobrania załączników.');
    const raw = current.data.raw_headers;
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new ImportError('Nagłówki wiadomości mają nieprawidłowy format.');
    let update = admin.from('received_emails').update({
      has_attachments: attachmentIds.length > 0 || existing.length > 0,
      raw_headers: { ...(raw || {}), [MARKER]: { identity: identity(email), attachmentIds, checkedAt: new Date().toISOString() } },
    }).eq('id', email.id);
    update = raw === null ? update.is('raw_headers', null) : update.eq('raw_headers', JSON.stringify(raw));
    const saved = await update.select('id').maybeSingle();
    if (saved.error) throw new ImportError('Nie udało się zapisać stanu pobrania załączników.');
    if (saved.data) return;
  }
  throw new ImportError('Wiadomość jest aktualizowana. Spróbuj ponownie.');
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== request.headers.get('host')) return json({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    const input = await request.json().catch(() => null);
    if (typeof input?.messageId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.messageId)) return json({ error: 'Nieprawidłowa wiadomość.' }, 400);
    const userClient = createSupabaseServerClient(cookies());
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Zaloguj się ponownie, aby pobrać załączniki.' }, 401);
    // Authorize with the user's RLS before reading credentials or using the admin client.
    const authorized = await userClient.from('received_emails').select('*').eq('id', input.messageId).maybeSingle();
    if (authorized.error) return json({ error: 'Nie udało się sprawdzić dostępu do wiadomości.' }, 503);
    if (!authorized.data) return json({ error: 'Brak dostępu do wiadomości.' }, 403);
    const email = authorized.data as Email;
    const admin = createSupabaseAdminClient();
    const existing = await listAttachments(admin, email.id);
    if (isComplete(email, existing)) return json({ attachments: existing });
    try {
      let pending = inFlight.get(email.id);
      if (!pending) {
        pending = synchronize(admin, email, existing).finally(() => { inFlight.delete(email.id); });
        inFlight.set(email.id, pending);
      }
      await pending;
      return json({ attachments: await listAttachments(admin, email.id) });
    } catch (error) {
      // Keep already saved files usable when IMAP or a later upload fails.
      return json({ attachments: await listAttachments(admin, email.id), syncError: error instanceof ImportError ? error.message : 'Nie udało się pobrać załączników. Spróbuj ponownie.' });
    }
  } catch (error) {
    return json({ error: error instanceof ImportError ? error.message : 'Nie udało się odczytać załączników. Spróbuj ponownie.' }, 503);
  }
}
