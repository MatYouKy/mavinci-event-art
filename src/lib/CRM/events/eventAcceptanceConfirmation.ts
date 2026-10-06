import { supabase } from '@/lib/supabase/browser';

export interface EventAcceptanceConfirmationPreview {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  recipientEmail: string | null;
  recipientName: string;
}

const pendingEventConfirmations = new Set<string>();

/** Use the event contact, then its organization, exactly as send-event-confirmation does. */
export async function loadEventAcceptanceConfirmationPreview(
  eventId: string,
): Promise<EventAcceptanceConfirmationPreview> {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, event_date, contact_person_id, organization_id')
    .eq('id', eventId)
    .single();
  if (error || !event) throw new Error('Nie udało się odczytać wydarzenia i odbiorcy potwierdzenia.');

  const [contactResult, organizationResult] = await Promise.all([
    event.contact_person_id
      ? supabase.from('contacts').select('full_name, first_name, last_name, email')
        .eq('id', event.contact_person_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    event.organization_id
      ? supabase.from('organizations').select('name, email')
        .eq('id', event.organization_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (contactResult.error || organizationResult.error) {
    throw new Error('Nie udało się odczytać odbiorcy potwierdzenia.');
  }
  const contact = contactResult.data;
  const organization = organizationResult.data;
  const recipientEmail = contact?.email || organization?.email || null;
  return {
    eventId: event.id,
    eventName: event.name || 'Wydarzenie',
    eventDate: event.event_date || null,
    recipientEmail,
    recipientName: contact?.email
      ? contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')
      : organization?.name || '',
  };
}

/** Explicit send only; never retries a request with an uncertain delivery result. */
export async function sendEventAcceptanceConfirmation({
  eventId,
  expectedRecipientEmail,
  acceptedOfferId,
}: {
  eventId: string;
  expectedRecipientEmail: string;
  acceptedOfferId?: string;
}): Promise<{ recipientEmail: string; sentAt: string; historyRecorded: boolean }> {
  if (pendingEventConfirmations.has(eventId)) {
    throw new Error('Wysyłka potwierdzenia tego wydarzenia już trwa.');
  }
  pendingEventConfirmations.add(eventId);
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Brak aktywnej sesji — potwierdzenie nie zostało wysłane.');

    const preview = await loadEventAcceptanceConfirmationPreview(eventId);
    if (!preview.recipientEmail || preview.recipientEmail !== expectedRecipientEmail) {
      throw new Error('Odbiorca potwierdzenia zmienił się lub nie ma adresu e-mail. Sprawdź dane wydarzenia przed wysyłką.');
    }
    if (acceptedOfferId) {
      const { data: acceptedOffer, error } = await supabase.from('offers')
        .select('status, event_id').eq('id', acceptedOfferId).single();
      if (error || acceptedOffer?.status !== 'accepted' || acceptedOffer.event_id !== eventId) {
        throw new Error('Nie potwierdzono zapisanej akceptacji tej oferty. Wiadomość nie została wysłana.');
      }
    }

    let response: Response;
    try {
      response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-event-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventId, acceptedById: sessionData.session?.user.id ?? null }),
      });
    } catch {
      throw new Error('Nie udało się potwierdzić wyniku wysyłki. Sprawdź wysłane wiadomości przed ponownym wysłaniem.');
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      throw new Error(result?.message || result?.error
        || 'Nie udało się potwierdzić wysyłki. Sprawdź wysłane wiadomości przed ponowieniem.');
    }
    return { recipientEmail: result.recipientEmail || preview.recipientEmail, sentAt: result.sentAt || new Date().toISOString(), historyRecorded: result.historyRecorded === true };
  } finally {
    pendingEventConfirmations.delete(eventId);
  }
}
