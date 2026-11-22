import 'server-only';
import { can, type NativeContext } from './auth';
import { invalidateContacts } from './contacts';
import {
  organizationFormPayload,
  validateOrganizationForm,
  type OrganizationFormValues,
} from '@/components/crm/contacts/organization/organizationValidation';
import { collectValidationErrors, personContactSchema } from '@/components/crm/contacts/contactValidation';

/*
 * Karta kontaktu i organizacji na Macu — to samo co `/crm/contacts/[id]` i `/crm/contacts/new`:
 * dane karty, osoby kontaktowe i organizacje kontaktu, reprezentanci i osoby decyzyjne, dane do faktury, lokalizacja,
 * szybkie notatki, faktury i realizacje, opiekun i etap relacji, segmentacja i komunikacja, domeny organizacji,
 * scalanie duplikatów oraz dodawanie organizacji, kontaktów i osób prywatnych. Tokenem pracownika — RLS, wyzwalacze
 * (opiekun, lokalizacja hotelu, nabywca faktur) i walidacja formularzy jak w przeglądarce.
 */

type Row = Record<string, any>;

export class CardFailure extends Error {
  constructor(message: string, public status = 400, public fieldErrors?: Record<string, string>, public extra?: Record<string, unknown>) {
    super(message);
  }
}
const fail = (message: string, status = 400, fieldErrors?: Record<string, string>, extra?: Record<string, unknown>): never => {
  throw new CardFailure(message, status, fieldErrors, extra);
};
const check = (error: { message?: string; code?: string } | null, fallback: string) => {
  if (!error) return;
  if (error.code === '42501') fail(error.message || 'Nie masz uprawnień do tej operacji.', 403);
  fail(error.message || fallback);
};

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const trimmed = (value: unknown) => text(value).trim();
const orNull = (value: unknown) => trimmed(value) || null;
const digits = (value: unknown) => text(value).replace(/\D/g, '');
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {});
const ids = (value: unknown) => Array.from(new Set((Array.isArray(value) ? value : []).map(String).filter((id) => uuid.test(id))));
const personName = (row: Row | null | undefined) =>
  text(row?.full_name) || `${text(row?.first_name)} ${text(row?.last_name)}`.trim() || '—';
const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

const LIFECYCLE = ['lead', 'prospect', 'customer', 'inactive', 'lost'];
const ORG_TABS = ['customer360', 'details', 'contacts', 'invoices', 'events', 'notes', 'history', 'services'];

/** Zakładki organizacji jak `fetchPermissions` karty w CRM (pracownik, poziom dostępu; zarządzanie kontaktami — wszystkie). */
async function organizationTabs(ctx: NativeContext) {
  if (ctx.employee.role === 'admin' || ctx.employee.isAdmin || ctx.employee.permissions.includes('contacts_manage')) return ORG_TABS;
  const { data } = await ctx.supabase.from('employees').select('organization_tabs, access_levels(organization_tabs)').eq('id', ctx.employee.id).maybeSingle();
  const row = object(data);
  let tabs: string[] = ['details'];
  if (Array.isArray(row.organization_tabs) && row.organization_tabs.length) tabs = row.organization_tabs.map(String);
  else {
    const level = object(one(row.access_levels));
    if (Array.isArray(level.organization_tabs)) tabs = level.organization_tabs.map(String);
  }
  return Array.from(new Set(['customer360', ...tabs]));
}

async function requireTab(ctx: NativeContext, tab: string) {
  if (!(await organizationTabs(ctx)).includes(tab)) fail('Nie masz dostępu do tej części karty organizacji.', 403);
}

function access(ctx: NativeContext) {
  return {
    canManage: can(ctx.employee, 'contacts_manage'),
    isAdmin: ctx.employee.isAdmin,
    canManageLocations: can(ctx.employee, 'locations_manage'),
    me: ctx.employee.id,
  };
}

/** Opiekunowie do wyboru (`list_customer_owner_candidates`) i nazwa zapisanego opiekuna, gdy jest spoza listy. */
async function owners(ctx: NativeContext, ownerId: string) {
  const { data, error } = await ctx.supabase.rpc('list_customer_owner_candidates');
  const list = error ? [] : ((data || []) as Row[]).map((row) => ({
    id: text(row.id), name: [text(row.name), text(row.surname)].filter(Boolean).join(' ') || 'Pracownik',
  }));
  let ownerName = list.find((row) => row.id === ownerId)?.name || '';
  if (ownerId && !ownerName) {
    const { data: person } = await ctx.supabase.from('employees').select('name,surname').eq('id', ownerId).maybeSingle();
    ownerName = [text(object(person).name), text(object(person).surname)].filter(Boolean).join(' ') || 'inna osoba';
  }
  return { owners: list, ownerName };
}

/** Segmentacja i komunikacja (`CustomerSegmentationPanel`): profil marketingowy, segmenty, przypisania; bez dostępu — null. */
async function segmentation(ctx: NativeContext, kind: 'contact' | 'organization', id: string) {
  const column = kind === 'contact' ? 'contact_id' : 'organization_id';
  const s = ctx.supabase;
  const [profile, segments, members] = await Promise.all([
    s.from('customer_marketing_profiles').select('*').eq(column, id).maybeSingle(),
    s.from('marketing_segments').select('id,name,slug,color,is_system').eq('is_active', true).order('name'),
    s.from('customer_marketing_segment_members').select('segment_id').eq(column, id),
  ]);
  if (profile.error || segments.error || members.error) return null;
  const p = object(profile.data);
  return {
    canEdit: can(ctx.employee, 'contacts_manage'),
    profile: {
      id: text(p.id),
      marketingStatus: text(p.marketing_status) || 'unknown',
      legalBasis: text(p.legal_basis) || 'none',
      deliverability: text(p.email_deliverability) || 'unknown',
      interests: Array.isArray(p.interests) ? p.interests.map(String) : [],
      eventTypes: Array.isArray(p.event_types) ? p.event_types.map(String) : [],
      regions: Array.isArray(p.regions) ? p.regions.map(String) : [],
      budgetMin: p.budget_min == null ? null : Number(p.budget_min),
      budgetMax: p.budget_max == null ? null : Number(p.budget_max),
      frequency: text(p.communication_frequency) || 'occasional',
      consentSource: text(p.consent_source),
      consentEvidence: text(p.consent_evidence),
      consentGrantedAt: text(p.consent_granted_at),
      consentWithdrawnAt: text(p.consent_withdrawn_at),
    },
    segments: ((segments.data || []) as Row[]).map((row) => ({ id: text(row.id), name: text(row.name), color: text(row.color), system: !!row.is_system })),
    selected: ((members.data || []) as Row[]).map((row) => text(row.segment_id)).filter(Boolean),
  };
}

const ORG_CARD = 'id,organization_type,business_type,name,alias,nip,legal_form,krs,regon,ksef_internal_id,address,city,postal_code,country,email,phone,website,status,rating,notes,location_id,primary_contact_id,legal_representative_id,legal_representative_title,contact_is_representative,representation_type,representation_rule,representation_basis,representation_verified_at,invoice_buyer_organization_id,invoice_recipient_role,owner_id,lifecycle_status,correspondence_domains,subcontractor_id,created_at';
const CONTACT_CARD = 'id,contact_type,first_name,last_name,full_name,email,phone,mobile,alternative_contact_name,business_phone,position,nip,pesel,id_number,event_type,event_details,address,city,postal_code,country,notes,status,owner_id,lifecycle_status,created_at';
const PERSON = 'id,first_name,last_name,full_name,position,email,phone,mobile';

const personOut = (row: Row | null) => (row ? {
  id: text(row.id), name: personName(row), position: text(row.position), email: text(row.email), phone: text(row.phone), mobile: text(row.mobile),
} : null);

/** Karta organizacji, kontaktu albo osoby prywatnej (`GET op=card`). */
export async function contactCard(ctx: NativeContext, kind: string, id: string) {
  if (!uuid.test(id)) fail('Nieprawidłowy kontakt.');
  const s = ctx.supabase;
  if (kind === 'organization') {
    const { data: found, error } = await s.from('organizations').select(ORG_CARD).eq('id', id).maybeSingle();
    check(error, 'Nie udało się pobrać organizacji.');
    if (!found) fail('Nie znaleziono organizacji lub nie masz do niej dostępu.', 404);
    const org = found as Row;
    const warnings: string[] = [];
    const soft = (result: { data: unknown; error: unknown }, label: string): Row[] => {
      if (result.error) { warnings.push(label); return []; }
      return Array.isArray(result.data) ? (result.data as Row[]) : [];
    };
    const representativeIds = [org.primary_contact_id, org.legal_representative_id].map(text).filter((value) => uuid.test(value));
    const [relations, makers, notes, invoices, events, units, buyer, location, representatives, tabs, people, marketing] = await Promise.all([
      s.from('contact_organizations').select(`id,position,is_primary,contact:contacts(${PERSON})`).eq('organization_id', id).eq('is_current', true),
      s.from('organization_decision_makers').select(`id,contact_id,title,can_sign_contracts,contact:contacts(${PERSON})`).eq('organization_id', id).order('created_at'),
      s.from('organization_notes').select('id,note,created_at,created_by,employees(name,surname)').eq('organization_id', id).order('created_at', { ascending: false }),
      s.from('invoices').select('id,invoice_number,status,issue_date,total_gross,total_net').eq('organization_id', id).order('issue_date', { ascending: false }),
      s.from('events').select('id,name,event_date,status').eq('organization_id', id).order('event_date', { ascending: false }),
      s.from('organizations').select('id,name,alias,invoice_recipient_role').eq('invoice_buyer_organization_id', id).order('name'),
      uuid.test(text(org.invoice_buyer_organization_id))
        ? s.from('organizations').select('id,name,alias,nip,city').eq('id', org.invoice_buyer_organization_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      uuid.test(text(org.location_id))
        ? s.from('locations').select('id,name,address,city,postal_code,country,formatted_address').eq('id', org.location_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      representativeIds.length
        ? s.from('contacts').select(PERSON).in('id', representativeIds)
        : Promise.resolve({ data: [] as Row[], error: null }),
      organizationTabs(ctx),
      owners(ctx, text(org.owner_id)),
      segmentation(ctx, 'organization', id),
    ]);
    if (relations.error) check(relations.error, 'Nie udało się pobrać osób kontaktowych.');
    if (makers.error) check(makers.error, 'Nie udało się pobrać osób decyzyjnych.');
    const byId = new Map(((representatives.data || []) as Row[]).map((row) => [text(row.id), row]));
    const loc = object(location.data);
    const buyerRow = object(buyer.data);
    return {
      kind: 'organization', id, access: access(ctx), tabs, warnings,
      organization: {
        id, organizationType: text(org.organization_type), businessType: text(org.business_type) || 'company', name: text(org.name),
        alias: text(org.alias), nip: text(org.nip), legalForm: text(org.legal_form), krs: text(org.krs), regon: text(org.regon),
        ksefInternalId: text(org.ksef_internal_id), address: text(org.address), city: text(org.city), postalCode: text(org.postal_code),
        country: text(org.country), email: text(org.email), phone: text(org.phone), website: text(org.website),
        status: text(org.status) || 'active', rating: org.rating == null ? null : Number(org.rating), notes: text(org.notes),
        locationId: text(org.location_id), primaryContactId: text(org.primary_contact_id),
        legalRepresentativeId: text(org.legal_representative_id), legalRepresentativeTitle: text(org.legal_representative_title),
        contactIsRepresentative: !!org.contact_is_representative, representationType: text(org.representation_type),
        representationRule: text(org.representation_rule), representationBasis: text(org.representation_basis),
        representationVerifiedAt: text(org.representation_verified_at).slice(0, 10),
        invoiceBuyerId: text(org.invoice_buyer_organization_id),
        invoiceRecipientRole: org.invoice_recipient_role == null ? null : Number(org.invoice_recipient_role),
        ownerId: text(org.owner_id), lifecycle: text(org.lifecycle_status) || 'lead',
        domains: Array.isArray(org.correspondence_domains) ? org.correspondence_domains.map(String) : [],
        subcontractorId: text(org.subcontractor_id), createdAt: text(org.created_at),
      },
      persons: ((relations.data || []) as Row[]).map((row) => {
        const contact = object(one(row.contact));
        return {
          relationId: text(row.id), id: text(contact.id), name: personName(contact),
          position: trimmed(row.position) || text(contact.position), email: text(contact.email), phone: text(contact.phone),
          mobile: text(contact.mobile), primary: !!row.is_primary,
        };
      }).filter((row) => row.id),
      decisionMakers: ((makers.data || []) as Row[]).map((row) => {
        const contact = object(one(row.contact));
        return { id: text(row.id), contactId: text(row.contact_id), name: contact.id ? personName(contact) : 'Nieznany kontakt', title: text(row.title), canSign: !!row.can_sign_contracts, email: text(contact.email) };
      }),
      primaryContact: personOut(byId.get(text(org.primary_contact_id)) || null),
      legalRepresentative: personOut(byId.get(text(org.legal_representative_id)) || null),
      notes: soft(notes, 'notatki').map((row) => {
        const author = object(one(row.employees));
        return {
          id: text(row.id), note: text(row.note), createdAt: text(row.created_at),
          author: [text(author.name), text(author.surname)].filter(Boolean).join(' '),
          own: text(row.created_by) === ctx.employee.id || text(row.created_by) === ctx.employee.authUserId,
        };
      }),
      invoices: soft(invoices, 'faktury').map((row) => ({
        id: text(row.id), number: text(row.invoice_number), status: text(row.status), issueDate: text(row.issue_date),
        gross: Number(row.total_gross || 0), net: Number(row.total_net || 0),
      })),
      events: soft(events, 'realizacje').map((row) => ({
        id: text(row.id), name: text(row.name) || 'Event', date: text(row.event_date), status: text(row.status),
      })),
      units: soft(units, 'jednostki rozliczane na organizację').map((row) => ({
        id: text(row.id), name: text(row.alias) || text(row.name), role: Number(row.invoice_recipient_role) === 2 ? 2 : 8,
      })),
      buyer: buyerRow.id ? { id: text(buyerRow.id), name: text(buyerRow.alias) || text(buyerRow.name), nip: text(buyerRow.nip), city: text(buyerRow.city) } : null,
      location: loc.id ? {
        id: text(loc.id), name: text(loc.name) || text(loc.formatted_address) || 'Lokalizacja',
        address: [text(loc.address), [text(loc.postal_code), text(loc.city)].filter(Boolean).join(' '), text(loc.country)].filter(Boolean).join(', ') || text(loc.formatted_address),
      } : null,
      locationMissing: !!org.location_id && !loc.id,
      owners: people.owners, ownerName: people.ownerName, marketing,
    };
  }

  const { data: found, error } = await s.from('contacts').select(CONTACT_CARD).eq('id', id).in('contact_type', ['contact', 'individual']).maybeSingle();
  check(error, 'Nie udało się pobrać kontaktu.');
  if (!found) fail('Nie znaleziono kontaktu lub nie masz do niego dostępu.', 404);
  const contact = found as Row;
  const [relations, people, marketing] = await Promise.all([
    s.from('contact_organizations').select('id,position,is_primary,organization:organizations(id,name,alias)').eq('contact_id', id).eq('is_current', true),
    owners(ctx, text(contact.owner_id)),
    segmentation(ctx, 'contact', id),
  ]);
  check(relations.error, 'Nie udało się pobrać organizacji kontaktu.');
  return {
    kind: contact.contact_type === 'individual' ? 'individual' : 'contact', id, access: access(ctx), tabs: [], warnings: [],
    contact: {
      id, kind: contact.contact_type === 'individual' ? 'individual' : 'contact', firstName: text(contact.first_name),
      lastName: text(contact.last_name), name: personName(contact), email: text(contact.email), phone: text(contact.phone),
      mobile: text(contact.mobile), alternativeContact: text(contact.alternative_contact_name), businessPhone: text(contact.business_phone),
      position: text(contact.position), nip: text(contact.nip), pesel: text(contact.pesel), idNumber: text(contact.id_number),
      eventType: text(contact.event_type), eventDetails: text(contact.event_details), address: text(contact.address),
      city: text(contact.city), postalCode: text(contact.postal_code), country: text(contact.country), notes: text(contact.notes),
      status: text(contact.status), ownerId: text(contact.owner_id), lifecycle: text(contact.lifecycle_status) || 'lead',
      createdAt: text(contact.created_at),
    },
    organizations: ((relations.data || []) as Row[]).map((row) => {
      const organization = object(one(row.organization));
      return { relationId: text(row.id), id: text(organization.id), name: text(organization.alias) || text(organization.name), position: text(row.position), primary: !!row.is_primary };
    }).filter((row) => row.id),
    owners: people.owners, ownerName: people.ownerName, marketing,
  };
}

/** Organizacje, na które można wystawiać faktury za inną (`OrganizationInvoiceBuyerSection`): klienci. */
export async function invoiceBuyers(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('organizations')
    .select('id,name,alias,nip,city,invoice_buyer_organization_id').eq('organization_type', 'client').order('name');
  check(error, 'Nie udało się wczytać organizacji. Spróbuj ponownie.');
  return {
    buyers: ((data || []) as Row[]).map((row) => ({
      id: text(row.id), name: text(row.name), alias: text(row.alias), nip: text(row.nip), city: text(row.city),
      buyerId: text(row.invoice_buyer_organization_id),
    })),
  };
}

/** Wyszukiwanie lokalizacji jak `OrganizationLocationPicker` (min. 2 znaki, 20 wyników). */
export async function searchLocations(ctx: NativeContext, query: string) {
  const q = query.trim();
  if (q.length < 2) return { locations: [] };
  const value = `"${`%${q}%`.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const { data, error } = await ctx.supabase.from('locations')
    .select('id,name,address,city,postal_code,country,formatted_address')
    .or(`name.ilike.${value},address.ilike.${value},city.ilike.${value},formatted_address.ilike.${value}`)
    .order('name', { ascending: true }).limit(20);
  check(error, 'Nie udało się pobrać lokalizacji');
  return {
    locations: ((data || []) as Row[]).map((row) => ({
      id: text(row.id), name: text(row.name) || text(row.formatted_address) || '—',
      address: [text(row.address), text(row.postal_code), text(row.city), text(row.country)].filter(Boolean).join(', ') || text(row.formatted_address),
    })),
  };
}

// MARK: Zapis danych karty

/** Pola organizacji zapisywane z formularza (dodawanie i edycja — `OrganizationFormFields`, dane do faktury, lokalizacja, reprezentacja). */
const ORG_EDIT_KEYS = ['name', 'alias', 'business_type', 'legal_form', 'nip', 'krs', 'regon', 'ksef_internal_id', 'email', 'phone', 'website',
  'address', 'city', 'postal_code', 'country', 'rating', 'status', 'notes', 'location_id', 'invoice_buyer_organization_id', 'invoice_recipient_role',
  'primary_contact_id', 'legal_representative_id', 'legal_representative_title', 'contact_is_representative', 'representation_type',
  'representation_rule', 'representation_basis', 'representation_verified_at'];
const REPRESENTATION_TYPES = ['sole', 'joint', 'joint_with_proxy', 'proxy', 'other'];

function representationErrors(values: Row) {
  const errors: Record<string, string> = {};
  for (const key of ['primary_contact_id', 'legal_representative_id', 'location_id', 'invoice_buyer_organization_id']) {
    const value = values[key];
    if (value != null && value !== '' && !uuid.test(String(value))) errors[key] = 'Wybierz pozycję z listy.';
  }
  const type = values.representation_type;
  if (type != null && type !== '' && !REPRESENTATION_TYPES.includes(String(type))) errors.representation_type = 'Wybierz sposób reprezentacji z listy.';
  const verified = values.representation_verified_at;
  if (verified != null && verified !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(verified))) errors.representation_verified_at = 'Podaj datę sprawdzenia.';
  return errors;
}

/** Kolumny reprezentacji z poprawionych danych formularza (jak `handleSave` i dodawanie organizacji w CRM). */
const representationPayload = (values: OrganizationFormValues) => ({
  primary_contact_id: values.primary_contact_id || null,
  legal_representative_id: values.legal_representative_id || null,
  legal_representative_title: values.legal_representative_title || null,
  contact_is_representative: values.contact_is_representative ?? null,
  representation_type: values.representation_type || null,
  representation_rule: values.representation_rule || null,
  representation_basis: values.representation_basis || null,
  representation_verified_at: values.representation_verified_at || null,
});

/** Edycja organizacji: wszystkie pola formularza CRM z tą samą walidacją (`validateOrganizationForm`). */
export async function updateOrganization(ctx: NativeContext, id: string, data: Row) {
  const { data: current, error: readError } = await ctx.supabase.from('organizations').select('*').eq('id', id).maybeSingle();
  check(readError, 'Nie udało się pobrać organizacji.');
  if (!current) fail('Nie znaleziono organizacji lub nie masz do niej dostępu.', 404);
  const edits: Row = Object.fromEntries(ORG_EDIT_KEYS.filter((key) => key in data).map((key) => [key, data[key] === '' ? null : data[key]]));
  const merged = { ...(current as Row), ...edits };
  const extra = representationErrors(merged);
  const { isValid, validatedData, errors } = await validateOrganizationForm(merged as never);
  if (!isValid || !validatedData || Object.keys(extra).length) {
    fail('Popraw wymagane pola formularza', 400, { ...(errors as Record<string, string>), ...extra });
  }
  const values = validatedData as OrganizationFormValues;
  const notes = 'notes' in edits ? orNull(edits.notes) : (current as Row).notes ?? null;
  const { data: saved, error } = await ctx.supabase.from('organizations')
    .update({ ...organizationFormPayload(values), ...representationPayload(values), notes, updated_at: new Date().toISOString() } as never)
    .eq('id', id).select('id');
  check(error, 'Błąd podczas zapisywania');
  if (!saved?.length) fail('Nie masz uprawnień do zmiany tej organizacji.', 403);
  invalidateContacts();
  return { ok: true, message: 'Dane zaktualizowane' };
}

const PERSON_FIELD = { firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', mobile: 'mobile', businessPhone: 'business_phone', nip: 'nip', postalCode: 'postal_code' } as Record<string, string>;
const personErrors = (values: Row) => Object.fromEntries(
  Object.entries(collectValidationErrors(personContactSchema, values)).map(([key, message]) => [PERSON_FIELD[key] || key, message]),
);

/** Kontakt istniejący z tym samym e-mailem, telefonem lub NIP-em (`findExistingContact` w CRM). */
async function existingContact(ctx: NativeContext, values: { email: string; phone: string; mobile: string; businessPhone: string; nip: string }) {
  const conditions: string[] = [];
  if (values.email) conditions.push(`email.ilike."${values.email.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`);
  for (const phone of [values.phone, values.mobile, values.businessPhone]) {
    if (phone) conditions.push(`phone.eq.${phone}`, `mobile.eq.${phone}`, `business_phone.eq.${phone}`);
  }
  if (values.nip) conditions.push(`nip.eq.${values.nip}`);
  if (!conditions.length) return null;
  const { data, error } = await ctx.supabase.from('contacts').select('id,full_name,first_name,last_name').or(conditions.join(',')).limit(1).maybeSingle();
  check(error, 'Nie udało się sprawdzić, czy kontakt już istnieje.');
  return data as Row | null;
}

/** Nowa organizacja, kontakt albo osoba prywatna (`/crm/contacts/new`, `handleSubmit`). */
export async function createEntity(ctx: NativeContext, body: Row) {
  const kind = text(body.kind);
  const data = object(body.data);
  const warnings: string[] = [];
  if (kind === 'organization') {
    const values: Row = {
      name: text(data.name), alias: text(data.alias), business_type: text(data.business_type) || 'company', nip: text(data.nip),
      legal_form: text(data.legal_form), krs: text(data.krs), regon: text(data.regon), address: text(data.address), city: text(data.city),
      postal_code: text(data.postal_code), country: text(data.country) || 'Polska', email: text(data.email), phone: text(data.phone),
      website: text(data.website), location_id: text(data.location_id), representation_type: text(data.representation_type) || null,
      representation_rule: text(data.representation_rule), representation_basis: text(data.representation_basis),
      representation_verified_at: text(data.representation_verified_at), legal_representative_id: text(data.legal_representative_id) || null,
      legal_representative_title: text(data.legal_representative_title), ksef_internal_id: text(data.ksef_internal_id),
      rating: data.rating == null || data.rating === '' ? null : Number(data.rating), status: text(data.status) || 'active',
      invoice_buyer_organization_id: text(data.invoice_buyer_organization_id) || null,
      invoice_recipient_role: data.invoice_recipient_role == null || data.invoice_recipient_role === '' ? null : Number(data.invoice_recipient_role),
    };
    const extra = representationErrors(values);
    const { isValid, validatedData, errors } = await validateOrganizationForm(values as never);
    if (!isValid || !validatedData || Object.keys(extra).length) fail('Popraw pola oznaczone na czerwono.', 400, { ...(errors as Record<string, string>), ...extra });
    const organization = validatedData as OrganizationFormValues;
    const { data: created, error } = await ctx.supabase.from('organizations').insert([{
      organization_type: 'client',
      ...organizationFormPayload(organization),
      representation_type: organization.representation_type || null,
      representation_rule: organization.representation_rule || null,
      representation_basis: organization.representation_basis || null,
      representation_verified_at: organization.representation_verified_at || null,
      legal_representative_id: organization.legal_representative_id || null,
      legal_representative_title: organization.legal_representative_title || null,
      google_maps_url: null, latitude: null, longitude: null, location_notes: null,
      notes: orNull(data.notes), specialization: null, hourly_rate: null,
    }] as never).select('id').single();
    check(error, 'Błąd podczas dodawania organizacji');
    const id = text(object(created).id);
    const signers = ids(body.signers);
    const linked = Array.from(new Set([...ids(body.contacts), ...signers, ...(organization.legal_representative_id ? [String(organization.legal_representative_id)] : [])]));
    if (linked.length) {
      const { error: linkError } = await ctx.supabase.from('contact_organizations')
        .insert(linked.map((contactId) => ({ contact_id: contactId, organization_id: id, is_current: true })));
      if (linkError) warnings.push('Organizacja została zapisana, ale nie udało się powiązać osób kontaktowych. Dodaj je w karcie organizacji.');
    }
    const extraSigners = signers.filter((contactId) => contactId !== organization.legal_representative_id);
    if (extraSigners.length) {
      const { data: positions } = await ctx.supabase.from('contacts').select('id,position').in('id', extraSigners);
      const titles = new Map(((positions || []) as Row[]).map((row) => [text(row.id), text(row.position)]));
      const { error: signerError } = await ctx.supabase.from('organization_decision_makers').insert(extraSigners.map((contactId) => ({
        organization_id: id, contact_id: contactId, can_sign_contracts: true, title: titles.get(contactId) || null,
      })));
      if (signerError) warnings.push('Organizacja została zapisana, ale nie udało się zapisać dodatkowych reprezentantów. Uzupełnij ich w szczegółach organizacji.');
    }
    invalidateContacts();
    return { ok: true, id, kind: 'organization', message: 'Organizacja dodana pomyślnie', warnings };
  }

  if (kind !== 'contact' && kind !== 'individual') fail('Wybierz typ kontaktu.');
  const person = {
    firstName: text(data.first_name), lastName: text(data.last_name), email: text(data.email), phone: text(data.phone),
    mobile: text(data.mobile), businessPhone: kind === 'contact' ? text(data.business_phone) : '', nip: kind === 'contact' ? text(data.nip) : '',
    postalCode: text(data.postal_code),
  };
  const errors = personErrors(person);
  if (Object.keys(errors).length) fail('Popraw pola oznaczone na czerwono.', 400, errors);
  const normalized = {
    email: person.email.trim().toLowerCase(), phone: digits(person.phone), mobile: digits(person.mobile),
    businessPhone: digits(person.businessPhone), nip: digits(person.nip),
  };
  const duplicate = await existingContact(ctx, normalized);
  if (duplicate) fail(`Taki kontakt prawdopodobnie już istnieje: ${personName(duplicate)}`, 409, undefined, { existingId: text(duplicate.id) });
  const row: Row = {
    contact_type: kind, first_name: person.firstName.trim(), last_name: person.lastName.trim(), email: normalized.email || null,
    phone: normalized.phone || null, mobile: normalized.mobile || null, city: orNull(data.city), address: orNull(data.address),
    postal_code: orNull(data.postal_code), notes: orNull(data.notes), status: 'active', created_by: ctx.employee.id,
  };
  if (kind === 'contact') {
    row.nip = normalized.nip || null;
    row.position = orNull(data.position);
    row.business_phone = normalized.businessPhone || null;
  } else {
    if (trimmed(data.alternative_contact_name)) row.alternative_contact_name = trimmed(data.alternative_contact_name);
    row.pesel = orNull(data.pesel);
    row.id_number = orNull(data.id_number);
    row.event_type = orNull(data.event_type);
    row.event_details = orNull(data.event_details);
  }
  const { data: created, error } = await ctx.supabase.from('contacts').insert([row]).select('id').single();
  check(error, 'Błąd podczas dodawania kontaktu');
  const id = text(object(created).id);
  const organizationId = text(body.organizationId);
  if (kind === 'contact' && uuid.test(organizationId)) {
    const { error: linkError } = await ctx.supabase.from('contact_organizations')
      .insert({ contact_id: id, organization_id: organizationId, position: orNull(data.position), is_current: true });
    if (linkError) warnings.push('Kontakt został dodany, ale nie udało się powiązać go z organizacją. Zrób to w karcie organizacji.');
  }
  invalidateContacts();
  return { ok: true, id, kind, message: kind === 'contact' ? 'Kontakt dodany pomyślnie' : 'Osoba prywatna dodana pomyślnie', warnings };
}

/** Osoba kontaktowa utworzona od razu (formularz nowej organizacji: nowa osoba albo reprezentant z rejestru). */
export async function quickContact(ctx: NativeContext, data: Row) {
  const errors = personErrors({ firstName: text(data.first_name), lastName: text(data.last_name), email: text(data.email), phone: text(data.phone), mobile: text(data.mobile) });
  if (Object.keys(errors).length) fail('Popraw dane osoby kontaktowej.', 400, errors);
  const { data: created, error } = await ctx.supabase.from('contacts').insert({
    contact_type: 'contact', first_name: trimmed(data.first_name), last_name: trimmed(data.last_name), email: orNull(data.email),
    phone: orNull(data.phone), mobile: orNull(data.mobile), position: orNull(data.position), status: 'active', created_by: ctx.employee.id,
  }).select('id,first_name,last_name,full_name,position,email').single();
  check(error, 'Nie udało się utworzyć kontaktu.');
  invalidateContacts();
  const row = object(created);
  return { ok: true, id: text(row.id), name: personName(row), position: text(row.position), email: text(row.email) };
}

// MARK: Powiązania, reprezentanci, notatki

export async function linkContact(ctx: NativeContext, body: Row) {
  const organizationId = text(body.organizationId), contactId = text(body.contactId);
  if (!uuid.test(organizationId) || !uuid.test(contactId)) fail('Wybierz osobę i organizację.');
  await requireTab(ctx, 'contacts');
  const { data: existing, error: readError } = await ctx.supabase.from('contact_organizations').select('id')
    .eq('organization_id', organizationId).eq('contact_id', contactId).eq('is_current', true).limit(1);
  check(readError, 'Nie udało się sprawdzić powiązania.');
  if (existing?.length) fail('Ta osoba jest już powiązana z tą organizacją.');
  const { error } = await ctx.supabase.from('contact_organizations').insert({
    contact_id: contactId, organization_id: organizationId, position: orNull(body.position), is_current: true,
  });
  check(error, 'Błąd podczas przypisywania');
  invalidateContacts();
  return { ok: true, message: 'Osoba kontaktowa przypisana do organizacji' };
}

export async function linkNewContact(ctx: NativeContext, body: Row) {
  const organizationId = text(body.organizationId);
  if (!uuid.test(organizationId)) fail('Nieprawidłowa organizacja.');
  await requireTab(ctx, 'contacts');
  const data = object(body.data);
  if (!trimmed(data.first_name) || !trimmed(data.last_name)) fail('Wprowadź imię i nazwisko', 400, { first_name: 'Imię jest wymagane', last_name: 'Nazwisko jest wymagane' });
  const errors = personErrors({ firstName: text(data.first_name), lastName: text(data.last_name), email: text(data.email), phone: text(data.phone), mobile: text(data.mobile) });
  if (Object.keys(errors).length) fail('Popraw dane osoby kontaktowej.', 400, errors);
  const { data: created, error } = await ctx.supabase.from('contacts').insert({
    first_name: trimmed(data.first_name), last_name: trimmed(data.last_name), email: orNull(data.email), phone: orNull(data.phone),
    mobile: orNull(data.mobile), contact_type: 'contact', status: 'active', created_by: ctx.employee.id,
  }).select('id').single();
  check(error, 'Błąd podczas dodawania');
  const { error: relationError } = await ctx.supabase.from('contact_organizations').insert({
    contact_id: text(object(created).id), organization_id: organizationId, position: orNull(data.position), is_primary: !!data.primary, is_current: true,
  });
  invalidateContacts();
  if (relationError) fail(`Kontakt utworzono, ale nie udało się powiązać go z organizacją: ${relationError.message || 'błąd'}. Przypisz go z listy.`);
  return { ok: true, id: text(object(created).id), message: 'Osoba kontaktowa dodana' };
}

export async function unlinkContact(ctx: NativeContext, relationId: string) {
  if (!uuid.test(relationId)) fail('Nieprawidłowe powiązanie.');
  await requireTab(ctx, 'contacts');
  const { data, error } = await ctx.supabase.from('contact_organizations').delete().eq('id', relationId).select('id');
  check(error, 'Błąd podczas usuwania');
  if (!data?.length) fail('Nie znaleziono powiązania albo nie masz uprawnień do jego usunięcia.', 404);
  invalidateContacts();
  return { ok: true, message: 'Powiązanie usunięte' };
}

/** Osoby decyzyjne i dodatkowi reprezentanci (`OrganizationRepresentatives`): dodanie, usunięcie, prawo do podpisu. */
export async function decisionMaker(ctx: NativeContext, body: Row) {
  await requireTab(ctx, 'details');
  const action = text(body.action);
  if (action === 'add') {
    const organizationId = text(body.organizationId), contactId = text(body.contactId);
    if (!uuid.test(organizationId) || !uuid.test(contactId)) fail('Wybierz osobę.');
    const { data: existing } = await ctx.supabase.from('organization_decision_makers').select('id').eq('organization_id', organizationId).eq('contact_id', contactId).limit(1);
    if (existing?.length) fail('Ta osoba jest już na liście osób decyzyjnych.');
    const { error } = await ctx.supabase.from('organization_decision_makers').insert({
      organization_id: organizationId, contact_id: contactId, title: orNull(body.title), can_sign_contracts: !!body.canSign,
    });
    check(error, 'Błąd podczas dodawania osoby decyzyjnej');
    return { ok: true, message: 'Osoba decyzyjna dodana' };
  }
  const id = text(body.id);
  if (!uuid.test(id)) fail('Nieprawidłowa osoba decyzyjna.');
  if (action === 'remove') {
    const { data, error } = await ctx.supabase.from('organization_decision_makers').delete().eq('id', id).select('id');
    check(error, 'Błąd podczas usuwania osoby decyzyjnej');
    if (!data?.length) fail('Nie znaleziono osoby decyzyjnej.', 404);
    return { ok: true, message: 'Osoba decyzyjna usunięta' };
  }
  if (action === 'sign') {
    const canSign = !!body.canSign;
    const { data, error } = await ctx.supabase.from('organization_decision_makers').update({ can_sign_contracts: canSign }).eq('id', id).select('id');
    check(error, 'Nie udało się zmienić uprawnienia do podpisu');
    if (!data?.length) fail('Nie znaleziono osoby decyzyjnej.', 404);
    return { ok: true, message: canSign ? 'Osoba została oznaczona jako uprawniona do podpisu' : 'Usunięto uprawnienie do podpisu' };
  }
  return fail('Nieznana operacja.');
}

/** Szybkie notatki organizacji (`organization_notes`). */
export async function organizationNote(ctx: NativeContext, body: Row) {
  await requireTab(ctx, 'notes');
  if (text(body.action) === 'add') {
    const organizationId = text(body.organizationId);
    const note = trimmed(body.note);
    if (!uuid.test(organizationId)) fail('Nieprawidłowa organizacja.');
    if (!note) fail('Wprowadź treść notatki');
    if (note.length > 5000) fail('Notatka może mieć najwyżej 5000 znaków.');
    const { error } = await ctx.supabase.from('organization_notes').insert({ organization_id: organizationId, note, created_by: ctx.employee.id });
    check(error, 'Błąd podczas dodawania notatki');
    return { ok: true, message: 'Notatka dodana' };
  }
  const id = text(body.id);
  if (!uuid.test(id)) fail('Nieprawidłowa notatka.');
  const { data, error } = await ctx.supabase.from('organization_notes').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania');
  if (!data?.length) fail('Możesz usunąć tylko własne notatki (pozostałe — administrator).', 403);
  return { ok: true, message: 'Notatka usunięta' };
}

// MARK: Relacja z klientem

/** Opiekun i etap relacji (`Customer360Panel`, `Organization360Panel`) — reguły wymusza baza (`protect_customer360_responsibility`). */
export async function saveOwnership(ctx: NativeContext, body: Row) {
  const id = text(body.id);
  const table = text(body.kind) === 'organization' ? 'organizations' : 'contacts';
  if (!uuid.test(id)) fail('Nieprawidłowy kontakt.');
  const ownerId = text(body.ownerId);
  if (ownerId && !uuid.test(ownerId)) fail('Wybierz opiekuna z listy.');
  const lifecycle = text(body.lifecycle);
  if (!LIFECYCLE.includes(lifecycle)) fail('Wybierz etap relacji z listy.');
  const { data: current, error: readError } = await ctx.supabase.from(table).select('owner_id,lifecycle_status').eq('id', id).maybeSingle();
  check(readError, 'Nie udało się pobrać danych klienta.');
  if (!current) fail('Nie znaleziono klienta lub nie masz do niego dostępu.', 404);
  const update: Row = {};
  if (text((current as Row).owner_id) !== ownerId) update.owner_id = ownerId || null;
  if (text((current as Row).lifecycle_status) !== lifecycle) update.lifecycle_status = lifecycle;
  if (!Object.keys(update).length) return { ok: true, message: 'Bez zmian' };
  const { data, error } = await ctx.supabase.from(table).update(update).eq('id', id).select('id');
  check(error, 'Nie udało się zapisać opiekuna');
  if (!data?.length) fail('Nie masz uprawnień do zmiany tego klienta.', 403);
  invalidateContacts();
  return { ok: true, message: 'Opiekun i etap relacji zostały zapisane' };
}

/** Domeny e-mail organizacji (`Organization360Panel.saveDomains`) — sama domena, bez „www.”. */
export async function saveDomains(ctx: NativeContext, body: Row) {
  const id = text(body.organizationId);
  if (!uuid.test(id)) fail('Nieprawidłowa organizacja.');
  let values: string[];
  try {
    values = [...new Set(text(body.domains).split(/[\s,;]+/).filter(Boolean).map((value) => {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Niepoprawny adres');
      const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      if (domain.length > 253 || !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Niepoprawna domena');
      return domain;
    }))];
  } catch {
    return fail('Nie rozpoznano domeny. Wpisz np. firma.pl lub wklej adres https://www.firma.pl/. Kolejne adresy oddziel przecinkiem.');
  }
  const { data, error } = await ctx.supabase.from('organizations').update({ correspondence_domains: values }).eq('id', id).select('id');
  check(error, 'Nie udało się zapisać domen organizacji');
  if (!data?.length) fail('Nie masz uprawnień do zmiany tej organizacji.', 403);
  return { ok: true, domains: values, message: 'Domeny organizacji zostały zapisane' };
}

const MARKETING_STATUS = ['unknown', 'subscribed', 'unsubscribed', 'objected'];
const LEGAL_BASIS = ['none', 'consent', 'legitimate_interest', 'existing_customer'];
const DELIVERABILITY = ['unknown', 'valid', 'bounced', 'invalid'];
const FREQUENCY = ['important_only', 'occasional', 'monthly', 'weekly'];
const list = (value: unknown) => Array.from(new Set((Array.isArray(value) ? value : []).map((item) => trimmed(item)).filter(Boolean)));
const amount = (value: unknown) => (value == null || value === '' ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : NaN);

/** Segmentacja i preferencje komunikacji (`CustomerSegmentationPanel.save`). */
export async function saveSegmentation(ctx: NativeContext, body: Row) {
  if (!can(ctx.employee, 'contacts_manage')) fail('Segmentację zmienia osoba zarządzająca kontaktami.', 403);
  const id = text(body.id);
  const column = text(body.kind) === 'organization' ? 'organization_id' : 'contact_id';
  if (!uuid.test(id)) fail('Nieprawidłowy kontakt.');
  const p = object(body.profile);
  const marketingStatus = text(p.marketingStatus), legalBasis = text(p.legalBasis), deliverability = text(p.deliverability), frequency = text(p.frequency);
  if (!MARKETING_STATUS.includes(marketingStatus) || !LEGAL_BASIS.includes(legalBasis) || !DELIVERABILITY.includes(deliverability) || !FREQUENCY.includes(frequency)) {
    fail('Wybierz wartości z list.');
  }
  if (marketingStatus === 'subscribed' && legalBasis === 'none') fail('Wskaż podstawę prawną komunikacji marketingowej');
  const grantedAt = trimmed(p.consentGrantedAt) || null;
  if (marketingStatus === 'subscribed' && legalBasis === 'consent' && !grantedAt) fail('Dla zgody podaj datę jej udzielenia');
  if (grantedAt && Number.isNaN(Date.parse(grantedAt))) fail('Podaj poprawną datę zgody.');
  const budgetMin = amount(p.budgetMin), budgetMax = amount(p.budgetMax);
  if (Number.isNaN(budgetMin) || Number.isNaN(budgetMax)) fail('Budżet musi być liczbą nieujemną.');
  const withdrawn = ['unsubscribed', 'objected'].includes(marketingStatus) ? trimmed(p.consentWithdrawnAt) || new Date().toISOString() : null;
  const payload = {
    [column]: id, marketing_status: marketingStatus, legal_basis: legalBasis, email_deliverability: deliverability,
    interests: list(p.interests), event_types: list(p.eventTypes), regions: list(p.regions), budget_min: budgetMin, budget_max: budgetMax,
    communication_frequency: frequency, consent_source: orNull(p.consentSource), consent_evidence: orNull(p.consentEvidence),
    consent_granted_at: grantedAt, consent_withdrawn_at: withdrawn,
  };
  const { data: existing, error: readError } = await ctx.supabase.from('customer_marketing_profiles').select('id').eq(column, id).maybeSingle();
  check(readError, 'Nie udało się zapisać profilu marketingowego');
  const profileId = text(object(existing).id);
  const saved = profileId
    ? await ctx.supabase.from('customer_marketing_profiles').update(payload).eq('id', profileId).select('id').single()
    : await ctx.supabase.from('customer_marketing_profiles').insert(payload).select('id').single();
  check(saved.error, 'Nie udało się zapisać profilu marketingowego');

  const selected = ids(body.segments);
  const { data: members, error: membersError } = await ctx.supabase.from('customer_marketing_segment_members').select('id,segment_id').eq(column, id);
  check(membersError, 'Nie udało się zapisać segmentów');
  const current = new Set(((members || []) as Row[]).map((member) => text(member.segment_id)));
  const wanted = new Set(selected);
  const remove = ((members || []) as Row[]).filter((member) => !wanted.has(text(member.segment_id))).map((member) => text(member.id));
  const add = selected.filter((segmentId) => !current.has(segmentId));
  if (remove.length) {
    const { error } = await ctx.supabase.from('customer_marketing_segment_members').delete().in('id', remove);
    check(error, 'Nie udało się zapisać segmentów');
  }
  if (add.length) {
    const { error } = await ctx.supabase.from('customer_marketing_segment_members')
      .insert(add.map((segmentId) => ({ segment_id: segmentId, [column]: id, assignment_source: 'manual' })));
    check(error, 'Nie udało się zapisać segmentów');
  }
  return { ok: true, message: 'Segmentacja i preferencje zostały zapisane' };
}

/** Nowy segment (`CustomerSegmentationPanel.addSegment`). */
export async function createSegment(ctx: NativeContext, body: Row) {
  if (!can(ctx.employee, 'contacts_manage')) fail('Segmenty tworzy osoba zarządzająca kontaktami.', 403);
  const name = trimmed(body.name);
  const slug = name.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!name || !slug) fail('Wpisz nazwę segmentu.');
  if (name.length > 120) fail('Nazwa segmentu może mieć najwyżej 120 znaków.');
  const { data, error } = await ctx.supabase.from('marketing_segments').insert({ name, slug }).select('id,name,color,is_system').single();
  check(error, 'Nie udało się utworzyć segmentu');
  const row = object(data);
  return { ok: true, segment: { id: text(row.id), name: text(row.name), color: text(row.color), system: !!row.is_system } };
}

/** Scalanie duplikatów kontaktu (`preview_customer360_contact_merge`, `merge_customer360_contacts`) — administrator. */
export async function mergeContacts(ctx: NativeContext, body: Row, preview: boolean) {
  if (!ctx.employee.isAdmin) fail('Kontakty scala administrator.', 403);
  const target = text(body.targetId), source = text(body.sourceId);
  if (!uuid.test(target) || !uuid.test(source) || target === source) fail('Wybierz dwa różne kontakty.');
  if (preview) {
    const { data, error } = await ctx.supabase.rpc('preview_customer360_contact_merge', { p_target_contact_id: target, p_source_contact_id: source });
    check(error, 'Nie udało się przygotować podglądu scalania');
    const relations = object(object(data).relations);
    return { ok: true, relations: Object.fromEntries(Object.entries(relations).map(([key, value]) => [key, Number(value) || 0])) };
  }
  const { error } = await ctx.supabase.rpc('merge_customer360_contacts', { p_target_contact_id: target, p_source_contact_id: source });
  check(error, 'Nie udało się scalić kontaktów');
  invalidateContacts();
  return { ok: true, message: 'Kontakty zostały scalone, a ich relacje zachowane' };
}
