import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'mavinci-crm-device-contact-map-v1';
const ENABLED_KEY = 'mavinci-crm-device-contact-sync-enabled-v1';

/*
 * Kontakty CRM w telefonie. Baza (RLS, migracja 20261105090000) zwraca wyłącznie kontakty z zakresu osoby:
 * role pracujące z klientami widzą bazę klientów, pozostali — tylko własne kontakty i klientów wydarzeń, na
 * których mają obszar „Dane klienta”. Kontakt, który zniknął z zakresu, jest przy synchronizacji usuwany
 * z telefonu (albo czyszczony z danych, gdy system nie pozwala usunąć).
 */

export type SyncableCrmContact = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
};

type ContactMap = Record<string, string>;

// Jedna operacja na kontaktach telefonu naraz: synchronizacja przy starcie (efekt w App.tsx uruchamia się przy każdej
// zmianie obiektu pracownika), ręczna synchronizacja i usuwanie przy wylogowaniu zapisują tę samą mapę — równoległe
// zapisy gubiłyby powiązania i zostawiały w telefonie kontakty, których aplikacja już nie śledzi.
let queue: Promise<unknown> = Promise.resolve();
let syncInFlight: Promise<CrmContactSyncResult | null> | null = null;

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadMap(): Promise<ContactMap> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as ContactMap; } catch { return {}; }
}

function deviceContact(contact: SyncableCrmContact): Contacts.Contact {
  const numbers = [contact.mobile, contact.phone]
    .filter((number, index, values): number is string => Boolean(number) && values.indexOf(number) === index)
    .map((number, index) => ({ label: index === 0 ? 'mobile' : 'work', number }));
  const firstName = typeof contact.first_name === 'string' ? contact.first_name.trim() : '';
  const lastName = typeof contact.last_name === 'string' ? contact.last_name.trim() : '';

  return {
    contactType: Contacts.ContactTypes.Person,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || 'Kontakt Mavinci CRM',
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

export type CrmContactSyncResult = {
  created: number;
  updated: number;
  /** Usunięte z telefonu (poza zakresem osoby, usunięte w CRM, bez numeru). */
  removed: number;
  /** Nie udało się zapisać w telefonie — spróbujemy przy następnej synchronizacji. */
  failed: number;
  total: number;
};

/** Zapis kontaktów w telefonie (po kolei z innymi operacjami na kontaktach). */
export function syncCrmContactsToDevice(
  contacts: SyncableCrmContact[],
  options: { keep?: (crmId: string) => boolean } = {},
): Promise<CrmContactSyncResult> {
  return exclusive(() => writeContactsToDevice(contacts, options));
}

async function writeContactsToDevice(
  contacts: SyncableCrmContact[],
  options: { keep?: (crmId: string) => boolean } = {},
): Promise<CrmContactSyncResult> {
  const permission = await Contacts.requestPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Brak dostępu do kontaktów telefonu.');

  const previous = await loadMap();
  const next: ContactMap = {};
  let created = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  const unique = new Map<string, SyncableCrmContact>();
  for (const item of contacts) {
    if (item?.id && (item.phone || item.mobile) && !unique.has(item.id)) unique.set(item.id, item);
  }

  try {
    for (const contact of unique.values()) {
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
      try {
        const newDeviceId = await Contacts.addContactAsync(payload);
        next[contact.id] = newDeviceId;
        created += 1;
      } catch {
        // Jeden nieudany zapis nie przerywa synchronizacji pozostałych kontaktów. Kontakt nadal jest w zakresie —
        // zostawiamy dotychczasowe powiązanie, żeby pętla usuwania nie skasowała ani nie wyczyściła jego kopii.
        if (deviceId) next[contact.id] = deviceId;
        failed += 1;
      }
    }

    for (const [crmId, deviceId] of Object.entries(previous)) {
      if (next[crmId]) continue;
      if (options.keep?.(crmId)) {
        // Źródło chwilowo niedostępne — zostawiamy kontakt do następnej synchronizacji.
        next[crmId] = deviceId;
        continue;
      }
      await removeOrSanitizeContact(deviceId);
      removed += 1;
    }
  } finally {
    // Zapis mapy także po przerwaniu — bez niego kolejna synchronizacja utworzyłaby duplikaty.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    await AsyncStorage.setItem(ENABLED_KEY, 'true');
  }
  return { created, updated, removed, failed, total: Object.keys(next).length };
}

async function readAvailableAndWrite(): Promise<CrmContactSyncResult> {
  const [contactsResult, inquiriesResult] = await Promise.all([
    supabase.from('contacts').select('id, first_name, last_name, phone, mobile, email').eq('status', 'active'),
    supabase.from('tasks').select('id, title, inquiry_stage, inquiry_details').eq('is_inquiry', true),
  ]);
  // Błąd odczytu kontaktów przerywa synchronizację (bez usuwania czegokolwiek z telefonu). Pusta lista z bazy
  // oznacza brak kontaktów w zakresie osoby — wtedy wcześniej zsynchronizowane kontakty znikają z telefonu.
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
  return writeContactsToDevice([...contacts, ...inquiries], {
    // Zapytania nie wczytały się — nie usuwamy ich kontaktów z telefonu z powodu chwilowego błędu.
    keep: inquiriesResult.error ? (crmId) => crmId.startsWith('inquiry:') : undefined,
  });
}

/** Uruchamia synchronizację w kolejce; równoległe wywołania czekają na trwającą zamiast startować drugą. */
function startSync(requireEnabled: boolean): Promise<CrmContactSyncResult | null> {
  const run = exclusive(async () => {
    // Warunek sprawdzany w kolejce — po wylogowaniu (usunięcie kontaktów) synchronizacja w tle już nie ruszy.
    if (requireEnabled && (await AsyncStorage.getItem(ENABLED_KEY)) !== 'true') return null;
    return readAvailableAndWrite();
  });
  syncInFlight = run;
  const clear = () => {
    if (syncInFlight === run) syncInFlight = null;
  };
  run.then(clear, clear);
  return run;
}

/** Ręczna synchronizacja („Do telefonu”). */
export async function syncAvailableCrmContacts(): Promise<CrmContactSyncResult> {
  const running = syncInFlight;
  if (running) {
    const result = await running.catch(() => null);
    if (result) return result;
  }
  const result = await startSync(false);
  if (!result) throw new Error('Nie udało się zsynchronizować kontaktów.');
  return result;
}

/** Synchronizacja w tle, gdy osoba ją włączyła; dołącza do trwającej synchronizacji. */
export function syncCrmContactsIfEnabled(): Promise<CrmContactSyncResult | null> {
  return syncInFlight ?? startSync(true);
}

/**
 * Osoba nie ma już dostępu do kontaktów CRM (zmiana uprawnień) — kontakty zsynchronizowane wcześniej znikają
 * z telefonu. Bez zgody systemu na kontakty nic nie zmieniamy (spróbujemy przy kolejnym uruchomieniu).
 */
export function removeSyncedCrmContactsIfEnabled(): Promise<boolean> {
  return exclusive(async () => {
    if (await AsyncStorage.getItem(ENABLED_KEY) !== 'true') return false;
    const permission = await Contacts.getPermissionsAsync();
    if (permission.status !== 'granted') return false;
    await removeAllSyncedContacts();
    return true;
  });
}

/** Wylogowanie: usuwa zsynchronizowane kontakty (po zakończeniu trwającej synchronizacji). */
export function removeSyncedCrmContactsFromDevice(): Promise<void> {
  return exclusive(removeAllSyncedContacts);
}

async function removeAllSyncedContacts() {
  const saved = await loadMap();
  for (const deviceId of Object.values(saved)) {
    await removeOrSanitizeContact(deviceId);
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(ENABLED_KEY);
}
