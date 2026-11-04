'use client';
import { useCallback, useEffect, useState } from 'react';
import { Phone, User } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { telHref } from './steps/stepUi';

/** Wynik get_event_onsite_contacts (obszar „kontakt na miejscu”): imię, rola, telefon — bez karty klienta. */
export type EventOnsiteContact = {
  source: 'client' | 'event' | 'venue';
  name: string;
  role: string | null;
  phone: string | null;
  notes?: string | null;
  is_primary: boolean;
};

const SOURCE_LABELS: Record<EventOnsiteContact['source'], string> = {
  client: 'Klient',
  event: 'Wydarzenie',
  venue: 'Obiekt',
};

function parseContacts(data: unknown): EventOnsiteContact[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map(row => ({
      source: (row.source === 'client' || row.source === 'venue' ? row.source : 'event') as EventOnsiteContact['source'],
      name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Osoba kontaktowa',
      role: typeof row.role === 'string' ? row.role : null,
      phone: typeof row.phone === 'string' && row.phone.trim() ? row.phone : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      is_primary: row.is_primary === true,
    }));
}

/** Kontakty na miejscu (odczyt tylko, gdy `enabled`; brak obszaru = pusta lista). */
export function useEventOnsiteContacts(eventId: string, enabled: boolean) {
  const [contacts, setContacts] = useState<EventOnsiteContact[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!enabled) {
        setContacts([]);
        setState('idle');
        return;
      }
      setState(current => (current === 'ready' ? current : 'loading'));
      const { data, error } = await supabase.rpc('get_event_onsite_contacts', { p_event_id: eventId });
      if (signal?.cancelled) return;
      if (error) {
        setContacts([]);
        // Brak obszaru (42501) albo funkcja jeszcze niewdrożona — sekcja się nie pokazuje.
        setState(['42501', '42883', 'PGRST202'].includes(error.code ?? '') ? 'ready' : 'error');
        return;
      }
      setContacts(parseContacts(data));
      setState('ready');
    },
    [eventId, enabled],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  return { contacts, state, reload: () => load() };
}

/** Lista kontaktów na miejscu: imię, rola, telefon (tel:). */
export function EventOnsiteContactsList({
  contacts,
  compact = false,
}: {
  contacts: EventOnsiteContact[];
  compact?: boolean;
}) {
  return (
    <ul className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {contacts.map((contact, index) => {
        const phone = telHref(contact.phone);
        return (
          <li
            key={`${contact.source}-${contact.name}-${index}`}
            className={`flex items-start justify-between gap-3 rounded-lg ${compact ? 'bg-white/[0.03] px-3 py-2' : 'bg-white/[0.04] px-3 py-2.5'}`}
          >
            <div className="min-w-0">
              <p className="break-words text-sm text-[#e5e4e2]">
                {contact.name}
                {contact.is_primary && <span className="ml-2 text-xs text-[#d3bb73]">główny kontakt</span>}
              </p>
              <p className="mt-0.5 break-words text-xs text-[#e5e4e2]/55">
                {contact.role || SOURCE_LABELS[contact.source]}
              </p>
              {!compact && contact.notes && (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-[#e5e4e2]/65">{contact.notes}</p>
              )}
            </div>
            {phone ? (
              <a
                href={phone}
                aria-label={`Zadzwoń: ${contact.name}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20"
              >
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {contact.phone}
              </a>
            ) : (
              <span className="shrink-0 text-xs text-[#e5e4e2]/40">brak telefonu</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Sekcja „Kontakt na miejscu” (Szczegóły) dla osób bez danych klienta, ale z obszarem onsite_contact. */
export default function EventOnsiteContactsSection({ eventId }: { eventId: string }) {
  const { contacts, state, reload } = useEventOnsiteContacts(eventId, true);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-[#d3bb73]" aria-hidden />
        <h3 className="text-sm font-medium text-[#e5e4e2]">Kontakt na miejscu</h3>
      </div>
      {state === 'loading' && <p className="text-sm text-[#e5e4e2]/50">Wczytywanie…</p>}
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-300">
          Nie udało się wczytać kontaktu na miejscu.{' '}
          <button type="button" onClick={() => void reload()} className="underline">
            Spróbuj ponownie
          </button>
        </p>
      )}
      {state === 'ready' && contacts.length === 0 && (
        <p className="text-sm text-[#e5e4e2]/55">Nie podano kontaktu na miejscu.</p>
      )}
      {contacts.length > 0 && <EventOnsiteContactsList contacts={contacts} />}
    </div>
  );
}
