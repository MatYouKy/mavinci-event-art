import 'server-only';
import type { NativeContext } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';

/*
 * Kontakty na Macu (`/crm/contacts`): ta sama lista co strona (`clientsApi.getClientsList`, zakładka „Wszystkie kontakty”) —
 * organizacje (bez podwykonawców), kontakty firmowe i osoby prywatne — z licznikami powiązań, oznaczeniem sprzedawców
 * (`useSellerContactBadges`) i danymi karty. Tokenem pracownika (RLS). PESEL i numer dowodu nie trafiają do kopii na Macu.
 */

export const CONTACTS_SET = 'contacts-unified';
const PAGE = 1000;

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const list = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

async function pages(build: () => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

const CONTACT_FIELDS = 'id,first_name,last_name,full_name,avatar_url,email,phone,mobile,business_phone,position,address,city,postal_code,country,nip,company_name,alternative_contact_name,event_type,event_details,notes,tags,status,rating,contact_type,lifecycle_status,created_at,website';
const ORG_FIELDS = 'id,organization_type,business_type,name,alias,nip,legal_form,krs,regon,email,phone,website,address,city,postal_code,country,notes,tags,status,rating,lifecycle_status,google_maps_url,created_at';

async function loadContacts(ctx: NativeContext): Promise<Item[]> {
  const s = ctx.supabase;
  const [relations, organizations, contacts] = await Promise.all([
    pages(() => s.from('contact_organizations').select('id,contact_id,organization_id,position,is_primary,is_decision_maker').eq('is_current', true)),
    pages(() => s.from('organizations').select(ORG_FIELDS).or('organization_type.is.null,organization_type.neq.subcontractor')),
    pages(() => s.from('contacts').select(CONTACT_FIELDS).in('contact_type', ['contact', 'individual'])),
  ]);

  // Sprzedawcy: profil sprzedawcy kontaktu i organizacje, w których obecnie pracują (jak oznaczenia na stronie).
  const sellerStatus = new Map<string, string>();
  const sellerOrganizations = new Set<string>();
  const contactIds = contacts.map((c) => String(c.id));
  for (let i = 0; i < contactIds.length; i += 100) {
    const { data } = await s.from('sales_partner_profiles').select('contact_id,status,organization_id').in('contact_id', contactIds.slice(i, i + 100));
    for (const profile of data || []) {
      if (!profile.contact_id) continue;
      sellerStatus.set(String(profile.contact_id), String(profile.status || 'active'));
      if (profile.organization_id) sellerOrganizations.add(String(profile.organization_id));
    }
  }

  const orgName = new Map(organizations.map((o) => [String(o.id), text(o.alias) || text(o.name)]));
  const contactName = new Map(contacts.map((c) => [String(c.id), text(c.full_name) || `${text(c.first_name)} ${text(c.last_name)}`.trim() || '—']));
  // Liczniki jak na stronie (`clientsApi.getClientsList`): wszystkie bieżące powiązania.
  const contactsCount = new Map<string, number>();
  const organizationsCount = new Map<string, number>();
  for (const r of relations) {
    if (r.organization_id) contactsCount.set(String(r.organization_id), (contactsCount.get(String(r.organization_id)) || 0) + 1);
    if (r.contact_id) organizationsCount.set(String(r.contact_id), (organizationsCount.get(String(r.contact_id)) || 0) + 1);
  }
  const byContact = new Map<string, Array<Record<string, unknown>>>();
  const byOrganization = new Map<string, Array<Record<string, unknown>>>();
  for (const r of relations) {
    const contactId = String(r.contact_id || '');
    const organizationId = String(r.organization_id || '');
    if (!contactId || !organizationId) continue;
    if (sellerStatus.has(contactId)) sellerOrganizations.add(organizationId);
    const link = { relationId: String(r.id), position: text(r.position), primary: !!r.is_primary, decisionMaker: !!r.is_decision_maker };
    if (orgName.has(organizationId)) (byContact.get(contactId) || byContact.set(contactId, []).get(contactId)!).push({ ...link, id: organizationId, name: orgName.get(organizationId) });
    if (contactName.has(contactId)) (byOrganization.get(organizationId) || byOrganization.set(organizationId, []).get(organizationId)!).push({ ...link, id: contactId, name: contactName.get(contactId) });
  }
  const sorted = (links: Array<Record<string, unknown>> | undefined) =>
    (links || []).sort((a, b) => String(a.relationId) < String(b.relationId) ? -1 : 1);

  const items: Item[] = [];
  for (const o of organizations) {
    const id = String(o.id);
    items.push({
      id: `organization:${id}`,
      item: {
        key: `organization:${id}`, id, kind: 'organization',
        name: text(o.alias) || text(o.name), legalName: text(o.name), alias: text(o.alias),
        email: text(o.email), phone: text(o.phone), mobile: '', city: text(o.city), status: text(o.status),
        rating: o.rating ?? null, tags: list(o.tags), avatarUrl: null, createdAt: o.created_at,
        seller: sellerOrganizations.has(id), sellerStatus: '',
        address: text(o.address), postalCode: text(o.postal_code), country: text(o.country), website: text(o.website),
        nip: text(o.nip), notes: text(o.notes), lifecycle: text(o.lifecycle_status),
        businessType: text(o.business_type), legalForm: text(o.legal_form), krs: text(o.krs), regon: text(o.regon),
        mapsUrl: text(o.google_maps_url),
        firstName: '', lastName: '', position: '', businessPhone: '', companyName: '', alternativeContact: '',
        eventType: '', eventDetails: '',
        links: sorted(byOrganization.get(id)), count: contactsCount.get(id) || 0,
      },
    });
  }
  for (const c of contacts) {
    const id = String(c.id);
    items.push({
      id: `contact:${id}`,
      item: {
        key: `contact:${id}`, id, kind: c.contact_type === 'individual' ? 'individual' : 'contact',
        name: contactName.get(id), legalName: '', alias: '',
        email: text(c.email), phone: text(c.phone), mobile: text(c.mobile), city: text(c.city), status: text(c.status),
        rating: c.rating ?? null, tags: list(c.tags), avatarUrl: c.avatar_url || null, createdAt: c.created_at,
        seller: sellerStatus.has(id), sellerStatus: sellerStatus.get(id) || '',
        address: text(c.address), postalCode: text(c.postal_code), country: text(c.country), website: text(c.website),
        nip: text(c.nip), notes: text(c.notes), lifecycle: text(c.lifecycle_status),
        businessType: '', legalForm: '', krs: '', regon: '', mapsUrl: '',
        firstName: text(c.first_name), lastName: text(c.last_name), position: text(c.position),
        businessPhone: text(c.business_phone), companyName: text(c.company_name),
        alternativeContact: text(c.alternative_contact_name), eventType: text(c.event_type), eventDetails: text(c.event_details),
        links: sorted(byContact.get(id)), count: organizationsCount.get(id) || 0,
      },
    });
  }
  return items;
}

export const contactsState = (ctx: NativeContext, hash?: string) => collectionState(ctx, CONTACTS_SET, loadContacts, hash);
export const contactsItems = (ctx: NativeContext, buckets: unknown[]) => collectionItems(ctx, CONTACTS_SET, loadContacts, buckets);
/** Zmiana kontaktu widoczna od razu u wszystkich (także w kartach `contacts` aplikacji). */
export const invalidateContacts = () => invalidateNativeSync([CONTACTS_SET, 'contacts']);
