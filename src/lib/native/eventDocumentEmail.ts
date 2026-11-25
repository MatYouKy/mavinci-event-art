import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries } from './eventTabs';
import { sendingAccounts } from './offerActions';
import { emailPreviewDocument, plainTextToEmailHtml } from './messages';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import { linkEventEmail } from '@/lib/CRM/events/eventCorrespondence';
import {
  EVENT_DOCUMENT_ATTACHMENTS_LIMIT,
  EVENT_DOCUMENT_EMAIL,
  isEventDocumentKind,
  loadEventDocumentEmailContext,
  type EventDocumentKind,
} from '@/lib/CRM/events/eventDocumentEmail';

/*
 * Agenda i Karta Weselna e-mailem dla Maca — jak `SendEventDocumentEmailModal` w CRM (dane okna:
 * `loadEventDocumentEmailContext`): skrzynki osoby (pierwsza — własna), adresat z eventu, temat i treść, PDF dokumentu zawsze
 * w załączniku i wybrane pliki eventu, stopka i szablon firmy skrzynki (cel „general”), wysyłka funkcją poczty tokenem
 * pracownika (`send-email`, przy planowaniu — kolejka). Wysyła osoba zarządzająca eventem (jak „Generuj PDF”). Wiadomość
 * trafia do korespondencji eventu (`linkEventEmail`).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(message);
}

async function assertCanSend(ctx: NativeContext, eventId: string) {
  if (!UUID.test(eventId)) fail('Nieprawidłowy event.');
  const { data, error } = await ctx.supabase.rpc('current_employee_can_manage_event', { p_event_id: eventId });
  const allowed = !error && typeof data === 'boolean'
    ? data
    : ctx.employee.permissions.includes('events_manage') || ctx.employee.permissions.includes('admin');
  if (!allowed) fail('Dokument do klienta wysyła osoba zarządzająca eventem.');
}

async function senderAccount(ctx: NativeContext, accountId: unknown) {
  const accounts = await sendingAccounts(ctx);
  if (!accounts.length) fail('Nie masz skonfigurowanych kont pocztowych');
  const account = accounts.find((item) => item.id === String(accountId || ''));
  if (!account) fail('Wybierz konto pocztowe nadawcy');
  return account;
}

/**
 * Treść jak `buildUnifiedEmailHtml` z celem „general”: szablon i stopka firmy skrzynki nadawczej (także wiadomości
 * z zakładki „Korespondencja” — `src/lib/native/eventCorrespondence.ts`).
 */
export async function composeEventEmail(ctx: NativeContext, accountId: string, subject: string, text: string, recipientName: string) {
  const signature = await buildCompanySignatureHtml({ client: ctx.supabase, employeeId: ctx.employee.id, emailAccountId: accountId } as any);
  const result = await buildCompanyEmailBody({
    client: ctx.supabase,
    employeeId: ctx.employee.id,
    emailAccountId: accountId,
    content: plainTextToEmailHtml(text),
    contentIsHtml: true,
    subject,
    recipientName,
    signatureHtml: signature.html,
    purpose: 'general',
  } as any);
  return String(result.html || '');
}

/** Okno „Wyślij agendę e-mailem” / „Wyślij Kartę Weselną e-mailem”: skrzynki, adresat, temat i treść, PDF i pliki eventu. */
async function emailSetup(ctx: NativeContext, eventId: string, kind: EventDocumentKind) {
  await assertCanSend(ctx, eventId);
  const texts = EVENT_DOCUMENT_EMAIL[kind];
  const [accounts, context] = await Promise.all([sendingAccounts(ctx), loadEventDocumentEmailContext(ctx.supabase, eventId, kind)]);
  return {
    document: kind,
    title: texts.title,
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    to: context.to,
    contact: context.recipientName,
    subject: texts.subject(context.eventName),
    text: texts.text,
    pdfReady: Boolean(context.document),
    pdfName: context.document?.filename ?? null,
    attachmentNote: context.document ? texts.attachment : context.missing || texts.missing,
    staleNote: context.stale && texts.stale ? texts.stale : null,
    files: context.files.map((file) => ({ id: file.id, name: file.name, size: file.size, createdAt: file.createdAt })),
    filesError: context.filesError,
  };
}

registerEventQueries('agenda', { emailSetup: (ctx, eventId) => emailSetup(ctx, eventId, 'agenda') });
registerEventQueries('wedding', { emailSetup: (ctx, eventId) => emailSetup(ctx, eventId, 'wedding-card') });

/** „Podgląd” wiadomości ze stopką i szablonem wybranej skrzynki. */
async function emailPreview(ctx: NativeContext, eventId: string, kind: EventDocumentKind, body: Row) {
  await assertCanSend(ctx, eventId);
  const account = await senderAccount(ctx, body.accountId);
  const context = await loadEventDocumentEmailContext(ctx.supabase, eventId, kind);
  const html = await composeEventEmail(ctx, account.id, String(body.subject || ''), String(body.text || ''), context.recipientName);
  return { html: emailPreviewDocument(html) };
}

registerEventActions('agenda', { emailPreview: (ctx, eventId, body) => emailPreview(ctx, eventId, 'agenda', body) });
registerEventActions('wedding', { emailPreview: (ctx, eventId, body) => emailPreview(ctx, eventId, 'wedding-card', body) });

async function download(ctx: NativeContext, path: string, message: string) {
  const { data, error } = await ctx.supabase.storage.from('event-files').download(path);
  if (error || !data) fail(message);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * „Wyślij” / „Zaplanuj wysyłkę” (`op=documentEmail`): PDF dokumentu i wybrane pliki eventu w załącznikach, treść ze stopką
 * firmy, `send-email` (przy planowaniu — kolejka), powiązanie z korespondencją eventu. Wymaga tokenu pracownika.
 */
export async function sendEventDocumentEmail(ctx: NativeContext, accessToken: string, eventId: string, body: Row) {
  const kind = body.document;
  if (!isEventDocumentKind(kind)) fail('Nieznany dokument.');
  await assertCanSend(ctx, eventId);
  const texts = EVENT_DOCUMENT_EMAIL[kind];
  const to = String(body.to || '').trim();
  const subject = String(body.subject || '').trim();
  const message = String(body.text || '');
  if (!to) fail('Wprowadź adres email odbiorcy');
  if (!subject) fail('Wprowadź temat wiadomości');
  if (!message.trim()) fail('Wprowadź treść wiadomości');
  const account = await senderAccount(ctx, body.accountId);
  let scheduledAt: string | null = null;
  if (body.scheduledAt) {
    const date = new Date(String(body.scheduledAt));
    if (Number.isNaN(date.getTime())) fail('Podaj prawidłową datę i godzinę wysyłki');
    if (date.getTime() < Date.now() + 30_000) fail('Termin wysyłki musi przypadać w przyszłości');
    scheduledAt = date.toISOString();
  }
  const context = await loadEventDocumentEmailContext(ctx.supabase, eventId, kind);
  if (!context.document) fail(context.missing || texts.missing);
  const pdf = await download(ctx, context.document.path, 'Nie udało się pobrać PDF ze storage');
  const attachments = [{
    filename: context.document.filename || texts.fallbackName,
    content: pdf.toString('base64'),
    contentType: 'application/pdf',
    contentDisposition: 'attachment',
  }];
  let total = pdf.length;
  const ids = new Set((Array.isArray(body.fileIds) ? body.fileIds : []).map(String).filter((id: string) => UUID.test(id)).slice(0, 20));
  for (const file of context.files.filter((item) => ids.has(item.id))) {
    const content = await download(ctx, file.path, `Nie udało się pobrać pliku: ${file.name}`);
    total += content.length;
    if (total > EVENT_DOCUMENT_ATTACHMENTS_LIMIT) fail('Załączniki przekraczają 25 MB. Wybierz mniej plików eventu.');
    attachments.push({
      filename: file.filename,
      content: content.toString('base64'),
      contentType: file.mimeType || 'application/octet-stream',
      contentDisposition: 'attachment',
    });
  }
  const html = await composeEventEmail(ctx, account.id, subject, message, context.recipientName);
  const result = await dispatchCrmEmail({
    accessToken,
    functionName: 'send-email',
    scheduledAt,
    metadata: { eventId, actionUrl: `/crm/events/${eventId}?tab=${texts.tab}` },
    payload: {
      emailAccountId: account.id,
      to,
      subject,
      body: html,
      attachments,
      cc: String(body.cc || '').trim(),
      bcc: String(body.bcc || '').trim(),
    },
  });
  await linkEventEmail(ctx.supabase, eventId, result);
  return {
    scheduled: result.scheduled,
    scheduledAt: result.scheduledAt ?? null,
    sentText: texts.sent,
    scheduledText: texts.scheduled,
    warning: result.warning ? String(result.warning) : null,
  };
}
