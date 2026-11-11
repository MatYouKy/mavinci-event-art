import 'server-only';
import type { NativeContext } from './auth';
import { ACCESS_SECTIONS } from '@/lib/accessSections';
import { getAllScopes } from '@/lib/permissions';
import { FINANCE_COMPANY_LEVEL_OPTIONS, normalizeFinanceCompanyAccess } from '@/lib/financeCompanyAccess';
import { isDrivingLicenseCertification } from '@/lib/CRM/employees/drivingLicenses';
import {
  CONTACT_TABS, EVENT_TABS, LEGACY_FINANCE_PERMISSIONS, MAVINCI_LIVE_SECTION_SCOPES, ORGANIZATION_TABS, RECORD_SCOPE_MODULE_KEYS,
} from '@/lib/employees/permissionTabs';

/*
 * Zakładki administratora na karcie pracownika w aplikacji na Maca — te same zapytania i zapisy co w CRM:
 * „Kwalifikacje” (`EmployeeQualificationsTab`, `EmployeeDrivingLicensesPanel`), „Konta Email” (`EmployeeEmailAccountsTab`;
 * hasła IMAP/SMTP nigdy nie wracają do aplikacji) i „Uprawnienia” (`EmployeePermissionsTab`). Tokenem pracownika — RLS jak w CRM.
 */

type Row = Record<string, any>;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

// MARK: Kwalifikacje

export async function qualifications(ctx: NativeContext, employeeId: string) {
  const s = ctx.supabase;
  const [certs, skills, certTypes, skillTypes, licenses, categories] = await Promise.all([
    s.from('employee_certifications').select('*, certification_type:certification_types(*)').eq('employee_id', employeeId).order('issued_date', { ascending: false }),
    s.from('employee_skills').select('*, skill:skills(*, category:skill_categories(name, color))').eq('employee_id', employeeId).order('created_at', { ascending: false }),
    s.from('certification_types').select('*').order('name'),
    s.from('skills').select('*, category:skill_categories(id, name, color)').eq('is_active', true).order('name'),
    s.from('employee_driving_licenses')
      .select('id,license_category_id,obtained_date,expiry_date,license_number,notes,license_category:driving_license_categories(id,code,name,description,order_index)')
      .eq('employee_id', employeeId),
    s.from('driving_license_categories').select('*').eq('is_active', true).order('order_index'),
  ]);
  for (const result of [certs, skills, certTypes, skillTypes, licenses, categories]) if (result.error) throw result.error;
  return {
    certifications: (certs.data || []).map((row: Row) => {
      const type = one(row.certification_type) as Row | null;
      return {
        id: String(row.id), typeId: text(row.certification_type_id), typeName: text(type?.name), issued: text(row.issued_date),
        expiry: text(row.expiry_date), number: text(row.certification_number), authority: text(row.issuing_authority),
        notes: text(row.notes), active: row.is_active !== false, driving: isDrivingLicenseCertification(type?.name),
        documentUrl: /^https?:\/\//i.test(text(row.document_url)) ? text(row.document_url) : '',
      };
    }),
    skills: (skills.data || []).map((row: Row) => {
      const skill = one(row.skill) as Row | null;
      const category = one(skill?.category) as Row | null;
      return {
        id: String(row.id), skillId: text(row.skill_id), name: text(skill?.name), category: text(category?.name), color: text(category?.color),
        level: text(row.proficiency_level) || 'basic', years: row.years_of_experience == null ? null : Number(row.years_of_experience), notes: text(row.notes),
      };
    }),
    certificationTypes: (certTypes.data || []).filter((row: Row) => !isDrivingLicenseCertification(row.name))
      .map((row: Row) => ({ id: String(row.id), name: text(row.name), description: text(row.description), validityMonths: row.validity_period_months ?? null })),
    skillTypes: (skillTypes.data || []).map((row: Row) => {
      const category = one(row.category) as Row | null;
      return { id: String(row.id), name: text(row.name), category: text(category?.name) };
    }),
    licenses: (licenses.data || []).map((row: Row) => {
      const category = one(row.license_category) as Row | null;
      return {
        id: String(row.id), categoryId: text(row.license_category_id), code: text(category?.code), name: text(category?.name),
        order: Number(category?.order_index) || 0, obtained: text(row.obtained_date), expiry: text(row.expiry_date),
        number: text(row.license_number), notes: text(row.notes),
      };
    }).sort((a: { order: number }, b: { order: number }) => a.order - b.order),
    licenseCategories: (categories.data || []).map((row: Row) => ({ id: String(row.id), code: text(row.code), name: text(row.name), description: text(row.description) })),
  };
}

const date = (value: unknown) => {
  const raw = text(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};
const optional = (value: unknown) => (text(value).trim() ? text(value).trim() : null);

export async function saveCertification(ctx: NativeContext, employeeId: string, id: string | null, data: Row) {
  const typeId = text(data.typeId);
  const { data: type } = await ctx.supabase.from('certification_types').select('name').eq('id', typeId).maybeSingle();
  if (!type) return 'Wybierz typ certyfikatu.';
  if (isDrivingLicenseCertification(type.name)) return 'Prawo jazdy dodaj w sekcji Prawa jazdy — to jedyne źródło kategorii dla floty.';
  const issued = date(data.issued);
  if (!issued) return 'Podaj datę wydania.';
  const payload = {
    certification_type_id: typeId, issued_date: issued, expiry_date: date(data.expiry), certification_number: optional(data.number),
    issuing_authority: optional(data.authority), notes: optional(data.notes), is_active: data.active !== false,
  };
  const { error } = id
    ? await ctx.supabase.from('employee_certifications').update(payload).eq('id', id).eq('employee_id', employeeId)
    : await ctx.supabase.from('employee_certifications').insert({ employee_id: employeeId, ...payload });
  return error ? (id ? 'Błąd podczas aktualizacji certyfikatu' : 'Błąd podczas dodawania certyfikatu') : null;
}

export async function saveSkill(ctx: NativeContext, employeeId: string, id: string | null, data: Row) {
  const skillId = text(data.skillId);
  if (!skillId) return 'Wybierz umiejętność.';
  const level = ['basic', 'intermediate', 'advanced', 'expert'].includes(text(data.level)) ? text(data.level) : 'basic';
  const years = data.years == null || data.years === '' ? null : Number(data.years);
  if (years != null && (!Number.isFinite(years) || years < 0)) return 'Lata doświadczenia muszą być liczbą ≥ 0.';
  const payload = { skill_id: skillId, proficiency_level: level, years_of_experience: years, notes: optional(data.notes) };
  const { error } = id
    ? await ctx.supabase.from('employee_skills').update(payload).eq('id', id).eq('employee_id', employeeId)
    : await ctx.supabase.from('employee_skills').insert({ employee_id: employeeId, ...payload });
  return error ? (id ? 'Błąd podczas aktualizacji umiejętności' : 'Błąd podczas dodawania umiejętności') : null;
}

export async function saveLicense(ctx: NativeContext, employeeId: string, id: string | null, data: Row) {
  const obtained = date(data.obtained);
  const expiry = date(data.expiry);
  if (obtained && expiry && expiry < obtained) return 'Data ważności nie może być wcześniejsza niż data uzyskania.';
  const payload = { obtained_date: obtained, expiry_date: expiry, license_number: optional(data.number), notes: optional(data.notes) };
  if (id) {
    const { error } = await ctx.supabase.from('employee_driving_licenses').update(payload).eq('id', id).eq('employee_id', employeeId);
    return error ? 'Błąd podczas aktualizacji prawa jazdy' : null;
  }
  const categoryId = text(data.categoryId);
  if (!categoryId) return 'Wybierz kategorię prawa jazdy';
  const { error } = await ctx.supabase.from('employee_driving_licenses').insert({ employee_id: employeeId, license_category_id: categoryId, ...payload });
  if (error?.code === '23505') return 'Ta kategoria jest już dodana';
  return error ? 'Błąd podczas dodawania prawa jazdy' : null;
}

// MARK: Konta e-mail

const ACCOUNT_FIELDS = 'id,account_name,from_name,email_address,account_type,department,description,is_active,employee_id,imap_host,imap_port,imap_username,imap_use_ssl,smtp_host,smtp_port,smtp_username,smtp_use_tls';

export async function emailAccounts(ctx: NativeContext, employeeId: string) {
  const s = ctx.supabase;
  const [accounts, assignments, employee] = await Promise.all([
    s.from('employee_email_accounts').select(ACCOUNT_FIELDS).eq('is_active', true).order('account_type', { ascending: false }).order('account_name', { ascending: true }),
    s.from('employee_email_account_assignments').select('id,email_account_id').eq('employee_id', employeeId),
    s.from('employees').select('can_receive_contact_forms, personal_email, notification_email_preference, signature_thumb, email').eq('id', employeeId).maybeSingle(),
  ]);
  for (const result of [accounts, assignments, employee]) if (result.error) throw result.error;
  const e = (employee.data || {}) as Row;
  return {
    accounts: (accounts.data || []).map((row: Row) => ({
      id: String(row.id), name: text(row.account_name), fromName: text(row.from_name), email: text(row.email_address),
      type: text(row.account_type) || 'shared', department: text(row.department), description: text(row.description),
      employeeId: row.employee_id || null, imapHost: text(row.imap_host), imapPort: Number(row.imap_port) || 993, imapUsername: text(row.imap_username),
      imapSsl: row.imap_use_ssl !== false, smtpHost: text(row.smtp_host), smtpPort: Number(row.smtp_port) || 587, smtpUsername: text(row.smtp_username),
      smtpTls: row.smtp_use_tls !== false,
    })),
    assignments: (assignments.data || []).map((row: Row) => ({ id: String(row.id), accountId: String(row.email_account_id) })),
    canReceiveContactForms: e.can_receive_contact_forms === true,
    personalEmail: text(e.personal_email),
    notificationPreference: text(e.notification_email_preference) || 'work',
    signatureThumb: e.signature_thumb || null,
    workEmail: text(e.email),
  };
}

/** Konto osobiste pracownika: zapis jak w CRM; puste hasło przy edycji = bez zmiany (hasła nie są odsyłane do aplikacji). */
export async function savePersonalAccount(ctx: NativeContext, employeeId: string, data: Row) {
  const name = text(data.name).trim();
  const email = text(data.email).trim();
  if (!name || !email) return 'Nazwa konta i adres email są wymagane';
  const { data: existing, error: readError } = await ctx.supabase.from('employee_email_accounts').select('id')
    .eq('account_type', 'personal').eq('employee_id', employeeId).eq('is_active', true).limit(1);
  if (readError) throw readError;
  const payload: Row = {
    account_name: name, from_name: text(data.fromName).trim(), email_address: email, description: text(data.description).trim(),
    imap_host: text(data.imapHost).trim(), imap_port: Number(data.imapPort) || 993, imap_username: text(data.imapUsername).trim(),
    imap_use_ssl: data.imapSsl !== false, smtp_host: text(data.smtpHost).trim(), smtp_port: Number(data.smtpPort) || 587,
    smtp_username: text(data.smtpUsername).trim(), smtp_use_tls: data.smtpTls !== false,
    account_type: 'personal', employee_id: employeeId, is_active: true,
  };
  const imapPassword = typeof data.imapPassword === 'string' ? data.imapPassword : '';
  const smtpPassword = typeof data.smtpPassword === 'string' ? data.smtpPassword : '';
  const current = existing?.[0];
  if (imapPassword || !current) payload.imap_password = imapPassword;
  if (smtpPassword || !current) payload.smtp_password = smtpPassword;
  const { error } = current
    ? await ctx.supabase.from('employee_email_accounts').update(payload).eq('id', current.id)
    : await ctx.supabase.from('employee_email_accounts').insert([payload]);
  if (error) return `Błąd podczas zapisywania konta: ${error.message}`;
  return null;
}

// MARK: Uprawnienia

export function permissionCatalog() {
  return {
    categories: ACCESS_SECTIONS.filter((section) => section.key !== 'invoices').map((section) => ({
      key: section.key,
      label: section.label,
      extra: section.scopes
        .filter((scope) => !scope.key.endsWith('_own_only') && scope.key !== `${section.key}_view` && scope.key !== `${section.key}_manage`)
        .map((scope) => ({ key: scope.key, label: scope.label, description: scope.description })),
    })),
    allScopes: getAllScopes().filter((scope) => !scope.endsWith('_own_only')),
    financeLevels: FINANCE_COMPANY_LEVEL_OPTIONS,
    eventTabs: EVENT_TABS,
    contactTabs: CONTACT_TABS,
    organizationTabs: ORGANIZATION_TABS,
    liveSections: [...MAVINCI_LIVE_SECTION_SCOPES],
    recordScopeModules: RECORD_SCOPE_MODULE_KEYS,
  };
}

export async function employeePermissions(ctx: NativeContext, employeeId: string) {
  const s = ctx.supabase;
  const [employee, companies, settings, sources, sourceSettings, teams] = await Promise.all([
    s.from('employees').select('updated_at, role, access_level, access_level_id, permissions, event_tabs, contact_tabs, organization_tabs, my_company_ids, company_access_mode, role_permissions_inherited, finance_company_access, sales_team_id, is_sales_team_manager, access_levels(name, default_permissions, event_tabs, contact_tabs, organization_tabs)')
      .eq('id', employeeId).maybeSingle(),
    s.from('my_companies').select('id, name, is_active').order('name'),
    s.from('employee_notification_settings')
      .select('contact_form_enabled, webhook_notifications_enabled, fleet_compliance_enabled, inquiry_assignments_enabled, inquiry_followups_enabled, inquiry_escalations_enabled')
      .eq('employee_id', employeeId).maybeSingle(),
    s.from('webhook_sources').select('id, name, slug, is_active').eq('is_active', true).order('name'),
    s.from('employee_webhook_notification_settings').select('source_id, is_enabled').eq('employee_id', employeeId),
    s.from('sales_teams').select('id, name').eq('is_active', true).order('name'),
  ]);
  for (const result of [employee, companies, settings, sources, sourceSettings, teams]) if (result.error) throw result.error;
  const e = employee.data as Row | null;
  if (!e) return null;
  const perms = strings(e.permissions);
  const isTargetAdmin = e.role === 'admin' || e.access_level === 'admin' || perms.includes('admin');
  const pack = one(e.access_levels) as Row | null;
  const n = (settings.data || {}) as Row;
  const saved = new Map((sourceSettings.data || []).map((row: Row) => [String(row.source_id), row.is_enabled === true]));
  return {
    updatedAt: e.updated_at || null,
    targetIsAdmin: e.role === 'admin',
    notificationDefaults: isTargetAdmin,
    permissions: perms,
    eventTabs: strings(e.event_tabs), contactTabs: strings(e.contact_tabs), organizationTabs: strings(e.organization_tabs),
    companyAccessMode: e.company_access_mode === 'selected' ? 'selected' : 'all',
    myCompanyIds: strings(e.my_company_ids),
    rolePermissionsInherited: e.role_permissions_inherited === true,
    financeCompanyAccess: normalizeFinanceCompanyAccess(e.finance_company_access),
    salesTeamId: e.sales_team_id || '',
    isSalesTeamManager: e.is_sales_team_manager === true,
    rolePackage: pack ? {
      name: text(pack.name), permissions: strings(pack.default_permissions), eventTabs: strings(pack.event_tabs),
      contactTabs: strings(pack.contact_tabs), organizationTabs: strings(pack.organization_tabs),
    } : null,
    companies: (companies.data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name), active: row.is_active !== false })),
    notifications: {
      contactForm: n.contact_form_enabled ?? isTargetAdmin, webhook: n.webhook_notifications_enabled ?? isTargetAdmin,
      fleet: n.fleet_compliance_enabled ?? isTargetAdmin, inquiryAssignments: n.inquiry_assignments_enabled ?? true,
      inquiryFollowups: n.inquiry_followups_enabled ?? true, inquiryEscalations: n.inquiry_escalations_enabled ?? true,
    },
    webhookSources: (sources.data || []).map((row: Row) => ({
      id: String(row.id), name: text(row.name), slug: text(row.slug), enabled: saved.get(String(row.id)) ?? isTargetAdmin,
    })),
    salesTeams: (teams.data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name) })),
    catalog: permissionCatalog(),
  };
}

/** Zapis jak `handleSave` w CRM: kontrola równoczesnej zmiany (`updated_at`), ustawienia powiadomień i źródeł webhooków. */
export async function savePermissions(ctx: NativeContext, employeeId: string, data: Row): Promise<{ error?: string; updatedAt?: string }> {
  const mode = data.companyAccessMode === 'selected' ? 'selected' : 'all';
  const companyIds = strings(data.myCompanyIds);
  if (mode === 'selected' && !companyIds.length) return { error: 'Wybierz przynajmniej jedną markę albo dostęp do wszystkich marek' };
  const { data: companies, error: companiesError } = await ctx.supabase.from('my_companies').select('id, is_active');
  if (companiesError) throw companiesError;
  const financeCompanies = new Set((companies || []).filter((row: Row) => row.is_active !== false && (mode === 'all' || companyIds.includes(String(row.id)))).map((row: Row) => String(row.id)));
  const finance = normalizeFinanceCompanyAccess(data.financeCompanyAccess);
  const tabs = (value: unknown) => (strings(value).length ? strings(value) : null);
  const loadedUpdatedAt = typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : null;
  const query = ctx.supabase.from('employees').update({
    permissions: strings(data.permissions).filter((permission) => !LEGACY_FINANCE_PERMISSIONS.includes(permission)),
    updated_at: new Date().toISOString(),
    event_tabs: tabs(data.eventTabs), contact_tabs: tabs(data.contactTabs), organization_tabs: tabs(data.organizationTabs),
    company_access_mode: mode,
    my_company_ids: mode === 'all' ? [] : companyIds,
    role_permissions_inherited: data.rolePermissionsInherited === true,
    sales_team_id: typeof data.salesTeamId === 'string' && data.salesTeamId ? data.salesTeamId : null,
    is_sales_team_manager: data.isSalesTeamManager === true,
    ...(ctx.employee.isAdmin ? {
      finance_company_access: Object.fromEntries(Object.entries(finance).filter(([id, level]) => level !== 'none' && financeCompanies.has(id))),
    } : {}),
  }).eq('id', employeeId);
  const { data: saved, error } = await (loadedUpdatedAt ? query.eq('updated_at', loadedUpdatedAt) : query.is('updated_at', null))
    .select('id,updated_at').maybeSingle();
  if (error) return { error: error.message || 'Błąd podczas zapisywania uprawnień' };
  if (!saved) return { error: 'Dane pracownika zmieniono w innym oknie. Odśwież uprawnienia przed zapisem.' };
  const n = (data.notifications || {}) as Row;
  const { error: settingsError } = await ctx.supabase.from('employee_notification_settings').upsert({
    employee_id: employeeId, contact_form_enabled: n.contactForm === true, webhook_notifications_enabled: n.webhook === true,
    fleet_compliance_enabled: n.fleet === true, inquiry_assignments_enabled: n.inquiryAssignments !== false,
    inquiry_followups_enabled: n.inquiryFollowups !== false, inquiry_escalations_enabled: n.inquiryEscalations !== false,
    updated_by: ctx.employee.id,
  });
  if (settingsError) return { error: settingsError.message || 'Błąd podczas zapisywania powiadomień', updatedAt: saved.updated_at };
  const sources = data.webhookSources && typeof data.webhookSources === 'object' ? Object.entries(data.webhookSources as Record<string, unknown>) : [];
  if (sources.length) {
    const { error: sourcesError } = await ctx.supabase.from('employee_webhook_notification_settings').upsert(
      sources.map(([sourceId, enabled]) => ({ employee_id: employeeId, source_id: sourceId, is_enabled: enabled === true, updated_by: ctx.employee.id })),
      { onConflict: 'employee_id,source_id' },
    );
    if (sourcesError) return { error: sourcesError.message || 'Błąd podczas zapisywania źródeł webhooków', updatedAt: saved.updated_at };
  }
  return { updatedAt: saved.updated_at };
}
