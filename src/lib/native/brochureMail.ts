import 'server-only';
import type { NativeContext } from './auth';
import { fail } from './offers';
import { emailPreviewDocument, plainTextToEmailHtml } from './messages';
import { sendingAccounts } from './offerActions';
import { brochureAccess } from './brochures';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';

/*
 * Broszury na Macu, część G3 — wysyłka broszury e-mailem (`SendBrochureEmailModal`) i historia wysyłek
 * (`BrochureDeliveryHistory`): skrzynki nadawcy, treść z szablonem i stopką marki broszury, odbiorcy z organizacji
 * i kontaktów, lista wysyłek z treścią i załącznikiem. Przygotowanie i wysyłkę (osobny PDF i wiadomość dla każdego
 * odbiorcy) wykonuje `/bridge/brochures/deliveries` tokenem pracownika, jak w CRM.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message: string) => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));

export const BROCHURE_MAIL_SUBJECT = 'Propozycja współpracy eventowej — Mavinci';
export const BROCHURE_MAIL_TEXT = 'Dzień dobry,\n\nw załączeniu przesyłam broszurę z propozycją współpracy oraz zakresem usług eventowych Mavinci.\n\n'
  + 'Chętnie porozmawiam o potrzebach Państwa obiektu i możliwościach wspólnej realizacji wydarzeń.\n\nZapraszam do kontaktu.';

/** Wysyłka wymaga zarządzania broszurami i dostępu do własnych PDF-ów (jak przycisk „Wyślij broszurę” w CRM). */
async function requireSender(ctx: NativeContext) {
  const access = await brochureAccess(ctx);
  if (!access.canManage || !access.canViewResults) fail('Brak uprawnień do przygotowania i wysyłki broszur.');
  return access;
}

async function brochureOf(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('sales_brochures').select('id,name,my_company_id,status').eq('id', id).maybeSingle();
  if (error || !data) fail('Nie znaleziono broszury.');
  if (data!.status === 'archived') fail('Broszura jest w archiwum. Przywróć ją przed wysyłką.');
  return data as Row;
}

/** Okno „Wyślij broszurę”: skrzynki nadawcy (osobiste i przypisane z prawem wysyłania), domyślny temat i treść. */
export async function brochureMailSetup(ctx: NativeContext, rawId: string) {
  await requireSender(ctx);
  const brochure = await brochureOf(ctx, uuid(rawId, 'Nie znaleziono broszury.'));
  const accounts = await sendingAccounts(ctx);
  return {
    brochureName: text(brochure.name),
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    subject: BROCHURE_MAIL_SUBJECT,
    text: BROCHURE_MAIL_TEXT,
  };
}

/**
 * Treść wiadomości jak `buildUnifiedEmailHtml` (cel „offer”) z marką broszury i stopką skrzynki nadawcy: `bodyHtml` trafia
 * do przygotowanej wysyłki, `html` — do podglądu w aplikacji.
 */
export async function brochureMailCompose(ctx: NativeContext, body: Row) {
  await requireSender(ctx);
  const brochure = await brochureOf(ctx, uuid(body.id, 'Nie znaleziono broszury.'));
  const accounts = await sendingAccounts(ctx);
  const account = accounts.find((item) => item.id === text(body.accountId));
  if (!account) fail('Wybierz skrzynkę, z której ma zostać wysłana broszura.');
  const subject = text(body.subject).trim();
  const content = text(body.text);
  if (!subject || subject.length > 250 || /[\r\n]/.test(subject)) fail('Uzupełnij temat wiadomości (do 250 znaków).');
  if (!content.trim()) fail('Uzupełnij treść wiadomości.');
  const companyId = text(brochure.my_company_id) || null;
  const signature = await buildCompanySignatureHtml({ client: ctx.supabase, employeeId: ctx.employee.id, companyId, emailAccountId: account!.id } as any);
  const result = await buildCompanyEmailBody({
    client: ctx.supabase,
    employeeId: ctx.employee.id,
    companyId,
    emailAccountId: account!.id,
    content: plainTextToEmailHtml(content),
    contentIsHtml: true,
    subject,
    recipientName: text(body.recipientName).trim() || undefined,
    signatureHtml: signature.html,
    purpose: 'offer',
  } as any);
  return { bodyHtml: result.html, html: emailPreviewDocument(result.html) };
}

/** Organizacja jako odbiorca: jej adres i obecne osoby kontaktowe (jak `BrochureRecipients`, do 500 powiązań). */
export async function brochureOrganizationMembers(ctx: NativeContext, rawId: string) {
  await requireSender(ctx);
  const id = uuid(rawId, 'Wybierz organizację.');
  const [organization, links] = await Promise.all([
    ctx.supabase.from('organizations').select('id,name,email').eq('id', id).maybeSingle(),
    ctx.supabase.from('contact_organizations').select('contact:contacts(id,full_name,email)').eq('organization_id', id).eq('is_current', true).limit(500),
  ]);
  if (organization.error || !organization.data) fail('Brak dostępu do organizacji.');
  if (links.error) fail('Nie udało się pobrać kontaktów organizacji.');
  const org = organization.data as Row;
  const members = new Map<string, Row>();
  for (const link of (links.data || []) as Row[]) {
    const contact = Array.isArray(link.contact) ? link.contact[0] : link.contact;
    if (contact?.id) {
      members.set(String(contact.id), {
        name: text(contact.full_name) || 'Kontakt', email: text(contact.email).trim().toLowerCase(), contactId: String(contact.id), organizationId: id,
      });
    }
  }
  const orgEmail = text(org.email).trim().toLowerCase();
  return {
    organization: { id, name: text(org.name), email: orgEmail },
    members: [
      ...(orgEmail ? [{ name: `${text(org.name)} — adres organizacji`, email: orgEmail, contactId: null, organizationId: id }] : []),
      ...members.values(),
    ],
    truncated: (links.data || []).length === 500,
  };
}

/**
 * Historia wysyłek (`BrochureDeliveryHistory`): broszura, kontakt, organizacja lub partia wysyłki; „Moje” albo — z prawem
 * do wyników wszystkich — „Wszystkie” z filtrem pracownika. Po 25 na stronę, najnowsze pierwsze (partia — w kolejności).
 */
export async function brochureDeliveries(ctx: NativeContext, params: URLSearchParams) {
  const access = await brochureAccess(ctx);
  if (!access.canView) fail('Nie masz dostępu do broszur.');
  const canViewAll = ctx.employee.isAdmin || ctx.employee.permissions.includes('offers_brochures_view_all');
  const offset = Math.max(0, Math.min(100_000, Number.parseInt(params.get('offset') || '0', 10) || 0));
  const batch = params.get('batch');
  let query = ctx.supabase.from('sales_brochure_deliveries')
    .select('*,source:sales_brochure_generations(version,pdf_path,file_name),author:employees!sales_brochure_deliveries_employee_id_fkey(name,surname)');
  if (batch) {
    query = query.eq('batch_id', uuid(batch, 'Nieprawidłowa wysyłka.')).order('created_at').limit(50);
  } else {
    query = query.order('created_at', { ascending: false }).order('id').range(offset, offset + 24);
    const brochure = params.get('brochure');
    const contact = params.get('contact');
    const organization = params.get('organization');
    if (brochure) query = query.eq('brochure_id', uuid(brochure, 'Nie znaleziono broszury.'));
    if (contact) query = query.eq('contact_id', uuid(contact, 'Nie znaleziono kontaktu.'));
    if (organization) query = query.eq('organization_id', uuid(organization, 'Nie znaleziono organizacji.'));
    const employee = params.get('employee');
    if (params.get('all') !== 'true' || !canViewAll) query = query.eq('employee_id', ctx.employee.id);
    else if (employee) query = query.eq('employee_id', uuid(employee, 'Nieprawidłowy pracownik.'));
  }
  const { data, error } = await query;
  if (error) fail('Nie udało się wczytać historii wysyłek.');
  return {
    canViewAll,
    canSend: access.canManage,
    currentEmployeeId: ctx.employee.id,
    deliveries: (data || []).map((row: Row) => {
      const source = Array.isArray(row.source) ? row.source[0] : row.source;
      const author = Array.isArray(row.author) ? row.author[0] : row.author;
      return {
        ...row,
        source: source ? { version: Number(source.version) || 0, pdf_path: text(source.pdf_path), file_name: text(source.file_name) || 'Broszura.pdf' } : null,
        author_name: [author?.name, author?.surname].filter(Boolean).join(' ') || 'Pracownik',
      };
    }),
  };
}

/** Podpisany adres zapisanego PDF (załącznik wysyłki, wersja broszury, próbny PDF z demo) — dostęp jak w magazynie plików. */
export async function brochureFileUrl(ctx: NativeContext, body: Row) {
  const access = await brochureAccess(ctx);
  if (!access.canView) fail('Nie masz dostępu do broszur.');
  const bucket = text(body.bucket);
  const path = text(body.path);
  if (!['generated-brochures', 'seller-demo-pdfs'].includes(bucket) || !path || path.includes('..')) fail('Nieprawidłowy plik.');
  const fileName = text(body.fileName).trim();
  const { data, error } = await ctx.supabase.storage.from(bucket).createSignedUrl(path, 300, fileName ? { download: fileName } : undefined);
  if (error || !data?.signedUrl) fail('Nie udało się otworzyć PDF. Odśwież listę i spróbuj ponownie.');
  return { url: data!.signedUrl, fileName: fileName || path.split('/').pop() || 'Broszura.pdf' };
}
