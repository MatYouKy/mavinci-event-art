import 'server-only';
import type { NativeContext } from './auth';
import { fail, offerDetail } from './offers';
import { emailPreviewDocument, plainTextToEmailHtml } from './messages';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import { inquiryTitleLabel } from '@/lib/ui/systemLabels';
import { venueOutdatedOffers } from '@/lib/CRM/Offers/offerVenueBackground';

/*
 * Oferty na Macu, część D2 — czynności z karty „Akcje” jak w CRM: wysyłka oferty e-mailem (`SendOfferEmailModal`: skrzynka
 * pracownika, adresaci, treść ze stopką firmy, „Redaguj AI”, wysyłka teraz albo zaplanowana, aktualny PDF w załączniku),
 * powiązanie z wydarzeniem lub zapytaniem (`OfferLinkModal`, `link_offer_context`), aktualizacja zaakceptowanej oferty
 * (`OfferDraftRevisionActions`) i utworzenie wydarzenia z zaakceptowanego zapytania (`ConvertInquiryModal`).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message = 'Nieprawidłowa oferta.') => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));

/** Oferta, którą pracownik może obsługiwać (`sales_can_manage_offer`), poza ofertami z portalu sprzedawcy. */
async function managed(ctx: NativeContext, id: string) {
  const [{ data: allowed, error: permissionError }, { data, error }] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id }),
    ctx.supabase.from('offers').select('id, offer_number, title, status, sales_channel, generated_pdf_url, modified_after_generation, content_revision, inquiry_id, event_id, event_date, event_location, event:events!event_id(event_date)')
      .eq('id', id).maybeSingle(),
  ]);
  if (error || !data) fail('Nie znaleziono oferty.');
  if (permissionError || allowed !== true) fail('Nie masz uprawnień do tej oferty.');
  const offer = data as Row;
  if (offer.sales_channel === 'seller_portal') fail('Ofertę z portalu sprzedawcy obsługujesz w obsłudze oferty sprzedawcy.');
  return offer;
}

// MARK: Wysyłka e-mailem

type Account = { id: string; email_address: string; from_name?: string | null; account_type?: string | null; is_default?: boolean | null };

/** Skrzynki do wysyłki jak w `SendOfferEmailModal`: osobiste (bez systemowych) i przypisane z prawem wysyłania (też broszury). */
export async function sendingAccounts(ctx: NativeContext): Promise<Account[]> {
  const employeeId = ctx.employee.id;
  const [personal, assignments] = await Promise.all([
    ctx.supabase.from('employee_email_accounts').select('id, email_address, from_name, account_type, is_default')
      .eq('employee_id', employeeId).eq('is_active', true).or('account_type.is.null,account_type.neq.system'),
    ctx.supabase.from('employee_email_account_assignments').select('email_account_id').eq('employee_id', employeeId).eq('can_send', true),
  ]);
  if (personal.error || assignments.error) fail('Nie udało się pobrać skrzynek pracownika');
  const assignedIds = ((assignments.data || []) as Row[]).map((row) => row.email_account_id).filter(Boolean);
  let assigned: Account[] = [];
  if (assignedIds.length) {
    const { data, error } = await ctx.supabase.from('employee_email_accounts').select('id, email_address, from_name, account_type, is_default')
      .in('id', assignedIds).eq('is_active', true).or('account_type.is.null,account_type.neq.system');
    if (error) fail('Nie udało się pobrać skrzynek pracownika');
    assigned = (data || []) as Account[];
  }
  return Array.from(new Map([...((personal.data || []) as Account[]), ...assigned].map((account) => [account.id, account])).values())
    .sort((a, b) => {
      if (Boolean(a.is_default) !== Boolean(b.is_default)) return a.is_default ? -1 : 1;
      const aPersonal = (a.account_type || 'personal') === 'personal';
      const bPersonal = (b.account_type || 'personal') === 'personal';
      if (aPersonal !== bPersonal) return aPersonal ? -1 : 1;
      return a.email_address.localeCompare(b.email_address, 'pl');
    });
}

/** Dane okna „Wyślij ofertę przez email”: skrzynki, adresat (klient oferty), domyślny temat i treść, stan PDF. */
export async function offerEmailSetup(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const offer = await managed(ctx, key);
  const [accounts, detail] = await Promise.all([sendingAccounts(ctx), offerDetail(ctx, key)]);
  const number = text(offer.offer_number);
  return {
    number,
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    to: text(detail.client?.email),
    recipientName: text(detail.client?.name),
    subject: `Oferta ${number}`,
    text: `Dzień dobry,\n\nW załączeniu przesyłam ofertę ${number}.\n\nW razie pytań proszę o kontakt.`,
    // Także PDF sprzed zmiany „Tła ofert” miejsca oferty (`detail.pdf.stale`) wymaga ponownego wygenerowania.
    pdfReady: Boolean(offer.generated_pdf_url) && offer.modified_after_generation !== true && detail.pdf.stale !== true,
  };
}

/**
 * Treść wysyłki jak `buildUnifiedEmailContent` z celem „offer”: szablon i stopka firmy skrzynki nadawczej. Tak samo
 * wysyła się kalkulację (`SendCalculationEmailModal`, `src/lib/native/eventCalculations.ts`).
 */
export async function composeOfferEmail(ctx: NativeContext, accountId: string, subject: string, body: string, recipientName: string) {
  const signature = await buildCompanySignatureHtml({ client: ctx.supabase, employeeId: ctx.employee.id, emailAccountId: accountId });
  const result = await buildCompanyEmailBody({
    client: ctx.supabase,
    employeeId: ctx.employee.id,
    emailAccountId: accountId,
    content: plainTextToEmailHtml(body),
    contentIsHtml: true,
    subject,
    recipientName,
    signatureHtml: signature.html,
    purpose: 'offer',
  } as any);
  return { html: result.html, signatureHtml: (result as Row).signatureHtml || signature.html };
}

async function allowedAccount(ctx: NativeContext, accountId: unknown) {
  const accounts = await sendingAccounts(ctx);
  const account = accounts.find((item) => item.id === text(accountId));
  if (!account) fail('Wybierz skrzynkę pracownika, z której ma zostać wysłana oferta');
  return account;
}

export async function offerEmailPreview(ctx: NativeContext, body: Row) {
  await managed(ctx, uuid(body.id));
  const account = await allowedAccount(ctx, body.accountId);
  const email = await composeOfferEmail(ctx, account.id, text(body.subject), text(body.text), text(body.recipientName));
  return { html: emailPreviewDocument(email.html) };
}

/** „Redaguj AI” (`assist-inquiry`, `edit_offer_email`): propozycja treści do przejrzenia przed użyciem. */
export async function redactOfferEmail(ctx: NativeContext, body: Row) {
  await managed(ctx, uuid(body.id));
  const draft = text(body.text).trim();
  const instructions = text(body.instructions).trim().slice(0, 2000);
  if (!draft || !instructions) fail('Wpisz wiadomość oraz polecenie dla AI.');
  const { data, error } = await ctx.supabase.functions.invoke('assist-inquiry', {
    body: { action: 'edit_offer_email', subject: text(body.subject), draft, additionalInstructions: instructions },
  });
  let message = (data as Row | null)?.error as string | undefined;
  if (error && !message) {
    try { message = (await (error as any).context?.json())?.error; } catch { /* komunikat zastępczy */ }
  }
  if (error || message) fail(message || 'Nie udało się zredagować wiadomości.');
  const result = text((data as Row | null)?.result?.body).trim();
  if (!result) fail('AI nie zwróciło treści wiadomości.');
  return { text: result };
}

/** „Wyślij ofertę” / „Zaplanuj ofertę” (`send-offer-email`, przy planowaniu `schedule-email`) z aktualnym PDF w załączniku. */
export async function sendOfferEmail(ctx: NativeContext, body: Row, accessToken: string) {
  const id = uuid(body.id);
  await managed(ctx, id);
  const to = text(body.to).trim();
  const subject = text(body.subject).trim();
  const message = text(body.text);
  if (!to) fail('Wprowadź adres email odbiorcy');
  if (!subject) fail('Wprowadź temat wiadomości');
  if (!message.trim()) fail('Wprowadź treść wiadomości');
  const account = await allowedAccount(ctx, body.accountId);
  let scheduledAt: string | null = null;
  if (body.scheduledAt) {
    const date = new Date(text(body.scheduledAt));
    if (Number.isNaN(date.getTime())) fail('Podaj prawidłową datę i godzinę wysyłki');
    if (date.getTime() < Date.now() + 30_000) fail('Termin wysyłki musi przypadać w przyszłości');
    scheduledAt = date.toISOString();
  }
  const recipientName = text(body.recipientName);
  const email = await composeOfferEmail(ctx, account.id, subject, message, recipientName);
  const { data: document, error } = await ctx.supabase.from('offers').select('generated_pdf_url, modified_after_generation').eq('id', id).single();
  if (error) fail(error.message || 'Nie udało się sprawdzić PDF oferty.');
  if (!(document as Row).generated_pdf_url || (document as Row).modified_after_generation) fail('Wygeneruj aktualny PDF oferty przed wysyłką.');
  // PDF sprzed zmiany „Tła ofert” miejsca oferty — okładka nieaktualna.
  if ((await venueOutdatedOffers(ctx.supabase, [id])).size) fail('Wygeneruj aktualny PDF oferty przed wysyłką.');
  const result = await dispatchCrmEmail({
    accessToken,
    functionName: 'send-offer-email',
    scheduledAt,
    metadata: { entityType: 'offer', entityId: id, markEntitySent: true, actionUrl: `/crm/offers/${id}` },
    payload: {
      offerId: id,
      documentPath: (document as Row).generated_pdf_url,
      emailAccountId: account.id,
      to,
      cc: text(body.cc),
      bcc: text(body.bcc),
      subject,
      message,
      messageHtml: email.html,
      signatureHtml: email.signatureHtml,
      recipientName,
    },
  });
  return {
    scheduled: result.scheduled,
    scheduledAt: result.scheduledAt ?? null,
    warning: result.warning ? text(result.warning) : null,
    offer: await offerDetail(ctx, id),
  };
}

// MARK: Powiązanie z wydarzeniem lub zapytaniem

/** Kontakt i firma wyników listy — dwa zbiorcze odczyty jak `loadContactDetails`. */
async function withContacts(ctx: NativeContext, rows: Row[]) {
  const contactIds = Array.from(new Set(rows.map((row) => row.contactId).filter(Boolean)));
  const organizationIds = Array.from(new Set(rows.map((row) => row.organizationId).filter(Boolean)));
  const [contacts, organizations] = await Promise.all([
    contactIds.length ? ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email').in('id', contactIds) : Promise.resolve({ data: [], error: null }),
    organizationIds.length ? ctx.supabase.from('organizations').select('id, name, email').in('id', organizationIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error || organizations.error) fail('Nie udało się wczytać listy.');
  const contactMap = new Map(((contacts.data || []) as Row[]).map((row) => [row.id, row]));
  const organizationMap = new Map(((organizations.data || []) as Row[]).map((row) => [row.id, row]));
  return rows.map((row) => {
    const contact = row.contactId ? contactMap.get(row.contactId) : undefined;
    const organization = row.organizationId ? organizationMap.get(row.organizationId) : undefined;
    return {
      id: row.id,
      label: text(row.label),
      date: row.date || null,
      company: text(organization?.name).trim() || text(row.company),
      contact: text(contact?.full_name).trim() || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim() || text(row.contact),
      email: text(contact?.email).trim() || text(row.email) || text(organization?.email).trim(),
    };
  });
}

/** Lista do powiązania (do 30 wyników): wydarzenia albo moje otwarte zapytania, z wyszukiwaniem po nazwie. */
export async function offerLinkChoices(ctx: NativeContext, id: string, kind: string, search: string) {
  await managed(ctx, uuid(id));
  const term = search.trim().replace(/[%_]/g, '').slice(0, 100);
  if (kind === 'event') {
    let query = ctx.supabase.from('events').select('id, name, event_date, contact_person_id, organization_id').order('event_date', { ascending: false }).limit(30);
    if (term) query = query.ilike('name', `%${term}%`);
    const { data, error } = await query;
    if (error) fail(error.message || 'Nie udało się wczytać listy.');
    return { choices: await withContacts(ctx, ((data || []) as Row[]).map((row) => ({
      id: row.id, label: row.name, date: row.event_date, contactId: row.contact_person_id, organizationId: row.organization_id,
    }))) };
  }
  const { data: employeeId, error: employeeError } = await ctx.supabase.rpc('sales_employee_id');
  if (employeeError) fail(employeeError.message || 'Nie udało się wczytać listy.');
  if (!employeeId) fail('Nie znaleziono konta pracownika.');
  let query = ctx.supabase.from('tasks').select('id, title, contact_id, organization_id, inquiry_details').eq('is_inquiry', true)
    .eq('inquiry_owner_id', employeeId).is('archived_at', null).order('created_at', { ascending: false }).limit(30);
  if (term) query = query.ilike('title', `%${term}%`);
  const { data, error } = await query;
  if (error) fail(error.message || 'Nie udało się wczytać listy.');
  return { choices: await withContacts(ctx, ((data || []) as Row[]).map((row) => {
    const details = row.inquiry_details && typeof row.inquiry_details === 'object' && !Array.isArray(row.inquiry_details) ? row.inquiry_details as Row : {};
    return {
      id: row.id, label: row.title, contactId: row.contact_id, organizationId: row.organization_id,
      company: text(details.client_company).trim(), contact: text(details.client_text).trim(), email: text(details.client_email).trim(),
    };
  })) };
}

export async function linkOffer(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  await managed(ctx, id);
  const target = uuid(body.targetId, 'Wybierz wydarzenie lub zapytanie.');
  const event = body.kind === 'event';
  const { error } = await ctx.supabase.rpc('link_offer_context', { p_offer: id, p_event: event ? target : null, p_inquiry: event ? null : target });
  if (error) fail(error.message || 'Nie udało się powiązać oferty.');
  return offerDetail(ctx, id);
}

// MARK: Aktualizacja zaakceptowanej oferty

/** „Aktualizuj zaakceptowaną ofertę” (szkic do zmian) i „Zapisz aktualizację” z uzasadnieniem. */
export async function offerDraftRevision(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await managed(ctx, id);
  const expected = Number(offer.content_revision ?? 0);
  if (body.action === 'reopen') {
    const { error } = await ctx.supabase.rpc('reopen_accepted_offer_draft', { p_offer: id, p_expected_revision: expected });
    if (error) fail(error.message || 'Nie udało się zaktualizować oferty.');
  } else {
    const reason = text(body.reason).trim().slice(0, 2000);
    if (reason.length < 3) fail('Wpisz powód aktualizacji (co najmniej 3 znaki).');
    const { error } = await ctx.supabase.rpc('save_offer_draft_revision', { p_offer: id, p_expected_revision: expected, p_reason: reason });
    if (error) fail(error.message || 'Nie udało się zaktualizować oferty.');
  }
  return offerDetail(ctx, id);
}

// MARK: Wydarzenie z zaakceptowanego zapytania

/** Data i godzina w strefie Europe/Warsaw jako „RRRR-MM-DDTGG:MM” (jak pole `datetime-local` w CRM). */
function warsawLocal(value: unknown) {
  const raw = text(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function acceptedInquiry(ctx: NativeContext, offer: Row) {
  if (!offer.inquiry_id) fail('Oferta nie jest powiązana z zapytaniem.');
  const { data, error } = await ctx.supabase.from('tasks').select('id, title, inquiry_details, due_date, accepted_offer_id, event_id, contact_id, organization_id')
    .eq('id', offer.inquiry_id).eq('is_inquiry', true).is('archived_at', null).single();
  if (error || !data) fail(error?.message || 'Nie znaleziono zapytania.');
  return data as Row;
}

/** Dane okna „Utwórz wydarzenie z zapytania” albo istniejące wydarzenie zapytania (`eventId`). */
export async function offerEventSetup(ctx: NativeContext, id: string) {
  const offer = await managed(ctx, uuid(id));
  const inquiry = await acceptedInquiry(ctx, offer);
  if (inquiry.event_id) return { eventId: String(inquiry.event_id) };
  if (inquiry.accepted_offer_id !== offer.id) fail('W zapytaniu wybierz tę ofertę jako zaakceptowaną przed utworzeniem wydarzenia.');
  const [categories, companies] = await Promise.all([
    ctx.supabase.from('event_categories').select('id, name').eq('is_active', true).order('order_index'),
    ctx.supabase.from('my_companies').select('id, name, legal_name, is_default').eq('is_active', true).order('is_default', { ascending: false }),
  ]);
  if (categories.error || companies.error) fail('Nie udało się otworzyć formularza wydarzenia');
  const details = (inquiry.inquiry_details || {}) as Row;
  const inquiryDate = warsawLocal(details.termin);
  const date = inquiryDate
    ? (details.event_start_time ? `${inquiryDate.slice(0, 10)}T${text(details.event_start_time).slice(0, 5)}` : inquiryDate)
    : warsawLocal(offer.event_date || offer.event?.event_date);
  const companyRows = (companies.data || []) as Row[];
  return {
    eventId: null,
    name: inquiryTitleLabel(text(offer.title) || text(inquiry.title)),
    date,
    location: text(offer.event_location).trim() || text(details.location_text),
    endNote: details.event_end_date && details.event_single_day !== true
      ? `Zakończenie z zapytania: ${new Date(`${details.event_end_date}T12:00:00`).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}, ${text(details.event_end_time)}`
      : null,
    categories: ((categories.data || []) as Row[]).map((row) => ({ id: String(row.id), name: text(row.name) })),
    companies: companyRows.map((row) => ({ id: String(row.id), name: text(row.legal_name || row.name) })),
    companyId: (companyRows.find((row) => row.is_default) || companyRows[0])?.id || null,
  };
}

/** „Utwórz wydarzenie” (`prepare_inquiry_realization`): wycena i plan zasobów z zaakceptowanej oferty. */
export async function createOfferEvent(ctx: NativeContext, body: Row) {
  const offer = await managed(ctx, uuid(body.id));
  const name = text(body.name).trim();
  const date = new Date(text(body.date));
  if (!name) fail('Uzupełnij nazwę wydarzenia');
  if (Number.isNaN(date.getTime())) fail('Uzupełnij poprawny termin wydarzenia');
  const inquiry = await acceptedInquiry(ctx, offer);
  if (inquiry.event_id) return { eventId: String(inquiry.event_id) };
  if (inquiry.accepted_offer_id !== offer.id) fail('Zaakceptowana oferta w zapytaniu zmieniła się. Otwórz formularz ponownie.');
  if (!inquiry.contact_id && !inquiry.organization_id) fail('Uzupełnij klienta w powiązanym zapytaniu przed utworzeniem wydarzenia.');
  const category = body.categoryId ? uuid(body.categoryId, 'Nieprawidłowa kategoria.') : null;
  const company = body.companyId ? uuid(body.companyId, 'Nieprawidłowa działalność.') : null;
  const { data, error } = await ctx.supabase.rpc('prepare_inquiry_realization', {
    p_inquiry_id: inquiry.id, p_event_name: name, p_event_date: date.toISOString(), p_category_id: category, p_my_company_id: company,
  });
  if (error) fail(error.message || 'Nie udało się utworzyć wydarzenia');
  return { eventId: text(data) || null };
}
