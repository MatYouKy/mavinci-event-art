import 'server-only';
import { NextRequest } from 'next/server';
import type { NativeContext } from './auth';
import { POST as invitePortal } from '@/app/bridge/seller/invite/route';
import { commissionPaymentLabels, DEFAULT_DIVIDEND_TAX_RATE } from '@/lib/CRM/events/eventCommission';
import {
  SELLER_PARTNER_TYPE_LABELS, SELLER_PROFILE_STATUS_LABELS, sellerEffectiveDefaultCompany, sellerProfileProblems,
  type SellerProfileFormInput, type SellerProfileFormTerm,
} from '@/lib/seller/sellerProfileForm';

/**
 * Kreator „Nowy sprzedawca” na Macu (`/bridge/native/v1/sellers`, op=newSeller | people | organizations | validate | create).
 * Te same zapisy co formularz CRM (`CrmSellerProfileSettings.tsx`): profil i warunki marek tokenem pracownika (RLS jak w CRM),
 * te same warunki (`sellerProfileProblems`), zaproszenie przez `/bridge/seller/invite` (wywołane na serwerze), opiekuna
 * przypisuje administrator (`set_seller_manager`). Aplikacja zbiera dane i pokazuje braki — nie rozstrzyga o niczym sama.
 * Kartoteka, normalizacja formularza, sprawdzenie braków i zaproszenie są wspólne z ustawieniami istniejącego sprzedawcy
 * (`src/lib/native/sellerSettings.ts`).
 */

export type SellerDirectoryProfile = {
  id: string; contact_id: string | null; employee_id: string | null; partner_type?: string | null; organization_id?: string | null;
  status?: string | null; portal_enabled?: boolean | null; portal_auth_user_id?: string | null; notes?: string | null;
};
export type SellerDirectory = { employee_id: string; is_admin: boolean; can_manage: boolean; profiles: SellerDirectoryProfile[] };
type Directory = SellerDirectory;
type Term = SellerProfileFormTerm & { default_payment_method: string };
export type NewSellerForm = {
  personSource: 'contact' | 'employee';
  personId: string;
  partnerType: string;
  status: string;
  organizationId: string;
  defaultCompanyId: string;
  portalEnabled: boolean;
  notes: string;
  terms: Term[];
  managerId: string;
  backupManagerId: string;
};

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const like = (query: string) => `%${query.replace(/[%_,()\\]/g, ' ').trim()}%`;

/** Kartoteka sprzedawców (`get_crm_seller_directory`) — uprawnienia oglądającego z bieżącej sesji, jak w CRM. */
export async function sellerDirectory(ctx: NativeContext, denied = 'Nie masz uprawnień do dodawania sprzedawców.'): Promise<Directory> {
  const { data, error } = await ctx.supabase.rpc('get_crm_seller_directory');
  if (error) fail(error.message || 'Brak dostępu do kartoteki sprzedawców.', error.code === '42501' ? 403 : 400);
  const access = data as Directory | null;
  if (!access?.employee_id || !Array.isArray(access.profiles)) fail('Brak dostępu do ustawień sprzedawcy.', 403);
  if (!access!.can_manage) fail(denied, 403);
  return access!;
}
const directory = (ctx: NativeContext) => sellerDirectory(ctx);

/** Start kreatora: marki, rodzaje współpracy, sposoby wypłaty i uprawnienia oglądającego. */
export async function newSellerSetup(ctx: NativeContext) {
  const access = await directory(ctx);
  const { data: companies, error } = await ctx.supabase.from('my_companies').select('id,name').order('name');
  if (error) throw error;
  return {
    isAdmin: access.is_admin,
    employeeId: access.employee_id,
    companies: (companies || []) as { id: string; name: string }[],
    partnerTypes: Object.entries(SELLER_PARTNER_TYPE_LABELS).filter(([value]) => access.is_admin || value !== 'internal_employee').map(([value, label]) => ({ value, label })),
    statuses: Object.entries(SELLER_PROFILE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    paymentMethods: Object.entries(commissionPaymentLabels).map(([value, label]) => ({ value, label })),
    defaultTaxRate: DEFAULT_DIVIDEND_TAX_RATE,
    defaultCommissionRate: 10,
  };
}

/** Osoby do wyboru: kontakty (pracownik — tylko swoje, jak w CRM) albo pracownicy MAVINCI (administrator). */
export async function newSellerPeople(ctx: NativeContext, source: string, query: string) {
  const access = await directory(ctx);
  const sellers = new Map(access.profiles.flatMap((profile) => [
    ...(profile.contact_id ? [[`contact:${profile.contact_id}`, profile.id] as const] : []),
    ...(profile.employee_id ? [[`employee:${profile.employee_id}`, profile.id] as const] : []),
  ]));
  const term = query.trim();
  if (source === 'employee') {
    if (!access.is_admin) fail('Pracowników MAVINCI jako sprzedawców dodaje administrator.', 403);
    let request = ctx.supabase.from('employees').select('id,name,surname,email').eq('is_active', true).order('surname').limit(40);
    if (term) request = request.or(`name.ilike.${like(term)},surname.ilike.${like(term)},email.ilike.${like(term)}`);
    const { data, error } = await request;
    if (error) throw error;
    return { people: ((data || []) as { id: string; name: string; surname: string; email: string | null }[]).map((person) => ({
      id: person.id, name: `${person.name || ''} ${person.surname || ''}`.trim() || 'Pracownik', email: person.email || null,
      detail: person.email || 'pracownik CRM', sellerId: sellers.get(`employee:${person.id}`) || null,
    })) };
  }
  let request = ctx.supabase.from('contacts').select('id,full_name,email').order('full_name').limit(40);
  if (!access.is_admin) request = request.eq('owner_id', access.employee_id);
  if (term) request = request.or(`full_name.ilike.${like(term)},email.ilike.${like(term)}`);
  const { data, error } = await request;
  if (error) throw error;
  return { people: ((data || []) as { id: string; full_name: string | null; email: string | null }[]).map((person) => ({
    id: person.id, name: person.full_name || 'Kontakt', email: person.email || null,
    detail: person.email || 'brak adresu e-mail', sellerId: sellers.get(`contact:${person.id}`) || null,
  })) };
}

/** Hotele i organizacje z lokalizacją i liczbą sal — „Hotel i sale”. */
export async function newSellerOrganizations(ctx: NativeContext, query: string, id?: string) {
  let request = ctx.supabase.from('organizations').select('id,name,alias,business_type,location_id').order('name').limit(40);
  if (id && uuid.test(id)) request = request.eq('id', id);
  else if (query.trim()) request = request.or(`name.ilike.${like(query)},alias.ilike.${like(query)}`);
  const { data, error } = await request;
  if (error) throw error;
  const organizations = (data || []) as { id: string; name: string; alias: string | null; business_type: string | null; location_id: string | null }[];
  const locationIds = [...new Set(organizations.map((org) => org.location_id).filter((value): value is string => Boolean(value)))];
  const locations = new Map<string, { name: string; rooms: string[] }>();
  if (locationIds.length) {
    const { data: rows } = await ctx.supabase.from('locations').select('id,name,rooms').in('id', locationIds);
    for (const row of (rows || []) as { id: string; name: string; rooms: unknown }[]) {
      const rooms = Array.isArray(row.rooms) ? row.rooms.map((room) => String((room as { name?: string })?.name || '').trim()).filter(Boolean) : [];
      locations.set(row.id, { name: row.name, rooms });
    }
  }
  return { organizations: organizations.map((org) => {
    const location = org.location_id ? locations.get(org.location_id) : undefined;
    return {
      id: org.id, name: org.alias || org.name, fullName: org.alias ? org.name : null, businessType: org.business_type,
      isHotel: org.business_type === 'hotel', locationId: org.location_id, locationName: location?.name || null, rooms: location?.rooms || [],
    };
  }) };
}

export function normalize(raw: Record<string, unknown>): NewSellerForm {
  const text = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const terms = Array.isArray(raw.terms) ? raw.terms.slice(0, 50).map((value) => {
    const term = (value || {}) as Record<string, unknown>;
    return {
      my_company_id: text(term.my_company_id, 40), is_active: term.is_active === true, commission_enabled: term.commission_enabled === true,
      default_commission_rate: Number(term.default_commission_rate ?? 0), dividend_tax_rate: Number(term.dividend_tax_rate ?? DEFAULT_DIVIDEND_TAX_RATE),
      default_payment_method: Object.keys(commissionPaymentLabels).includes(String(term.default_payment_method)) ? String(term.default_payment_method) : 'cash_dividend',
    };
  }).filter((term) => uuid.test(term.my_company_id)) : [];
  return {
    personSource: raw.personSource === 'employee' ? 'employee' : 'contact',
    personId: uuid.test(text(raw.personId, 40)) ? text(raw.personId, 40) : '',
    partnerType: Object.keys(SELLER_PARTNER_TYPE_LABELS).includes(text(raw.partnerType, 40)) ? text(raw.partnerType, 40) : 'hotel_employee',
    status: Object.keys(SELLER_PROFILE_STATUS_LABELS).includes(text(raw.status, 20)) ? text(raw.status, 20) : 'active',
    organizationId: uuid.test(text(raw.organizationId, 40)) ? text(raw.organizationId, 40) : '',
    defaultCompanyId: uuid.test(text(raw.defaultCompanyId, 40)) ? text(raw.defaultCompanyId, 40) : '',
    portalEnabled: raw.portalEnabled === true,
    notes: text(raw.notes, 2000),
    terms,
    managerId: uuid.test(text(raw.managerId, 40)) ? text(raw.managerId, 40) : '',
    backupManagerId: uuid.test(text(raw.backupManagerId, 40)) ? text(raw.backupManagerId, 40) : '',
  };
}

/**
 * Braki (blokują zapis) i wskazówki (nie blokują) — kreator pokazuje je od pierwszego kroku. `editingId` — ustawienia
 * istniejącego sprzedawcy: jego własny profil nie jest „już sprzedawcą”.
 */
export async function check(ctx: NativeContext, access: Directory, form: NewSellerForm, editingId?: string) {
  const [person, organization] = await Promise.all([
    form.personId
      ? form.personSource === 'contact'
        ? ctx.supabase.from('contacts').select('id,email,owner_id').eq('id', form.personId).maybeSingle()
        : ctx.supabase.from('employees').select('id,email').eq('id', form.personId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    form.organizationId ? newSellerOrganizations(ctx, '', form.organizationId) : Promise.resolve({ organizations: [] }),
  ]);
  const org = organization.organizations[0] || null;
  const personRow = person.data as { id: string; email: string | null; owner_id?: string | null } | null;
  const input: SellerProfileFormInput = {
    personSource: form.personSource, personId: personRow ? form.personId : '', personEmail: form.personSource === 'contact' ? personRow?.email || null : null,
    partnerType: form.partnerType, organizationId: org ? form.organizationId : '',
    organization: org ? { business_type: org.businessType, location_id: org.locationId } : null,
    portalEnabled: form.portalEnabled, status: form.status, terms: form.terms, defaultCompanyId: form.defaultCompanyId,
  };
  const problems = sellerProfileProblems(input);
  // Uprawnienia jak w CRM: pracownik bez roli administratora dodaje tylko swoje kontakty zewnętrzne.
  if (!access.is_admin && (form.personSource !== 'contact' || form.partnerType === 'internal_employee'
    || (personRow && personRow.owner_id !== access.employee_id))) {
    problems.unshift({ step: 'person', section: 'organization', text: 'Możesz zarządzać tylko przypisanymi do Ciebie sprzedawcami zewnętrznymi.' });
  }
  const existing = access.profiles.find((profile) => profile.id !== editingId
    && form.personId && (form.personSource === 'contact' ? profile.contact_id : profile.employee_id) === form.personId);
  if (existing) problems.unshift({ step: 'person', section: 'organization', text: 'Ta osoba jest już sprzedawcą — otwórz jej kartę na liście sprzedawców.' });
  const hints: { step: string; text: string }[] = [];
  if (org?.locationId && org.rooms.length === 0) hints.push({ step: 'hotel', text: `${org.locationName || org.name}: brak sal. Kreator oferty nie pokaże wyboru przestrzeni — dodaj sale w kartotece lokalizacji.` });
  if (access.is_admin && !form.managerId) hints.push({ step: 'manager', text: 'Bez opiekuna rozmowy i zgody na ceny trafiają do administratorów. Możesz go przypisać teraz albo później w karcie sprzedawcy.' });
  if (!access.is_admin) hints.push({ step: 'manager', text: 'Opiekuna i zastępcę przypisuje administrator. Do tego czasu Ty ustawiasz warunki startowe sprzedawcy.' });
  if (!form.portalEnabled) hints.push({ step: 'access', text: 'Bez dostępu do portalu sprzedawca nie dostanie zaproszenia. Możesz je wysłać później z „Gotowości do pracy”.' });
  return { problems, hints, existingSellerId: existing?.id || null, organization: org };
}

export async function validateNewSeller(ctx: NativeContext, raw: Record<string, unknown>) {
  const access = await directory(ctx);
  const result = await check(ctx, access, normalize(raw));
  return { problems: result.problems, hints: result.hints, existingSellerId: result.existingSellerId };
}

/**
 * Dostęp do portalu: utworzenie lub połączenie konta i zaproszenie — ta sama trasa co `requestPortalAccess` w CRM
 * (`/bridge/seller/invite`), wywołana na serwerze z tokenem pracownika.
 */
export async function invitePortalAccess(request: Request, partnerId: string): Promise<{ ok: true; emailSent: boolean; email: string } | { ok: false; error: string }> {
  try {
    const response = await invitePortal(new NextRequest(new URL('/bridge/seller/invite', request.url), {
      method: 'POST',
      headers: { authorization: request.headers.get('authorization') || '', 'content-type': 'application/json' },
      body: JSON.stringify({ salesPartnerId: partnerId }),
    }));
    const reply = await response.json() as { emailSent?: boolean; email?: string; error?: string };
    if (!response.ok) return { ok: false, error: String(reply.error || response.status) };
    return { ok: true, emailSent: reply.emailSent === true, email: reply.email || '' };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message || 'błąd' };
  }
}

/** Zapis jak „Zapisz ustawienia” w CRM dla nowego sprzedawcy, potem opiekun (administrator) i zaproszenie do portalu. */
export async function createSeller(ctx: NativeContext, request: Request, raw: Record<string, unknown>) {
  const access = await directory(ctx);
  const form = normalize(raw);
  const result = await check(ctx, access, form);
  if (result.problems.length) {
    throw Object.assign(new Error(result.problems[0].text), { status: 400, problems: result.problems });
  }
  const active = form.terms.filter((term) => term.is_active);
  const effectiveDefault = sellerEffectiveDefaultCompany(form.terms, form.defaultCompanyId);
  const profile = await ctx.supabase.from('sales_partner_profiles').insert({
    employee_id: form.personSource === 'employee' ? form.personId : null,
    contact_id: form.personSource === 'contact' ? form.personId : null,
    partner_type: form.partnerType,
    organization_id: form.organizationId || null,
    portal_default_company_id: active.some((term) => term.my_company_id === effectiveDefault) ? effectiveDefault : null,
    status: form.status,
    portal_enabled: form.portalEnabled,
    portal_auth_user_id: null,
    notes: form.notes || null,
    created_by: access.employee_id,
  }).select('id').single();
  if (profile.error || !profile.data?.id) {
    const error = profile.error as { code?: string; message?: string } | null;
    if (error?.code === '23505') fail('Ta osoba jest już sprzedawcą — otwórz jej kartę na liście sprzedawców.');
    if (error?.code === '42501') fail(`Brak uprawnień do tej zmiany — dotyczy tylko Twoich sprzedawców (opiekun, zastępca) albo administratora. (${error.message || error.code})`, 403);
    fail(error?.message || 'Nie udało się zapisać profilu sprzedawcy.');
  }
  const id = (profile.data as { id: string }).id;
  const contactId = form.personSource === 'contact' ? form.personId : null;
  const messages: string[] = [];
  const warnings: string[] = [];
  const { error: termsError } = await ctx.supabase.from('sales_partner_brand_terms').upsert(form.terms.map((term) => ({
    sales_partner_id: id, my_company_id: term.my_company_id, commission_enabled: term.commission_enabled,
    default_commission_rate: Number(term.default_commission_rate || 0), default_payment_method: term.default_payment_method,
    dividend_tax_rate: Number(term.dividend_tax_rate ?? DEFAULT_DIVIDEND_TAX_RATE), is_active: term.is_active,
  })), { onConflict: 'sales_partner_id,my_company_id' });
  if (termsError) {
    // Profil już istnieje — ponowienie musi poprawić ten sam profil (w CRM), a nie tworzyć drugiego.
    return { ok: true, id, contactId, message: 'Profil zapisano, ale nie udało się zapisać warunków marek. Popraw je w karcie sprzedawcy w CRM.',
      warnings: [termsError.message || 'Baza odrzuciła zmianę warunków.'], invited: false };
  }
  if (access.is_admin && form.managerId) {
    const { error } = await ctx.supabase.rpc('set_seller_manager', {
      p_partner: id, p_manager: form.managerId, p_backup: form.backupManagerId || null, p_reason: 'Kreator „Nowy sprzedawca” (aplikacja na Maca)',
    });
    if (error) warnings.push(`Nie przypisano opiekuna: ${error.message || 'błąd zapisu'}. Przypisz go w karcie sprzedawcy.`);
  }
  let invited = false;
  if (form.portalEnabled) {
    const portal = await invitePortalAccess(request, id);
    if (!portal.ok) warnings.push(`Profil i warunki zapisano, ale nie udało się przygotować dostępu do portalu: ${portal.error}. Wyślij zaproszenie z „Gotowości do pracy”.`);
    else {
      invited = true;
      messages.push(portal.emailSent ? `Wiadomość do ustawienia hasła wysłano na ${portal.email}.` : `Konto ${portal.email} jest połączone z portalem.`);
    }
  }
  return { ok: true, id, contactId, invited, warnings, message: ['Sprzedawca został dodany.', ...messages].join(' ') };
}
