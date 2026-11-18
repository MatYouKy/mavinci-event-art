import 'server-only';
import type { NativeContext } from './auth';
import { commissionPaymentLabels, DEFAULT_DIVIDEND_TAX_RATE } from '@/lib/CRM/events/eventCommission';
import { SELLER_PARTNER_TYPE_LABELS, SELLER_PROFILE_STATUS_LABELS, sellerEffectiveDefaultCompany } from '@/lib/seller/sellerProfileForm';
import { SELLER_WARNING_LABELS, parseSellerCockpit, type SellerCockpit } from '@/lib/seller/sellerCockpit';
import { check, invitePortalAccess, newSellerOrganizations, normalize, sellerDirectory, type NewSellerForm } from './sellerCreate';

/*
 * Karta sprzedawcy na Macu → „Ustawienia” — to samo co zakładka „Ustawienia” karty sprzedawcy w CRM (`CrmSellerWorkspace`):
 * opiekun i zastępca oraz widoczność wynagrodzenia per marka (`SellerManagementPanel`, `sellerManagerData.ts`,
 * `set_seller_manager`, `set_seller_commission_visibility`) i profil sprzedawcy (`CrmSellerProfileSettings` w trybie edycji:
 * rodzaj współpracy, status, organizacja nowych ofert, notatka, warunki marek, domyślny cennik, dostęp do portalu).
 * Zapisy tokenem pracownika (RLS jak w CRM), warunki zapisu wspólne z CRM (`sellerProfileProblems`), zaproszenie przez
 * `/bridge/seller/invite`. Osoby sprzedawcy nie zmienia się w ustawieniach — serwer bierze ją z profilu.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = ['PGRST202', '42883'];
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const DENIED = 'Nie masz uprawnień do zmiany ustawień sprzedawcy.';

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const idOf = (value: unknown, message = 'Nieprawidłowy sprzedawca.') => {
  const id = str(value);
  if (!UUID.test(id)) fail(message);
  return id;
};

/** `sellerWriteErrorText` z CRM (`sellerUi.tsx`, moduł kliencki) — te same komunikaty. */
function writeError(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code === '42501') return `Brak uprawnień do tej zmiany — dotyczy tylko Twoich sprzedawców (opiekun, zastępca) albo administratora. (${error.message || error.code})`;
  if (error.code === 'PGRST116') return 'Nie zapisano zmian: nie masz uprawnień do tego sprzedawcy albo jego profil już nie istnieje.';
  return error.message || fallback;
}

// --- Opiekun, zastępca i widoczność wynagrodzenia (`sellerManagerData.ts`) ----------------------------------------------

type ManagerOption = { id: string; name: string; eligible: boolean };

/** Kandydaci na opiekuna, gdy kokpit ich nie podał: aktywni pracownicy z uprawnieniem do ofert lub administratorzy. */
async function fallbackManagers(ctx: NativeContext): Promise<ManagerOption[]> {
  const { data, error } = await ctx.supabase.from('employees').select('id,name,surname,role,access_level,permissions,is_active').eq('is_active', true).order('surname');
  if (error) return [];
  return ((data || []) as Row[]).map((employee) => {
    const permissions: string[] = Array.isArray(employee.permissions) ? employee.permissions : [];
    const eligible = employee.role === 'admin' || employee.access_level === 'admin' || permissions.includes('admin') || permissions.includes('offers_manage');
    return { id: str(employee.id), name: `${employee.name || ''} ${employee.surname || ''}`.trim() || 'Pracownik', eligible };
  });
}

const warningLabels = (codes: string[]) => codes
  .filter((code) => code in SELLER_WARNING_LABELS)
  .map((code) => (SELLER_WARNING_LABELS as Record<string, string>)[code]);

/**
 * Dane opiekuna i marek jednego sprzedawcy. Źródło główne: `get_my_seller_cockpit(p_partner)` — tylko ten sprzedawca, jeśli
 * jest „mój” (opiekun, zastępca, administrator). Gdy go tam nie ma (np. finanse) — kartoteka + warunki marek (RLS), jak w CRM.
 */
export async function sellerManagement(ctx: NativeContext, partnerParam: unknown) {
  const partnerId = idOf(partnerParam);
  const cockpitResult = await ctx.supabase.rpc('get_my_seller_cockpit', { p_partner: partnerId });
  let cockpit: SellerCockpit | null = null;
  if (!cockpitResult.error) cockpit = parseSellerCockpit(cockpitResult.data);
  const seller = cockpit?.sellers.find((item) => item.id === partnerId) || null;
  if (cockpit && seller) {
    const managers = cockpit.viewer.is_admin && cockpit.managers.length === 0 ? await fallbackManagers(ctx) : cockpit.managers;
    return {
      isAdmin: cockpit.viewer.is_admin,
      managers,
      managerId: seller.manager?.id || null,
      managerName: seller.manager?.name || null,
      backupId: seller.backup_manager?.id || null,
      backupName: seller.backup_manager?.name || null,
      managerOk: seller.manager ? seller.manager_ok : null,
      brands: seller.brands.map((brand) => ({
        companyId: brand.my_company_id, name: brand.name, active: brand.is_active, commission: brand.commission_enabled,
        rate: brand.rate, commissionsVisible: brand.commissions_visible,
      })),
      warnings: warningLabels(seller.warnings),
    };
  }

  const [directoryResult, termsResult, companiesResult] = await Promise.all([
    ctx.supabase.rpc('get_crm_seller_directory'),
    ctx.supabase.from('sales_partner_brand_terms')
      .select('my_company_id,commission_enabled,default_commission_rate,is_active,commissions_visible')
      .eq('sales_partner_id', partnerId),
    ctx.supabase.from('my_companies').select('id,name').order('name'),
  ]);
  const failure = directoryResult.error || termsResult.error;
  if (failure) {
    fail(MISSING.includes(failure.code || '') ? 'Zarządzanie opiekunem wymaga migracji 20261105150000_seller_manager_cockpit.sql.'
      : failure.message || 'Nie udało się wczytać opiekuna i warunków sprzedawcy.', failure.code === '42501' ? 403 : 400);
  }
  const directory = (directoryResult.data || {}) as { is_admin?: boolean; profiles?: Row[] };
  const profile = (directory.profiles || []).find((item) => item.id === partnerId);
  if (!profile) fail('Nie masz dostępu do tego sprzedawcy albo jego profil już nie istnieje.', 403);
  const isAdmin = cockpit?.viewer.is_admin ?? directory.is_admin === true;
  const companyNames = new Map(((companiesResult.data || []) as Row[]).map((company) => [str(company.id), str(company.name)]));
  const managers = isAdmin ? (cockpit?.managers.length ? cockpit.managers : await fallbackManagers(ctx)) : [];
  const managerId = str(profile!.manager_id) || null;
  const backupId = str(profile!.backup_manager_id) || null;
  return {
    isAdmin,
    managers,
    managerId,
    managerName: str(profile!.manager_name) || null,
    backupId,
    backupName: backupId ? str(profile!.backup_manager_name) || managers.find((item) => item.id === backupId)?.name || null : null,
    managerOk: managerId && managers.length ? managers.find((item) => item.id === managerId)?.eligible ?? false : null,
    brands: ((termsResult.data || []) as Row[]).map((term) => ({
      companyId: str(term.my_company_id),
      name: companyNames.get(str(term.my_company_id)) || 'Marka',
      active: term.is_active === true,
      commission: term.commission_enabled === true,
      rate: term.default_commission_rate == null ? null : Number(term.default_commission_rate),
      commissionsVisible: term.commissions_visible === true,
    })),
    warnings: [] as string[],
  };
}

/** „Zapisz opiekuna” (`SellerManagerAssignment`) — zmiana tylko przez administratora; uprawnienia sprawdza baza. */
export async function assignSellerManager(ctx: NativeContext, body: Row) {
  const partnerId = idOf(body.id);
  const manager = body.managerId ? idOf(body.managerId, 'Nieprawidłowy opiekun.') : null;
  const backup = body.backupId ? idOf(body.backupId, 'Nieprawidłowy zastępca.') : null;
  if (!manager && backup) fail('Zastępca wymaga opiekuna. Wybierz najpierw opiekuna albo usuń zastępcę.');
  if (manager && backup && manager === backup) fail('Zastępca musi być inną osobą niż opiekun.');
  const reason = str(body.reason).trim().slice(0, 300);
  const { data, error } = await ctx.supabase.rpc('set_seller_manager', {
    p_partner: partnerId, p_manager: manager, p_backup: backup, p_reason: reason || null,
  });
  if (error) fail(error.message || 'Nie udało się zmienić opiekuna.', error.code === '42501' ? 403 : 400);
  const result = (data && typeof data === 'object' ? data : {}) as { manager_id?: string | null; backup_manager_id?: string | null };
  return { ok: true, managerId: result.manager_id ?? manager, backupId: result.backup_manager_id ?? backup };
}

/** „Pokaż wynagrodzenie w portalu” dla jednej marki (`CommissionVisibilityToggle`) — zmiana jest audytowana w bazie. */
export async function setSellerCommissionVisibility(ctx: NativeContext, body: Row) {
  const partnerId = idOf(body.id);
  const companyId = idOf(body.companyId, 'Nieprawidłowa marka.');
  if (typeof body.visible !== 'boolean') fail('Nieprawidłowa zmiana widoczności.');
  const visible = body.visible === true;
  const reason = str(body.reason).trim().slice(0, 500);
  const { error } = await ctx.supabase.rpc('set_seller_commission_visibility', {
    p_partner: partnerId, p_company: companyId, p_visible: visible, p_reason: reason || null, p_notify: visible ? body.notify === true : false,
  });
  if (error) fail(error.message || 'Nie udało się zmienić widoczności wynagrodzenia.', error.code === '42501' ? 403 : 400);
  return { ok: true, visible };
}

// --- Profil sprzedawcy (`CrmSellerProfileSettings`, tryb edycji) --------------------------------------------------------

async function editableProfile(ctx: NativeContext, partnerId: string) {
  const access = await sellerDirectory(ctx, DENIED);
  const profile = access.profiles.find((item) => item.id === partnerId);
  if (!profile) fail('Nie masz dostępu do wskazanego sprzedawcy lub jego profil już nie istnieje.', 403);
  return { access, profile };
}

const termKey = (value: Row) => str(value.my_company_id);

/** Formularz ustawień: osoba (tylko do odczytu), współpraca, organizacja, notatka, warunki wszystkich marek, portal. */
export async function sellerSettings(ctx: NativeContext, partnerParam: unknown) {
  const partnerId = idOf(partnerParam);
  const { access, profile } = await editableProfile(ctx, partnerId);
  const contactId = profile.contact_id || null;
  const contactQuery = (id: string) => {
    const query = ctx.supabase.from('contacts').select('id,full_name,email').eq('id', id);
    // Pracownik bez roli administratora widzi tylko swoje kontakty — jak lista osób w CRM.
    return access.is_admin ? query : query.eq('owner_id', access.employee_id);
  };
  const none = Promise.resolve({ data: [] as Row[], error: null });
  const [people, staff, companies, savedTerms, defaults, organization] = await Promise.all([
    contactId ? contactQuery(contactId) : none,
    access.is_admin && profile.employee_id ? ctx.supabase.from('employees').select('id,name,surname,email').eq('id', profile.employee_id) : none,
    ctx.supabase.from('my_companies').select('id,name').order('name'),
    ctx.supabase.from('sales_partner_brand_terms')
      .select('id,sales_partner_id,my_company_id,commission_enabled,default_commission_rate,default_payment_method,dividend_tax_rate,is_active')
      .eq('sales_partner_id', partnerId),
    ctx.supabase.from('sales_partner_profiles').select('portal_default_company_id').eq('id', partnerId).single(),
    profile.organization_id ? newSellerOrganizations(ctx, '', profile.organization_id) : Promise.resolve({ organizations: [] }),
  ]);
  const failure = people.error || staff.error || companies.error || savedTerms.error || defaults.error;
  if (failure) fail(failure.message || 'Nie udało się wczytać ustawień sprzedawcy.', failure.code === '42501' ? 403 : 400);
  const contact = ((people.data || []) as Row[]).find((row) => row.id === contactId) || null;
  if (contactId && !contact) fail('Nie można odczytać kontaktu przypisanego do tego profilu.', 403);
  const employee = ((staff.data || []) as Row[])[0] || null;
  const person = profile.employee_id
    ? { source: 'employee', id: profile.employee_id, name: employee ? `${employee.name || ''} ${employee.surname || ''}`.trim() || 'Pracownik' : 'Pracownik MAVINCI',
      email: employee ? str(employee.email) || null : null, detail: employee ? str(employee.email) || 'pracownik CRM' : 'pracownik CRM' }
    : { source: 'contact', id: str(contactId), name: str(contact?.full_name) || 'Kontakt', email: str(contact?.email) || null,
      detail: str(contact?.email) || 'kontakt CRM' };
  const saved = new Map(((savedTerms.data || []) as Row[]).map((term) => [termKey(term), term]));
  const isAdmin = access.is_admin;
  const partnerType = str(profile.partner_type) || 'hotel_employee';
  const partnerTypes = Object.entries(SELLER_PARTNER_TYPE_LABELS)
    .filter(([value]) => isAdmin || value !== 'internal_employee' || value === partnerType)
    .map(([value, label]) => ({ value, label }));
  return {
    id: partnerId,
    isAdmin,
    person,
    partnerType,
    status: str(profile.status) || 'active',
    organizationId: profile.organization_id || null,
    organization: organization.organizations[0] || null,
    notes: str(profile.notes),
    defaultCompanyId: str((defaults.data as Row | null)?.portal_default_company_id),
    portalEnabled: profile.portal_enabled === true,
    portalLinked: Boolean(profile.portal_auth_user_id),
    terms: ((companies.data || []) as Row[]).map((company) => {
      const term = saved.get(str(company.id));
      return {
        companyId: str(company.id),
        name: str(company.name),
        active: term?.is_active === true,
        commission: term?.commission_enabled === true,
        rate: term ? Number(term.default_commission_rate ?? 0) : 10,
        method: term && Object.keys(commissionPaymentLabels).includes(str(term.default_payment_method)) ? str(term.default_payment_method) : 'cash_dividend',
        tax: term ? Number(term.dividend_tax_rate ?? DEFAULT_DIVIDEND_TAX_RATE) : DEFAULT_DIVIDEND_TAX_RATE,
      };
    }),
    partnerTypes,
    statuses: Object.entries(SELLER_PROFILE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    paymentMethods: Object.entries(commissionPaymentLabels).map(([value, label]) => ({ value, label })),
    pricingHref: `/crm/salespeople/${partnerId}/pricing`,
  };
}

/**
 * Formularz z aplikacji z osobą z profilu (osoby nie zmienia się w ustawieniach) i bez opiekuna (osobny zapis). Notatka bez
 * skracania kreatora (2000 znaków) — CRM nie ogranicza jej długości, a zapis nie może uciąć istniejącej notatki.
 */
function editForm(raw: unknown, profile: { contact_id: string | null; employee_id: string | null }): NewSellerForm {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const form = normalize(source);
  return {
    ...form,
    personSource: profile.employee_id ? 'employee' : 'contact',
    personId: profile.employee_id || profile.contact_id || '',
    notes: typeof source.notes === 'string' ? source.notes.trim().slice(0, 20000) : '',
    managerId: '',
    backupManagerId: '',
  };
}

/** Braki przed zapisem — te same warunki co formularz CRM (`sellerProfileProblems`) i ten sam zakres uprawnień. */
export async function validateSellerSettings(ctx: NativeContext, body: Row) {
  const partnerId = idOf(body.id);
  const { access, profile } = await editableProfile(ctx, partnerId);
  const result = await check(ctx, access, editForm(body.form, profile), partnerId);
  return { problems: result.problems };
}

/**
 * „Zapisz ustawienia” jak w CRM: profil, warunki wszystkich marek (upsert), a przy dostępie do portalu — połączenie konta
 * i zaproszenie. Wynik z poziomem komunikatu: `success`, `warning` (zaproszenie się nie udało), `error` (warunki marek).
 */
export async function saveSellerSettings(ctx: NativeContext, request: Request, body: Row) {
  const partnerId = idOf(body.id);
  const { access, profile } = await editableProfile(ctx, partnerId);
  const form = editForm(body.form, profile);
  const result = await check(ctx, access, form, partnerId);
  if (result.problems.length) throw Object.assign(new Error(result.problems[0].text), { status: 400, problems: result.problems });
  const active = form.terms.filter((term) => term.is_active);
  const effectiveDefault = sellerEffectiveDefaultCompany(form.terms, form.defaultCompanyId);
  const saved = await ctx.supabase.from('sales_partner_profiles').update({
    employee_id: form.personSource === 'employee' ? form.personId : null,
    contact_id: form.personSource === 'contact' ? form.personId : null,
    partner_type: form.partnerType,
    organization_id: form.organizationId || null,
    portal_default_company_id: active.some((term) => term.my_company_id === effectiveDefault) ? effectiveDefault : null,
    status: form.status,
    portal_enabled: form.portalEnabled,
    // Wyłączenie dostępu odłącza konto logowania — jak w CRM.
    portal_auth_user_id: form.portalEnabled ? (str(profile.portal_auth_user_id).trim() || null) : null,
    notes: form.notes || null,
  }).eq('id', partnerId).select('id').single();
  if (saved.error || !(saved.data as Row | null)?.id) {
    fail(writeError(saved.error, 'Nie udało się zapisać profilu sprzedawcy'), saved.error?.code === '42501' ? 403 : 400);
  }
  const { error: termsError } = await ctx.supabase.from('sales_partner_brand_terms').upsert(form.terms.map((term) => ({
    sales_partner_id: partnerId, my_company_id: term.my_company_id, commission_enabled: term.commission_enabled,
    default_commission_rate: Number(term.default_commission_rate || 0), default_payment_method: term.default_payment_method,
    dividend_tax_rate: Number(term.dividend_tax_rate ?? DEFAULT_DIVIDEND_TAX_RATE), is_active: term.is_active,
  })), { onConflict: 'sales_partner_id,my_company_id' });
  if (termsError) {
    return { ok: true, level: 'error', message: 'Profil zapisano, ale nie udało się zapisać warunków marek. Popraw ustawienia i zapisz ponownie. '
      + writeError(termsError, 'Baza odrzuciła zmianę warunków.') };
  }
  if (!form.portalEnabled) return { ok: true, level: 'success', message: 'Profil sprzedawcy został zaktualizowany' };
  const portal = await invitePortalAccess(request, partnerId);
  if (!portal.ok) return { ok: true, level: 'warning', message: `Profil i warunki zapisano, ale nie udało się przygotować dostępu do portalu: ${portal.error}` };
  return {
    ok: true, level: 'success',
    message: portal.emailSent ? `Sprzedawca zapisany. Wiadomość do ustawienia hasła wysłano na ${portal.email}` : `Sprzedawca zapisany. Konto ${portal.email} jest połączone z portalem`,
  };
}
