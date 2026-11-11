import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries } from './eventTabs';
import { buildBestAddress } from '@/components/CityMapEmbed/buildBestAddress';

/**
 * Szczegóły wydarzenia: „Edytuj klienta” (`EditEventClientModal` — klient indywidualny albo firma z osobami kontaktowymi
 * wydarzenia, nowe kontakty, osoba główna) oraz „Dodaj nową lokalizację” (`AddLocationModal` + `GoogleMapsPicker` —
 * wyszukiwanie miejsc Google jak `/bridge/places/*`, adres z `buildBestAddress`). Te same tabele i kolejność zapisów co CRM.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(message);
}

const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);

const person = (c: Row | null | undefined) => c ? {
  id: c.id, name: c.full_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Kontakt bez nazwy',
  email: c.email ?? null, phone: c.phone ?? null, position: c.position ?? null,
} : null;

async function eventContactPersons(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_contact_persons').select('*, contact:contacts(*)').eq('event_id', eventId);
  if (error) throw error;
  return ((data || []) as Row[]).map((p) => ({ id: p.id, contactId: p.contact_id, primary: p.is_primary === true, role: p.role ?? '', contact: person(p.contact) }));
}

/** Dane formularza: organizacje, klienci indywidualni, bieżący wybór i osoby kontaktowe wydarzenia. */
async function clientEditor(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [event, organizations, individuals, persons] = await Promise.all([
    s.from('events').select('client_type, organization_id, contact_person_id').eq('id', eventId).maybeSingle(),
    s.from('organizations').select('id, name, alias').order('name'),
    s.from('contacts').select('id, full_name, first_name, last_name, email, phone').eq('contact_type', 'individual').order('full_name'),
    eventContactPersons(ctx, eventId),
  ]);
  if (event.error || !event.data) fail('Nie znaleziono wydarzenia.');
  const e = event.data as Row;
  return {
    clientType: e.client_type === 'individual' ? 'individual' : 'business',
    organizationId: e.organization_id ?? null, contactPersonId: e.contact_person_id ?? null,
    organizations: ((organizations.data || []) as Row[]).map((o) => ({ id: o.id, name: o.name || '', alias: o.alias ?? null })),
    individuals: ((individuals.data || []) as Row[]).map((c) => person(c)),
    persons,
  };
}

/** `fetchBusinessContacts`: osoby kontaktowe organizacji (typ `contact`). */
async function businessContacts(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const organizationId = params.get('organizationId') || '';
  if (!UUID.test(organizationId)) return { contacts: [] };
  const { data, error } = await ctx.supabase.from('contact_organizations')
    .select('contact_id, contacts (id, full_name, first_name, last_name, email, phone, position, contact_type)').eq('organization_id', organizationId);
  if (error) fail('Nie udało się pobrać osób kontaktowych organizacji.');
  return { contacts: ((data || []) as Row[]).map((r) => r.contacts).filter((c: Row | null) => c && c.contact_type === 'contact').map((c: Row) => person(c)) };
}

/** Wyszukiwarka miejsc (`/bridge/places/autocomplete`): Polska, język polski. */
async function placeSearch(_ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const input = text(params.get('input'), 200);
  if (!input) return { predictions: [] };
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) fail('Brak klucza Google Maps w konfiguracji serwera.');
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', input);
  url.searchParams.set('key', key);
  url.searchParams.set('language', 'pl');
  url.searchParams.set('components', 'country:pl');
  const token = text(params.get('sessiontoken'), 100);
  if (token) url.searchParams.set('sessiontoken', token);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  return {
    predictions: ((data?.predictions || []) as Row[]).map((p) => ({
      placeId: p.place_id, main: p.structured_formatting?.main_text || p.description || '', secondary: p.structured_formatting?.secondary_text || '',
    })),
  };
}

/** Szczegóły miejsca (`/bridge/places/details` + `buildBestAddress`) — pola formularza lokalizacji. */
async function placeDetails(_ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const placeId = text(params.get('placeId'), 300);
  if (!placeId) fail('Brak identyfikatora miejsca.');
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) fail('Brak klucza Google Maps w konfiguracji serwera.');
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('key', key);
  url.searchParams.set('language', 'pl');
  url.searchParams.set('fields', ['place_id', 'name', 'formatted_address', 'geometry/location', 'url', 'address_component'].join(','));
  const token = text(params.get('sessiontoken'), 100);
  if (token) url.searchParams.set('sessiontoken', token);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (data?.status !== 'OK' || !data.result) fail('Nie udało się pobrać szczegółów miejsca.');
  const place = data.result;
  const lat = Number(place.geometry?.location?.lat);
  const lng = Number(place.geometry?.location?.lng);
  const parsed = buildBestAddress(place) as Row;
  return {
    name: place.name || '', latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lng) ? lng : null,
    formattedAddress: parsed.formatted_address || parsed.formatted_short || place.formatted_address || '', placeId,
    googleMapsUrl: Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '',
    address: parsed.address || '', city: parsed.city || '', postalCode: parsed.postal_code || '', country: parsed.country || '',
  };
}

registerEventQueries('details', { clientEditor, businessContacts, placeSearch, placeDetails });

async function personOfEvent(ctx: NativeContext, eventId: string, id: string) {
  if (!UUID.test(id)) fail('Nieprawidłowa osoba kontaktowa.');
  const { data } = await ctx.supabase.from('event_contact_persons').select('id').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!data) fail('Ta osoba nie jest przypisana do wydarzenia.');
}

/** `handleCreateIndividual`. */
async function clientCreateIndividual(ctx: NativeContext, _eventId: string, body: Row) {
  const first = text(body.firstName), last = text(body.lastName);
  if (!first || !last) fail('Imię i nazwisko są wymagane');
  const { data, error } = await ctx.supabase.from('contacts').insert([{
    first_name: first, last_name: last, email: text(body.email), phone: text(body.phone), contact_type: 'individual',
  }]).select('id').single();
  if (error || !data) fail(error?.message || 'Błąd podczas dodawania klienta');
  return { ok: true, id: (data as Row).id };
}

/** `handleCreateBusinessContact`: kontakt → organizacja → osoba kontaktowa wydarzenia (pierwsza zostaje główną). */
async function clientCreateBusiness(ctx: NativeContext, eventId: string, body: Row) {
  const organizationId = String(body.organizationId || '');
  if (!UUID.test(organizationId)) fail('Wybierz najpierw organizację');
  const first = text(body.firstName), last = text(body.lastName);
  if (!first || !last) fail('Imię i nazwisko są wymagane');
  const s = ctx.supabase;
  const { data: contact, error } = await s.from('contacts').insert([{
    first_name: first, last_name: last, email: text(body.email), phone: text(body.phone), position: text(body.position), contact_type: 'contact',
  }]).select('id').single();
  if (error || !contact) fail(error?.message || 'Błąd podczas dodawania osoby');
  const { error: orgError } = await s.from('contact_organizations').insert([{ contact_id: (contact as Row).id, organization_id: organizationId }]);
  if (orgError) fail(orgError.message || 'Błąd podczas dodawania osoby');
  const persons = await eventContactPersons(ctx, eventId);
  const { error: eventError } = await s.from('event_contact_persons').insert([{
    event_id: eventId, contact_id: (contact as Row).id, role: text(body.role), is_primary: persons.length === 0,
  }]);
  if (eventError) fail(eventError.message || 'Błąd podczas dodawania osoby');
  return { ok: true };
}

/** `handleAddExistingContact`. */
async function clientAddContact(ctx: NativeContext, eventId: string, body: Row) {
  const contactId = String(body.contactId || '');
  if (!UUID.test(contactId)) fail('Nieprawidłowa osoba.');
  const persons = await eventContactPersons(ctx, eventId);
  const { error } = await ctx.supabase.from('event_contact_persons').insert([{ event_id: eventId, contact_id: contactId, is_primary: persons.length === 0 }]);
  if (error) fail(error.message || 'Błąd podczas dodawania osoby');
  return { ok: true };
}

/** `handleRemoveContactPerson`. */
async function clientRemoveContact(ctx: NativeContext, eventId: string, body: Row) {
  const id = String(body.id || '');
  await personOfEvent(ctx, eventId, id);
  const { error } = await ctx.supabase.from('event_contact_persons').delete().eq('id', id);
  if (error) fail(error.message || 'Błąd podczas usuwania osoby');
  return { ok: true };
}

/** `handleSetPrimary`: jedna osoba główna w wydarzeniu. */
async function clientSetPrimary(ctx: NativeContext, eventId: string, body: Row) {
  const id = String(body.id || '');
  await personOfEvent(ctx, eventId, id);
  await ctx.supabase.from('event_contact_persons').update({ is_primary: false }).eq('event_id', eventId);
  const { error } = await ctx.supabase.from('event_contact_persons').update({ is_primary: true }).eq('id', id);
  if (error) fail(error.message || 'Błąd');
  return { ok: true };
}

/** `handleSave`: klient indywidualny (bez osób kontaktowych wydarzenia) albo firma z osobą główną. */
async function clientSave(ctx: NativeContext, eventId: string, body: Row) {
  const s = ctx.supabase;
  if (body.type === 'individual') {
    const contactId = String(body.contactId || '');
    if (!UUID.test(contactId)) fail('Wybierz osobę kontaktową');
    const { data, error } = await s.from('events').update({ client_type: 'individual', organization_id: null, contact_person_id: contactId }).eq('id', eventId).select('id');
    if (error || !(data || []).length) fail(error?.message || 'Błąd podczas zapisywania');
    await s.from('event_contact_persons').delete().eq('event_id', eventId);
    return { ok: true };
  }
  const organizationId = String(body.organizationId || '');
  if (!UUID.test(organizationId)) fail('Wybierz organizację');
  const persons = await eventContactPersons(ctx, eventId);
  if (!persons.length) fail('Dodaj przynajmniej jedną osobę kontaktową');
  const primary = persons.find((p) => p.primary);
  const { data, error } = await s.from('events').update({ client_type: 'business', organization_id: organizationId, contact_person_id: primary?.contactId || null })
    .eq('id', eventId).select('id');
  if (error || !(data || []).length) fail(error?.message || 'Błąd podczas zapisywania');
  return { ok: true };
}

/** `AddLocationModal.handleSave`: nowa lokalizacja (nazwa wymagana); wybór dla wydarzenia — jak w CRM, osobnym zapisem. */
async function locationCreate(ctx: NativeContext, _eventId: string, body: Row) {
  const name = text(body.name, 300);
  if (!name) fail('Nazwa lokalizacji jest wymagana');
  const number = (value: unknown) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const { data, error } = await ctx.supabase.from('locations').insert([{
    name, address: text(body.address), city: text(body.city), postal_code: text(body.postalCode, 20), country: text(body.country, 100) || 'Polska',
    nip: text(body.nip, 20), contact_person_name: text(body.contactPersonName), contact_phone: text(body.contactPhone, 50),
    contact_email: text(body.contactEmail), notes: text(body.notes, 5000), latitude: number(body.latitude), longitude: number(body.longitude),
    google_maps_url: text(body.googleMapsUrl, 500), google_place_id: text(body.placeId, 300), formatted_address: text(body.formattedAddress, 500),
  }]).select('id, name, address, city, postal_code, formatted_address').single();
  if (error || !data) fail('Błąd podczas zapisywania lokalizacji');
  return { ok: true, location: data };
}

registerEventActions('details', {
  clientCreateIndividual, clientCreateBusiness, clientAddContact, clientRemoveContact, clientSetPrimary, clientSave, locationCreate,
});
