import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Korespondencja eventu (zakładka „Korespondencja”, migracja 20261130160000_event_correspondence.sql): wiadomości wysłane
 * z eventu trafiają do jego wątku. Okna wysyłki (agenda, karta weselna, kalkulacja, umowa, oferta i faktura eventu — w CRM
 * i na serwerze dla Maca) po wysyłce wiążą wysłaną wiadomość (`sentEmailId` z funkcji poczty), a po zaplanowaniu — zlecenie
 * (`scheduledEmailId`; po wysyłce do korespondencji dochodzi wysłana wiadomość). Kolejne odpowiedzi klienta dochodzą same
 * (wątek liczony przy odczycie). Powiązanie własnej wysyłki wymaga tylko dostępu do eventu (`link_event_email`, źródło „event”).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wynik wysyłki z `dispatchCrmEmail` / funkcji poczty: wysłana wiadomość albo zlecenie zaplanowanej wysyłki. */
export type EventMailDispatch = {
  scheduled?: boolean;
  sentEmailId?: unknown;
  scheduledEmailId?: unknown;
} | null | undefined;

/**
 * Wiąże wysłaną (albo zaplanowaną) wiadomość z eventem. Błąd powiązania nie przerywa wysyłki — wiadomość już wyszła,
 * więc tylko zapisujemy ostrzeżenie (np. przed wdrożeniem migracji). Zwraca, czy powiązanie się udało.
 */
export async function linkEventEmail(client: SupabaseClient, eventId: string | null | undefined, dispatch: EventMailDispatch): Promise<boolean> {
  if (!eventId || !UUID.test(eventId) || !dispatch) return false;
  const scheduled = dispatch.scheduled === true;
  const id = String((scheduled ? dispatch.scheduledEmailId : dispatch.sentEmailId) ?? '');
  if (!UUID.test(id)) return false;
  try {
    const { error } = await client.rpc('link_event_email', {
      p_event_id: eventId,
      p_type: scheduled ? 'scheduled' : 'sent',
      p_id: id,
      p_thread: true,
      p_source: 'event',
    });
    if (error) {
      console.warn('[event-correspondence] Nie powiązano wiadomości z eventem:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[event-correspondence] Nie powiązano wiadomości z eventem:', (error as Error)?.message || error);
    return false;
  }
}

/**
 * Oferta i faktura wysyłane z dowolnego miejsca (karta oferty, Finanse) — gdy dokument należy do eventu, wiadomość trafia
 * do korespondencji tego eventu.
 */
export async function linkDocumentEmailToEvent(
  client: SupabaseClient,
  kind: 'offer' | 'invoice',
  documentId: string | null | undefined,
  dispatch: EventMailDispatch,
): Promise<boolean> {
  if (!documentId || !UUID.test(documentId) || !dispatch) return false;
  try {
    const { data, error } = await client
      .from(kind === 'offer' ? 'offers' : 'invoices')
      .select('event_id')
      .eq('id', documentId)
      .maybeSingle();
    const eventId = (data as { event_id?: string | null } | null)?.event_id;
    if (error || !eventId) return false;
    return linkEventEmail(client, eventId, dispatch);
  } catch {
    return false;
  }
}

// MARK: Zakładka „Korespondencja” — dane wspólne dla CRM (`EventCorrespondenceTab`) i serwera dla Maca
// (`src/lib/native/eventCorrespondence.ts`). Źródło: `get_event_correspondence` i `get_event_correspondence_suggestions`.

/** Skąd wiadomość jest w wątku eventu. */
export type EventMailSource = 'event' | 'manual' | 'backfill' | 'confirmation' | 'inquiry' | 'thread';

export const EVENT_MAIL_SOURCE_LABELS: Record<EventMailSource, string> = {
  event: 'Wysłana z eventu',
  backfill: 'Wysłana z eventu',
  manual: 'Dołączona',
  confirmation: 'Potwierdzenie realizacji',
  inquiry: 'Z zapytania',
  thread: 'W wątku',
};

export type EventMailAttachment = { id: string; filename: string; size: number | null };

export type EventMailMessage = {
  /** `received:<id>` / `sent:<id>`. */
  key: string;
  type: 'received' | 'sent';
  id: string;
  subject: string;
  from: string;
  to: string;
  /** ISO. */
  at: string;
  /** Czytelny tekst (bez HTML), do 20 000 znaków. */
  body: string;
  attachments: EventMailAttachment[];
  source: EventMailSource;
  /** Skrzynka systemowa (system@) — filtr „Ukryj systemowe”. */
  system: boolean;
  /** Wiadomość ze skrzynki osoby — można ją otworzyć w Wiadomościach i odpowiedzieć. */
  accessible: boolean;
};

export type EventMailScheduled = {
  id: string;
  status: 'scheduled' | 'processing' | 'retry' | 'failed' | string;
  scheduledAt: string | null;
  subject: string;
  to: string;
  error: string | null;
  author: string | null;
};

export const EVENT_MAIL_SCHEDULED_LABELS: Record<string, string> = {
  scheduled: 'Zaplanowana',
  processing: 'Wysyłanie',
  retry: 'Ponawiana',
  failed: 'Nieudana',
};

export type EventMailExcluded = { key: string; type: 'received' | 'sent'; id: string; subject: string | null; at: string | null };

export type EventCorrespondence = {
  messages: EventMailMessage[];
  scheduled: EventMailScheduled[];
  excluded: EventMailExcluded[];
  /** Dołączanie i wykluczanie (zarządzanie eventem i dokumenty handlowe). */
  canManage: boolean;
  signature: string;
};

export type EventMailSuggestion = { key: string; type: 'received' | 'sent'; id: string; subject: string; from: string; to: string; at: string };

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const kind = (value: unknown): 'received' | 'sent' | null => (value === 'received' || value === 'sent' ? value : null);
const SOURCES = new Set<EventMailSource>(['event', 'manual', 'backfill', 'confirmation', 'inquiry', 'thread']);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object') : []);

/** Wynik `get_event_correspondence` → kształt zakładki (od najnowszej wiadomości). */
export function parseEventCorrespondence(data: unknown): EventCorrespondence {
  const raw = (data && typeof data === 'object' ? data : {}) as Row;
  const messages = rows(raw.messages).flatMap((item): EventMailMessage[] => {
    const type = kind(item.type);
    const id = text(item.id);
    if (!type || !UUID.test(id)) return [];
    const source = text(item.source) as EventMailSource;
    return [{
      key: `${type}:${id}`,
      type,
      id,
      subject: text(item.subject),
      from: text(item.from_address),
      to: text(item.to_address),
      at: text(item.message_at),
      body: text(item.body),
      attachments: rows(item.attachments).map((attachment) => ({
        id: text(attachment.id),
        filename: text(attachment.filename) || 'Załącznik',
        size: typeof attachment.size === 'number' ? attachment.size : null,
      })),
      source: SOURCES.has(source) ? source : 'thread',
      system: item.system === true,
      accessible: item.accessible === true,
    }];
  });
  messages.sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || '') || a.key.localeCompare(b.key));
  return {
    messages,
    scheduled: rows(raw.scheduled).map((item) => ({
      id: text(item.id),
      status: text(item.status),
      scheduledAt: text(item.scheduled_at) || null,
      subject: text(item.subject),
      to: text(item.to_address),
      error: text(item.error) || null,
      author: text(item.author) || null,
    })),
    excluded: rows(raw.excluded).flatMap((item): EventMailExcluded[] => {
      const type = kind(item.type);
      const id = text(item.id);
      return type && UUID.test(id)
        ? [{ key: `${type}:${id}`, type, id, subject: text(item.subject) || null, at: text(item.message_at) || null }]
        : [];
    }),
    canManage: raw.can_manage === true,
    signature: text(raw.signature),
  };
}

export type EventMailFilter = { query?: string; direction?: 'all' | 'received' | 'sent'; hideSystem?: boolean };

/** Filtry zakładki: kierunek, „Ukryj systemowe” i wyszukiwanie w temacie, adresach, treści i nazwach załączników. */
export function eventMailMatches(message: EventMailMessage, filter: EventMailFilter): boolean {
  if (filter.hideSystem && message.system) return false;
  if (filter.direction && filter.direction !== 'all' && message.type !== filter.direction) return false;
  const query = (filter.query || '').trim().toLocaleLowerCase('pl-PL');
  if (!query) return true;
  return [message.subject, message.from, message.to, message.body, ...message.attachments.map((item) => item.filename)]
    .some((value) => value.toLocaleLowerCase('pl-PL').includes(query));
}

/** „Re: …” bez dublowania przedrostka (także „Odp:”). */
export function replySubject(subject: string) {
  const trimmed = subject.trim();
  return /^(re|odp)\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export async function loadEventCorrespondence(client: SupabaseClient, eventId: string): Promise<EventCorrespondence> {
  const { data, error } = await client.rpc('get_event_correspondence', { p_event_id: eventId });
  if (error) throw new Error(error.message || 'Nie udało się wczytać korespondencji');
  return parseEventCorrespondence(data);
}

/** „Inne wiadomości z klientem” — bez wiadomości, które już są w wątku albo zostały wykluczone. */
export async function loadEventCorrespondenceSuggestions(
  client: SupabaseClient,
  eventId: string,
  known: Iterable<string>,
): Promise<{ messages: EventMailSuggestion[]; addresses: string[] }> {
  const { data, error } = await client.rpc('get_event_correspondence_suggestions', { p_event_id: eventId });
  if (error) throw new Error(error.message || 'Nie udało się wyszukać wiadomości z klientem');
  const skip = new Set(known);
  const raw = (data && typeof data === 'object' ? data : {}) as Row;
  return {
    messages: rows(raw.messages).flatMap((item): EventMailSuggestion[] => {
      const type = kind(item.type);
      const id = text(item.id);
      if (!type || !UUID.test(id) || skip.has(`${type}:${id}`)) return [];
      return [{ key: `${type}:${id}`, type, id, subject: text(item.subject), from: text(item.from_address), to: text(item.to_address), at: text(item.message_at) }];
    }),
    addresses: Array.isArray(raw.addresses) ? raw.addresses.map(text).filter(Boolean) : [],
  };
}

/** Adresat „Napisz do klienta”: osoba kontaktowa eventu, a bez niej organizacja. */
export async function loadEventMailRecipient(client: SupabaseClient, eventId: string) {
  const { data } = await client.from('events')
    .select('name, organizations:organizations!events_organization_id_fkey(name, email), contacts:contact_person_id(full_name, email)')
    .eq('id', eventId)
    .maybeSingle();
  const event = (data || {}) as Row;
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Row | null | undefined;
  const contact = first(event.contacts);
  const organization = first(event.organizations);
  return {
    eventName: text(event.name),
    to: text(contact?.email || organization?.email).trim(),
    name: text(contact?.full_name || organization?.name).trim(),
  };
}

/** Ręczne dołączenie wiadomości (z wątkiem) albo wykluczenie / przywrócenie — osoba zarządzająca eventem. */
export async function linkEventEmailManually(client: SupabaseClient, eventId: string, type: 'received' | 'sent', id: string, wholeThread: boolean) {
  const { error } = await client.rpc('link_event_email', { p_event_id: eventId, p_type: type, p_id: id, p_thread: wholeThread, p_source: 'manual' });
  if (error) throw new Error(error.message || 'Nie udało się dołączyć wiadomości');
}

export async function excludeEventEmail(client: SupabaseClient, eventId: string, type: 'received' | 'sent', id: string, exclude: boolean) {
  const { error } = await client.rpc('exclude_event_email', { p_event_id: eventId, p_type: type, p_id: id, p_exclude: exclude });
  if (error) throw new Error(error.message || 'Nie udało się zmienić korespondencji');
}

/** In-Reply-To i References odpowiedzi na odebraną wiadomość (jak odpowiedź w Wiadomościach). */
export async function replyHeaders(client: SupabaseClient, receivedId: string) {
  const { data } = await client.from('received_emails').select('message_id, raw_headers').eq('id', receivedId).maybeSingle();
  const row = (data || {}) as Row;
  const inReplyTo = text(row.message_id) || undefined;
  const headers = (row.raw_headers && typeof row.raw_headers === 'object' ? row.raw_headers : {}) as Row;
  const rawReferences = headers.references ?? headers.References;
  const parsed = Array.isArray(rawReferences)
    ? rawReferences.map(text)
    : typeof rawReferences === 'string'
      ? rawReferences.match(/<[^>]+>/g) || rawReferences.split(/\s+/).filter(Boolean)
      : [];
  return { inReplyTo, references: inReplyTo ? Array.from(new Set([...parsed, inReplyTo])) : parsed };
}
