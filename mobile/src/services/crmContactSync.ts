import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'mavinci-crm-device-contact-map-v1';
const ENABLED_KEY = 'mavinci-crm-device-contact-sync-enabled-v1';

export type SyncableCrmContact = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
};

type ContactMap = Record<string, string>;

async function loadMap(): Promise<ContactMap> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as ContactMap; } catch { return {}; }
}

function deviceContact(contact: SyncableCrmContact): Contacts.Contact {
  const numbers = [contact.mobile, contact.phone]
    .filter((number, index, values): number is string => Boolean(number) && values.indexOf(number) === index)
    .map((number, index) => ({ label: index === 0 ? 'mobile' : 'work', number }));

  return {
    contactType: Contacts.ContactTypes.Person,
    firstName: contact.first_name,
    lastName: contact.last_name,
    name: `${contact.first_name} ${contact.last_name}`.trim(),
    company: contact.id.startsWith('inquiry:') ? 'Mavinci CRM — Zapytanie' : 'Mavinci CRM',
    phoneNumbers: numbers,
    emails: contact.email ? [{ label: 'work', email: contact.email }] : undefined,
  };
}

async function removeOrSanitizeContact(deviceId: string) {
  try {
    await Contacts.removeContactAsync(deviceId);
  } catch {
    // Expo nie udostępnia usuwania kontaktów na wszystkich wersjach Androida.
    // W takim przypadku usuwamy z rekordu wszystkie dane klienta.
    try {
      await Contacts.updateContactAsync({
        id: deviceId,
        name: 'Mavinci CRM — kontakt usunięty',
        firstName: 'Mavinci CRM',
        lastName: 'kontakt usunięty',
        company: 'Mavinci CRM',
        phoneNumbers: [],
        emails: [],
      });
    } catch { /* urządzenie usunęło rekord wcześniej */ }
  }
}

export async function syncCrmContactsToDevice(contacts: SyncableCrmContact[]) {
  const permission = await Contacts.requestPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Brak dostępu do kontaktów telefonu.');

  const previous = await loadMap();
  const next: ContactMap = {};
  let created = 0;
  let updated = 0;

  for (const contact of contacts.filter((item) => item.phone || item.mobile)) {
    const payload = deviceContact(contact);
    const deviceId = previous[contact.id];
    if (deviceId) {
      try {
        await Contacts.updateContactAsync({ ...payload, id: deviceId });
        next[contact.id] = deviceId;
        updated += 1;
        continue;
      } catch {
        // Kontakt mógł zostać ręcznie usunięty z telefonu — tworzymy go ponownie.
      }
    }
    const newDeviceId = await Contacts.addContactAsync(payload);
    next[contact.id] = newDeviceId;
    created += 1;
  }

  for (const [crmId, deviceId] of Object.entries(previous)) {
    if (next[crmId]) continue;
    await removeOrSanitizeContact(deviceId);
  }

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  await AsyncStorage.setItem(ENABLED_KEY, 'true');
  return { created, updated, total: Object.keys(next).length };
}

export async function syncAvailableCrmContacts() {
  const [contactsResult, inquiriesResult] = await Promise.all([
    supabase.from('contacts').select('id, first_name, last_name, phone, mobile, email').eq('status', 'active'),
    supabase.from('tasks').select('id, title, inquiry_stage, inquiry_details').eq('is_inquiry', true),
  ]);
  if (contactsResult.error) throw contactsResult.error;

  const contacts = (contactsResult.data || []) as SyncableCrmContact[];
  const usedNumbers = new Set(contacts.flatMap((contact) => [contact.mobile, contact.phone]).filter(Boolean).map((number) => String(number).replace(/\D/g, '')));
  const inquiries: SyncableCrmContact[] = (inquiriesResult.data || []).flatMap((item: any) => {
    if (['won', 'lost'].includes(item.inquiry_stage)) return [];
    const details = item.inquiry_details as Record<string, unknown> | null;
    const phone = typeof details?.client_phone === 'string' ? details.client_phone : null;
    if (!phone || usedNumbers.has(phone.replace(/\D/g, ''))) return [];
    usedNumbers.add(phone.replace(/\D/g, ''));
    const fullName = typeof details?.client_text === 'string' && details.client_text.trim()
      ? details.client_text.trim()
      : String(item.title || 'Nowe zapytanie').replace(/^Zapytanie:\s*/i, '');
    const parts = fullName.split(/\s+/);
    return [{ id: `inquiry:${item.id}`, first_name: parts.shift() || 'Zapytanie', last_name: parts.join(' ') || 'Mavinci CRM', phone, mobile: null, email: typeof details?.client_email === 'string' ? details.client_email : null }];
  });
  return syncCrmContactsToDevice([...contacts, ...inquiries]);
}

export async function syncCrmContactsIfEnabled() {
  if (await AsyncStorage.getItem(ENABLED_KEY) !== 'true') return null;
  return syncAvailableCrmContacts();
}

export async function removeSyncedCrmContactsFromDevice() {
  const saved = await loadMap();
  for (const deviceId of Object.values(saved)) {
    await removeOrSanitizeContact(deviceId);
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(ENABLED_KEY);
}
