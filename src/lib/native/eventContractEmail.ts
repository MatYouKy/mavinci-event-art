import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries } from './eventTabs';
import { sendingAccounts } from './offerActions';
import { emailPreviewDocument, plainTextToEmailHtml } from './messages';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import { dispatchCrmEmail } from '@/lib/emailScheduling';

/*
 * Wysyłka umowy wydarzenia e-mailem dla Maca — jak „Wyślij draft” / „Wyślij umowę” w zakładce „Umowa”
 * (`SendContractEmailModal`): skrzynki pracownika, adresat i nazwa klienta jak w umowie (osoba kontaktowa albo
 * organizacja), temat i treść zależne od tego, czy umowa jest szkicem, PDF umowy zawsze w załączniku oraz wybrane pliki
 * wydarzenia z oznaczeniem zaakceptowanej oferty i kalkulacji. Wiadomość ze stopką i szablonem firmy (cel „contract”),
 * wysyłka funkcją poczty tokenem pracownika (`send-email`, przy planowaniu — kolejka). Wysłana (nie zaplanowana)
 * umowa po wystawieniu dostaje status „Wysłana”.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

const DRAFT_TEXT = 'Dzień dobry,\n\nW załączeniu przesyłam wersję roboczą umowy na realizację wydarzenia.\n\n'
  + 'Proszę o zapoznanie się z treścią i przekazanie ewentualnych uwag. Dokument pozostaje na tym etapie draftem.\n\n'
  + 'W razie pytań proszę o kontakt.';
const FINAL_TEXT = 'Dzień dobry,\n\nW załączeniu przesyłam umowę na realizację wydarzenia.\n\n'
  + 'Proszę o zapoznanie się z treścią i odesłanie podpisanego egzemplarza.\n\nW razie pytań proszę o kontakt.';

function fail(message: string): never {
  throw new Error(message);
}

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Row | null | undefined;

/** Umowa, którą pracownik może wysłać (`canSendEmail`): nieanulowana; administrator albo osoba, która ją przygotowała. */
async function sendableContract(ctx: NativeContext, eventId: string, contractId: string) {
  if (!UUID.test(eventId) || !UUID.test(contractId)) fail('Nieprawidłowy identyfikator umowy.');
  const { data, error } = await ctx.supabase.from('contracts')
    .select('id, status, created_by, contract_number, generated_pdf_path')
    .eq('id', contractId).eq('event_id', eventId).maybeSingle();
  if (error || !data) fail('Nie znaleziono umowy');
  const contract = data as Row;
  if (contract.status === 'cancelled') fail('Anulowanej umowy nie można wysłać.');
  if (!(ctx.employee.isAdmin || contract.created_by === ctx.employee.id)) {
    fail('Umowę wysyła administrator albo osoba, która ją przygotowała.');
  }
  return contract;
}

/** Adresat jak w umowie (`setClientEmail` / `setClientName`): osoba kontaktowa, a bez niej organizacja. */
async function eventClient(ctx: NativeContext, eventId: string) {
  const { data } = await ctx.supabase.from('events')
    .select('organizations:organizations!events_organization_id_fkey(name, email), contacts:contact_person_id(full_name, email)')
    .eq('id', eventId).maybeSingle();
  const organization = one((data as Row | null)?.organizations);
  const contact = one((data as Row | null)?.contacts);
  return {
    email: String(contact?.email || organization?.email || ''),
    name: String(contact?.full_name || organization?.name || ''),
  };
}

async function senderAccount(ctx: NativeContext, accountId: unknown) {
  const accounts = await sendingAccounts(ctx);
  if (!accounts.length) fail('Nie masz skonfigurowanych kont pocztowych');
  const account = accounts.find((item) => item.id === String(accountId || ''));
  if (!account) fail('Wybierz konto pocztowe nadawcy');
  return account;
}

/** Treść jak `buildUnifiedEmailHtml` z celem „contract”: szablon i stopka firmy skrzynki nadawczej. */
async function composeContractEmail(ctx: NativeContext, accountId: string, subject: string, text: string, recipientName: string) {
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
    purpose: 'contract',
  } as any);
  return String(result.html || '');
}

/**
 * Okno „Wyślij draft umowy przez email” / „Wyślij umowę przez email”: skrzynki, adresat, temat i treść, stan PDF
 * oraz pliki wydarzenia (bez bieżącego PDF umowy) z oznaczeniem najnowszego PDF zaakceptowanej oferty i zaakceptowanej
 * kalkulacji (`fetchAvailableAttachments`).
 */
async function emailSetup(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const contract = await sendableContract(ctx, eventId, params.get('contractId') || '');
  const draft = contract.status === 'draft';
  const [accounts, client, filesRes, offersRes, calculationsRes] = await Promise.all([
    sendingAccounts(ctx),
    eventClient(ctx, eventId),
    ctx.supabase.from('event_files')
      .select('id, name, original_name, file_path, file_size, mime_type, created_at, document_type, offer_id')
      .eq('event_id', eventId).order('created_at', { ascending: false }),
    ctx.supabase.from('offers').select('id').eq('event_id', eventId).eq('status', 'accepted'),
    ctx.supabase.from('event_calculations').select('id, generated_pdf_path').eq('event_id', eventId).eq('is_accepted', true),
  ]);
  const acceptedOffers = new Set(((offersRes.data || []) as Row[]).map((offer) => String(offer.id)));
  const acceptedCalculations = new Set(((calculationsRes.data || []) as Row[]).map((calculation) => calculation.generated_pdf_path).filter(Boolean));
  const files = ((filesRes.data || []) as Row[]).filter((file) => Boolean(file.file_path) && file.file_path !== contract.generated_pdf_path);
  // Pliki od najnowszych — przy zaakceptowanej ofercie oznaczamy tylko jej aktualny PDF.
  const latestOfferFiles = new Set<string>();
  const matchedOffers = new Set<string>();
  ((filesRes.data || []) as Row[]).forEach((file) => {
    const offerId = file.offer_id ? String(file.offer_id) : '';
    if (file.document_type === 'offer' && offerId && acceptedOffers.has(offerId) && !matchedOffers.has(offerId)) {
      matchedOffers.add(offerId);
      latestOfferFiles.add(String(file.id));
    }
  });
  return {
    draft,
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    to: client.email,
    contact: client.name,
    subject: draft ? 'Draft umowy - Event' : 'Umowa - Event',
    text: draft ? DRAFT_TEXT : FINAL_TEXT,
    pdfReady: Boolean(contract.generated_pdf_path),
    files: files.map((file) => {
      const filename = String(file.original_name || file.name || String(file.file_path).split('/').pop() || 'Plik');
      const approval = file.document_type === 'calculation' && acceptedCalculations.has(file.file_path)
        ? 'Zaakceptowana kalkulacja'
        : file.document_type === 'offer' && latestOfferFiles.has(String(file.id)) ? 'Zaakceptowana oferta' : null;
      return {
        id: String(file.id),
        name: String(file.name || filename),
        size: file.file_size == null ? null : Number(file.file_size),
        createdAt: file.created_at ?? null,
        approval,
      };
    }),
    filesError: filesRes.error ? 'Nie udało się pobrać dostępnych plików wydarzenia' : null,
  };
}

registerEventQueries('contract', { emailSetup });

/** „Podgląd” wiadomości ze stopką i szablonem wybranej skrzynki (cel „contract”, nazwa klienta jak w umowie). */
async function emailPreview(ctx: NativeContext, eventId: string, body: Row) {
  await sendableContract(ctx, eventId, String(body.contractId || ''));
  const account = await senderAccount(ctx, body.accountId);
  const client = await eventClient(ctx, eventId);
  const html = await composeContractEmail(ctx, account.id, String(body.subject || ''), String(body.text || ''), client.name);
  return { html: emailPreviewDocument(html) };
}

registerEventActions('contract', { emailPreview });

async function download(ctx: NativeContext, path: string, message: string) {
  const { data, error } = await ctx.supabase.storage.from('event-files').download(path);
  if (error || !data) fail(message);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * „Wyślij email” / „Zaplanuj” (`handleSend`): PDF umowy i wybrane pliki wydarzenia w załącznikach, treść ze stopką firmy,
 * `send-email` z oznaczeniem umowy (szkic nie zmienia statusu). Wysłana od razu umowa (nie szkic) dostaje status
 * „Wysłana” i datę wysłania. Wymaga tokenu pracownika (funkcja poczty jak w przeglądarce).
 */
export async function sendContractEmail(ctx: NativeContext, accessToken: string, eventId: string, body: Row) {
  const contract = await sendableContract(ctx, eventId, String(body.contractId || ''));
  const draft = contract.status === 'draft';
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
  if (!contract.generated_pdf_path) fail('PDF umowy nie został jeszcze wygenerowany. Najpierw użyj przycisku "Generuj PDF".');
  const pdf = await download(ctx, contract.generated_pdf_path, 'Nie udało się pobrać PDF ze storage');
  const attachments = [{
    filename: String(contract.generated_pdf_path).split('/').pop() || `Umowa_${contract.contract_number || contract.id}.pdf`,
    content: pdf.toString('base64'),
    contentType: 'application/pdf',
    contentDisposition: 'attachment',
  }];
  let total = pdf.length;
  const ids = (Array.isArray(body.fileIds) ? body.fileIds : []).map(String).filter((id: string) => UUID.test(id)).slice(0, 20);
  if (ids.length) {
    const { data, error } = await ctx.supabase.from('event_files').select('id, name, original_name, file_path, mime_type')
      .eq('event_id', eventId).in('id', ids);
    if (error) fail('Nie udało się pobrać plików wydarzenia');
    for (const file of ((data || []) as Row[]).filter((row) => row.file_path && row.file_path !== contract.generated_pdf_path)) {
      const displayName = String(file.name || file.original_name || 'Plik');
      const content = await download(ctx, file.file_path, `Nie udało się pobrać pliku: ${displayName}`);
      total += content.length;
      if (total > MAX_ATTACHMENTS_BYTES) fail('Załączniki przekraczają 25 MB. Wybierz mniej plików wydarzenia.');
      attachments.push({
        filename: String(file.original_name || file.name || String(file.file_path).split('/').pop() || 'Plik'),
        content: content.toString('base64'),
        contentType: String(file.mime_type || 'application/octet-stream'),
        contentDisposition: 'attachment',
      });
    }
  }
  const client = await eventClient(ctx, eventId);
  const html = await composeContractEmail(ctx, account.id, subject, message, client.name);
  const result = await dispatchCrmEmail({
    accessToken,
    functionName: 'send-email',
    scheduledAt,
    metadata: {
      entityType: 'contract',
      entityId: contract.id,
      eventId,
      markEntitySent: !draft,
      draft,
      actionUrl: `/crm/events/${eventId}?tab=contract`,
    },
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
  if (!draft && !result.scheduled) {
    const { error } = await ctx.supabase.from('contracts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', contract.id);
    if (error) console.error('[native-contract-email] status', error);
  }
  return { draft, scheduled: result.scheduled, scheduledAt: result.scheduledAt ?? null };
}
