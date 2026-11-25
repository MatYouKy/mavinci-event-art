import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Wysyłka dokumentu eventu e-mailem: agenda (zakładka „Agenda”) i Karta Weselna (ta sama zakładka w wydarzeniu weselnym) —
 * wspólne dla okna w CRM (`SendEventDocumentEmailModal`) i serwera dla Maca (`src/lib/native/eventDocumentEmail.ts`).
 * Zapisany PDF dokumentu zawsze w załączniku, do tego wybrane pliki eventu; adresat — para młoda (karta weselna) albo osoba
 * kontaktowa klienta, a bez niej organizacja. Wysłana wiadomość trafia do korespondencji eventu (`linkEventEmail`).
 */

export type EventDocumentKind = 'agenda' | 'wedding-card';

export const isEventDocumentKind = (value: unknown): value is EventDocumentKind => value === 'agenda' || value === 'wedding-card';

/** Łączny rozmiar załączników (PDF dokumentu i pliki eventu), jak w oknach umowy i kalkulacji. */
export const EVENT_DOCUMENT_ATTACHMENTS_LIMIT = 25 * 1024 * 1024;

export const EVENT_DOCUMENT_EMAIL: Record<EventDocumentKind, {
  /** Nagłówek okna. */
  title: string;
  /** Zakładka karty eventu (adres w powiadomieniach o zaplanowanej wysyłce). */
  tab: string;
  subject: (eventName: string) => string;
  text: string;
  /** Opis załącznika w oknie. */
  attachment: string;
  sending: string;
  sent: string;
  scheduled: string;
  missing: string;
  stale: string;
  fallbackName: string;
}> = {
  agenda: {
    title: 'Wyślij agendę e-mailem',
    tab: 'agenda',
    subject: (eventName) => (eventName.trim() ? `Agenda – ${eventName.trim()}` : 'Agenda wydarzenia'),
    text: 'Dzień dobry,\n\nW załączeniu przesyłam agendę wydarzenia.\n\n'
      + 'Proszę o zapoznanie się z harmonogramem. W razie pytań lub uwag pozostaję do dyspozycji.',
    attachment: 'PDF agendy zostanie dołączony do wiadomości.',
    sending: 'Pobieram PDF agendy i załączniki, wysyłam…',
    sent: 'Agenda wysłana e-mailem',
    scheduled: 'Agenda zostanie wysłana',
    missing: 'Najpierw wygeneruj aktualny PDF agendy („Generuj PDF”).',
    stale: '',
    fallbackName: 'Agenda.pdf',
  },
  'wedding-card': {
    title: 'Wyślij Kartę Weselną e-mailem',
    tab: 'agenda',
    subject: (eventName) => (eventName.trim() ? `Karta Weselna – ${eventName.trim()}` : 'Karta Weselna'),
    text: 'Dzień dobry,\n\nW załączeniu przesyłam Kartę Weselną z naszymi ustaleniami.\n\n'
      + 'Proszę o sprawdzenie, czy wszystko się zgadza. W razie uwag pozostaję do dyspozycji.',
    attachment: 'PDF Karty Weselnej zostanie dołączony do wiadomości.',
    sending: 'Pobieram PDF Karty Weselnej i załączniki, wysyłam…',
    sent: 'Karta Weselna wysłana e-mailem',
    scheduled: 'Karta Weselna zostanie wysłana',
    missing: 'Najpierw wygeneruj PDF Karty Weselnej („Generuj PDF”).',
    stale: 'Karta zmieniła się po wygenerowaniu PDF — rozważ „Aktualizuj PDF” przed wysyłką.',
    fallbackName: 'Karta-Weselna.pdf',
  },
};

export type EventDocumentEmailFile = {
  id: string;
  name: string;
  path: string;
  filename: string;
  size: number | null;
  mimeType: string | null;
  createdAt: string | null;
};

export type EventDocumentEmailContext = {
  eventName: string;
  /** Domyślni adresaci (po przecinku). */
  to: string;
  /** Nazwa adresata do szablonu wiadomości. */
  recipientName: string;
  /** Zapisany PDF dokumentu; `null` — trzeba go najpierw wygenerować (`missing`). */
  document: { path: string; filename: string } | null;
  missing: string | null;
  /** Karta weselna zmieniła się po wygenerowaniu PDF (wysyłka nadal możliwa). */
  stale: boolean;
  /** Pliki eventu do dołączenia (bez PDF dokumentu), od najnowszych. */
  files: EventDocumentEmailFile[];
  filesError: string | null;
};

type Row = Record<string, any>;
const one = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Row | null | undefined;
const basename = (path: string) => path.split('/').pop() || path;
const fullName = (row: Row) => [row.first_name, row.last_name].filter(Boolean).join(' ').trim();

/**
 * Dane okna wysyłki: nazwa eventu, adresaci, PDF dokumentu i pliki eventu — zapytania z uprawnieniami osoby (RLS),
 * w przeglądarce i na serwerze dla Maca.
 */
export async function loadEventDocumentEmailContext(
  client: SupabaseClient,
  eventId: string,
  kind: EventDocumentKind,
): Promise<EventDocumentEmailContext> {
  const texts = EVENT_DOCUMENT_EMAIL[kind];
  const eventResult = await client.from('events')
    .select('name, organizations:organizations!events_organization_id_fkey(name, email), contacts:contact_person_id(full_name, email)')
    .eq('id', eventId)
    .maybeSingle();
  if (eventResult.error || !eventResult.data) throw new Error('Nie znaleziono eventu');
  const event = eventResult.data as Row;
  const contact = one(event.contacts);
  const organization = one(event.organizations);
  let to = String(contact?.email || organization?.email || '').trim();
  let recipientName = String(contact?.full_name || organization?.name || '').trim();

  let document: EventDocumentEmailContext['document'] = null;
  let stale = false;
  if (kind === 'agenda') {
    const { data } = await client.from('event_agendas')
      .select('generated_pdf_path, modified_after_generation')
      .eq('event_id', eventId)
      .maybeSingle();
    const path = String((data as Row | null)?.generated_pdf_path || '');
    if (path && (data as Row).modified_after_generation !== true) document = { path, filename: basename(path) };
  } else {
    const [fileResult, cardResult] = await Promise.all([
      client.from('event_files').select('name, file_path, updated_at').eq('event_id', eventId)
        .like('file_path', `${eventId}/documents/wedding-card/%`).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('wedding_cards').select('id, updated_at').eq('event_id', eventId).maybeSingle(),
    ]);
    const file = fileResult.data as Row | null;
    const card = cardResult.data as Row | null;
    if (file?.file_path) {
      document = { path: String(file.file_path), filename: String(file.name || basename(file.file_path)) };
      stale = Boolean(card?.updated_at && file.updated_at && Date.parse(card.updated_at) > Date.parse(file.updated_at));
    }
    if (card?.id) {
      const { data: people } = await client.from('wedding_card_people')
        .select('first_name, last_name, email, role')
        .eq('wedding_card_id', card.id)
        .in('role', ['bride', 'groom']);
      const couple = ((people || []) as Row[]).filter((person) => String(person.email || '').includes('@'));
      if (couple.length) {
        to = Array.from(new Set(couple.map((person) => String(person.email).trim()))).join(', ');
        recipientName = couple.map(fullName).filter(Boolean).join(' i ') || recipientName;
      }
    }
  }

  const filesResult = await client.from('event_files')
    .select('id, name, original_name, file_path, file_size, mime_type, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  const files = ((filesResult.data || []) as Row[])
    .filter((file) => Boolean(file.file_path) && file.file_path !== document?.path)
    .map((file) => ({
      id: String(file.id),
      name: String(file.name || file.original_name || basename(file.file_path)),
      path: String(file.file_path),
      filename: String(file.original_name || file.name || basename(file.file_path)),
      size: file.file_size == null ? null : Number(file.file_size),
      mimeType: file.mime_type ? String(file.mime_type) : null,
      createdAt: file.created_at ?? null,
    }));

  return {
    eventName: String(event.name || ''),
    to,
    recipientName,
    document,
    missing: document ? null : texts.missing,
    stale,
    files,
    filesError: filesResult.error ? 'Nie udało się pobrać plików eventu' : null,
  };
}
