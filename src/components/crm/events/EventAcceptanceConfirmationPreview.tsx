'use client';

import { useEffect, useState } from 'react';
import {
  EventAcceptanceConfirmationPreview as Preview,
  loadEventAcceptanceConfirmationPreview,
} from '@/lib/CRM/events/eventAcceptanceConfirmation';

export function useEventAcceptanceConfirmationPreview(eventId: string | null) {
  const [state, setState] = useState<{
    eventId: string | null;
    preview: Preview | null;
    loading: boolean;
    error: string | null;
  }>({ eventId: null, preview: null, loading: false, error: null });

  useEffect(() => {
    let active = true;
    if (!eventId) {
      setState({ eventId: null, preview: null, loading: false, error: null });
      return () => { active = false; };
    }
    setState({ eventId, preview: null, loading: true, error: null });
    loadEventAcceptanceConfirmationPreview(eventId).then(preview => {
      if (active) setState({ eventId, preview, loading: false, error: null });
    }).catch(error => {
      if (active) setState({
        eventId, preview: null, loading: false,
        error: error instanceof Error ? error.message : 'Nie udało się odczytać odbiorcy.',
      });
    });
    return () => { active = false; };
  }, [eventId]);

  return state.eventId === eventId
    ? state
    : { eventId, preview: null, loading: Boolean(eventId), error: null };
}

export default function EventAcceptanceConfirmationPreview({
  preview, loading, error,
}: { preview: Preview | null; loading: boolean; error: string | null }) {
  if (loading) return <p className="text-sm text-[#e5e4e2]/60" role="status">Wczytywanie odbiorcy potwierdzenia…</p>;
  if (error) return <p className="text-sm text-amber-200" role="alert">{error} Możesz zapisać akceptację bez wysyłki.</p>;
  if (!preview) return null;
  const parsedDate = preview.eventDate ? new Date(preview.eventDate) : null;
  const dateLabel = parsedDate && Number.isFinite(parsedDate.getTime())
    ? parsedDate.toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' })
    : 'Termin nie został zapisany';
  return <div className="rounded-lg bg-[#e5e4e2]/5 px-3 py-3 text-sm text-[#e5e4e2]/75">
    <p className="font-medium text-[#e5e4e2]">{preview.eventName}</p>
    <p className="mt-1 text-xs">{dateLabel}</p>
    {preview.recipientEmail
      ? <p className="mt-2 break-words">Odbiorca: <span className="text-[#e5e4e2]">{preview.recipientEmail}</span>{preview.recipientName ? ` · ${preview.recipientName}` : ''}</p>
      : <p className="mt-2 text-amber-200">Brak e-maila kontaktu i organizacji wydarzenia. Akceptacja jest możliwa bez wiadomości.</p>}
    <p className="mt-2 text-xs">Potwierdzenie realizacji korzysta z danych wydarzenia: terminu, miejsca, harmonogramu i zaakceptowanej oferty. To ten sam szablon co przy zmianie statusu wydarzenia. Nie wystawia ani nie wysyła faktury.</p>
  </div>;
}
