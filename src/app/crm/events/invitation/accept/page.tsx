'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { CheckCircle, Loader2, XCircle, Calendar } from 'lucide-react';

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventId, setEventId] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Brak tokenu zaproszenia');
      return;
    }

    handleAcceptInvitation();
  }, [token]);

  const handleAcceptInvitation = async () => {
    try {
      setStatus('loading');

      const response = await fetch(`/api/events/invitation/accept?token=${token}&execute=true`);
      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || 'Błąd podczas akceptacji zaproszenia');
      }

      setEventName(result.eventName || 'wydarzenie');
      setEventId(result.eventId);
      setStatus('success');
      setMessage('Zaproszenie zostało zaakceptowane pomyślnie!');
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      setStatus('error');
      setMessage(error.message || 'Wystąpił błąd podczas akceptacji zaproszenia');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33] p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-6 flex justify-center">
            {status === 'loading' && (
              <Loader2 className="h-16 w-16 animate-spin text-[#d3bb73]" />
            )}
            {status === 'success' && (
              <CheckCircle className="h-16 w-16 text-green-500" />
            )}
            {status === 'error' && (
              <XCircle className="h-16 w-16 text-red-500" />
            )}
          </div>

          <h1 className="mb-4 text-center text-2xl font-semibold text-[#e5e4e2]">
            {status === 'loading' && 'Akceptowanie zaproszenia...'}
            {status === 'success' && 'Zaproszenie zaakceptowane!'}
            {status === 'error' && 'Wystąpił problem'}
          </h1>

          <div className="mb-6 text-center text-[#e5e4e2]/80">
            {status === 'loading' && (
              <p>Przetwarzanie twojej odpowiedzi, proszę czekać...</p>
            )}
            {status === 'success' && (
              <>
                <p className="mb-4">
                  Zaakceptowałeś zaproszenie do wydarzenia <strong className="text-[#d3bb73]">{eventName}</strong>.
                </p>
                <p className="text-sm text-[#e5e4e2]/60">
                  Wkrótce otrzymasz więcej informacji na temat szczegółów wydarzenia.
                </p>
              </>
            )}
            {status === 'error' && (
              <p className="text-red-400">{message}</p>
            )}
          </div>

          {status === 'success' && eventId && (
            <div className="space-y-3">
              <button
                onClick={() => router.push(`/crm/events/${eventId}`)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
              >
                <Calendar className="h-5 w-5" />
                Zobacz szczegóły wydarzenia
              </button>
              <button
                onClick={() => router.push('/crm/events')}
                className="w-full rounded-lg border border-[#d3bb73]/20 px-6 py-3 font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
              >
                Przejdź do listy wydarzeń
              </button>
            </div>
          )}

          {status === 'error' && (
            <button
              onClick={() => router.push('/crm/events')}
              className="w-full rounded-lg bg-[#d3bb73]/20 px-6 py-3 font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/30"
            >
              Przejdź do panelu CRM
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
