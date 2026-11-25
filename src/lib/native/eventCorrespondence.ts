import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { sendingAccounts } from './offerActions';
import { emailPreviewDocument } from './messages';
import { composeEventEmail } from './eventDocumentEmail';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import {
  excludeEventEmail,
  linkEventEmail,
  linkEventEmailManually,
  loadEventCorrespondence,
  loadEventCorrespondenceSuggestions,
  loadEventMailRecipient,
  replyHeaders,
} from '@/lib/CRM/events/eventCorrespondence';

/*
 * Zakładka „Korespondencja” eventu dla Maca — te same dane i zasady co `EventCorrespondenceTab` w CRM
 * (`get_event_correspondence`: prywatność skrzynek jak w Wiadomościach, wiadomości systemowe o evencie dla osób z dokumentami
 * handlowymi). Odczyty: zakładka (wiadomości od najnowszej, zaplanowane, wykluczone, adresat „Napisz do klienta”),
 * `suggestions` (inne wiadomości z klientem), `search` (dołączanie po temacie), `composeSetup` (skrzynki osoby — pierwsza
 * własna). Czynności: `link`, `exclude`, `preview`; wysyłka `op=correspondenceEmail` (tokenem pracownika, wiadomość w wątku eventu).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(message);
}

const messageKind = (value: unknown): 'received' | 'sent' => {
  if (value === 'received' || value === 'sent') return value;
  fail('Nieprawidłowa wiadomość.');
};
const messageId = (value: unknown) => {
  const id = String(value || '');
  if (!UUID.test(id)) fail('Nieprawidłowa wiadomość.');
  return id;
};

async function correspondenceTab(ctx: NativeContext, eventId: string) {
  const [correspondence, recipient] = await Promise.all([
    loadEventCorrespondence(ctx.supabase, eventId),
    loadEventMailRecipient(ctx.supabase, eventId),
  ]);
  return { ...correspondence, recipient };
}

registerEventTab('correspondence', correspondenceTab);

/** „Inne wiadomości z klientem” — Mac pomija te, które już są w wątku (zna je z zakładki). */
async function suggestions(ctx: NativeContext, eventId: string) {
  return loadEventCorrespondenceSuggestions(ctx.supabase, eventId, []);
}

/** „Dołącz wiadomość lub konwersację”: wyszukiwanie po temacie w skrzynkach osoby (jak `EmailThreadPicker`). */
async function search(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const query = String(params.get('q') || '').trim().slice(0, 200);
  if (query.length < 3) return { messages: [] };
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const { data, error } = await ctx.supabase.from('inquiry_email_index')
    .select('id, type, subject, from_address, to_address, message_at')
    .ilike('subject', pattern)
    .order('message_at', { ascending: false })
    .limit(30);
  if (error) fail('Wyszukiwanie korespondencji jest chwilowo niedostępne. Spróbuj ponownie później.');
  return {
    messages: ((data || []) as Row[]).filter((row) => row.type === 'received' || row.type === 'sent').map((row) => ({
      key: `${row.type}:${row.id}`, type: row.type, id: String(row.id), subject: String(row.subject || ''),
      from: String(row.from_address || ''), to: String(row.to_address || ''), at: String(row.message_at || ''),
    })),
  };
}

/** Okno „Napisz do klienta” / „Odpowiedz”: skrzynki osoby (pierwsza — własna) i adresat eventu. */
async function composeSetup(ctx: NativeContext, eventId: string) {
  const [accounts, recipient] = await Promise.all([sendingAccounts(ctx), loadEventMailRecipient(ctx.supabase, eventId)]);
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    to: recipient.to,
    contact: recipient.name,
    subject: recipient.eventName,
  };
}

registerEventQueries('correspondence', { suggestions, search, composeSetup });

async function link(ctx: NativeContext, eventId: string, body: Row) {
  await linkEventEmailManually(ctx.supabase, eventId, messageKind(body.type), messageId(body.messageId), body.thread !== false);
  return { ok: true };
}

async function exclude(ctx: NativeContext, eventId: string, body: Row) {
  await excludeEventEmail(ctx.supabase, eventId, messageKind(body.type), messageId(body.messageId), body.exclude !== false);
  return { ok: true };
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** Cytat odpowiedzi jak `buildReplyQuoteHtml` w CRM (treść odebranej wiadomości z uprawnieniami osoby). */
async function replyQuote(ctx: NativeContext, replyId: unknown) {
  if (!replyId) return { html: '', headers: null as null | Awaited<ReturnType<typeof replyHeaders>> };
  const id = messageId(replyId);
  const { data, error } = await ctx.supabase.rpc('event_mail_message_json', { p_type: 'received', p_id: id });
  const message = (data || null) as Row | null;
  if (error || !message) fail('Nie masz dostępu do wiadomości, na którą odpowiadasz.');
  const date = new Date(String(message.message_at || '')).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' });
  const html = `
    <div style="margin:24px 0 0; padding:0; color:#4b5563; background:#ffffff; font-family:Arial,sans-serif; font-size:13px; line-height:1.5;">
      <div style="margin:0 0 8px; color:#4b5563;">Dnia ${escapeHtml(date)}, użytkownik ${escapeHtml(String(message.from_address || ''))} napisał:</div>
      <blockquote type="cite" style="margin:0; padding:0 0 0 14px; border-left:2px solid #729fcf; color:#1f2937; background:#ffffff;">
        ${escapeHtml(String(message.body || '')).replace(/\n/g, '<br>')}
      </blockquote>
    </div>`;
  return { html, headers: await replyHeaders(ctx.supabase, id) };
}

async function senderAccount(ctx: NativeContext, accountId: unknown) {
  const accounts = await sendingAccounts(ctx);
  if (!accounts.length) fail('Nie masz skonfigurowanych kont pocztowych');
  const account = accounts.find((item) => item.id === String(accountId || ''));
  if (!account) fail('Wybierz konto pocztowe nadawcy');
  return account;
}

async function preview(ctx: NativeContext, eventId: string, body: Row) {
  const account = await senderAccount(ctx, body.accountId);
  const [recipient, quote] = await Promise.all([loadEventMailRecipient(ctx.supabase, eventId), replyQuote(ctx, body.replyId)]);
  const html = await composeEventEmail(ctx, account.id, String(body.subject || ''), String(body.text || ''), body.replyId ? '' : recipient.name);
  return { html: emailPreviewDocument(`${html}${quote.html}`) };
}

registerEventActions('correspondence', { link, exclude, preview });

/**
 * „Wyślij” / „Zaplanuj” z zakładki „Korespondencja” (`op=correspondenceEmail`): nowa wiadomość do klienta albo odpowiedź
 * (In-Reply-To i References jak w Wiadomościach, cytat oryginału), treść ze stopką firmy, `send-email`, powiązanie z eventem.
 */
export async function sendCorrespondenceEmail(ctx: NativeContext, accessToken: string, eventId: string, body: Row) {
  if (!UUID.test(eventId)) fail('Nieprawidłowy event.');
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
  const [recipient, quote] = await Promise.all([loadEventMailRecipient(ctx.supabase, eventId), replyQuote(ctx, body.replyId)]);
  const html = await composeEventEmail(ctx, account.id, subject, message, body.replyId ? '' : recipient.name);
  const result = await dispatchCrmEmail({
    accessToken,
    functionName: 'send-email',
    scheduledAt,
    metadata: { eventId, actionUrl: `/crm/events/${eventId}?tab=correspondence` },
    payload: {
      emailAccountId: account.id,
      to,
      cc: String(body.cc || '').trim(),
      bcc: String(body.bcc || '').trim(),
      subject,
      body: `${html}${quote.html}`,
      attachments: [],
      inReplyTo: quote.headers?.inReplyTo,
      references: quote.headers?.references,
    },
  });
  await linkEventEmail(ctx.supabase, eventId, result);
  return { scheduled: result.scheduled, scheduledAt: result.scheduledAt ?? null, warning: result.warning ? String(result.warning) : null };
}
