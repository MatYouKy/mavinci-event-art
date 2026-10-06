'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Calendar, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { getFunctionErrorMessage } from '@/lib/supabase/functionError';
import { supabase } from '@/lib/supabase/browser';

type Details = {
  taskName: string;
  eventName?: string;
  providerName?: string;
  startsAt?: string;
  endsAt?: string;
  scopeOfWork?: string;
  locationDescription?: string;
  roomDescription?: string;
  deliverables?: string;
  guidelines?: string;
  confirmedAt?: string;
  confirmedByName?: string;
  status: 'sent' | 'confirmed' | 'declined' | 'expired';
};

export default function SubcontractorConfirmationPage() {
  const token = useSearchParams().get('token') || '';
  const [details, setDetails] = useState<Details | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [responseError, setResponseError] = useState('');

  const loadDetails = useCallback(async () => {
    const { data, error: functionError } = await supabase.functions.invoke(
      'respond-subcontractor-assignment',
      { body: { token, action: 'details' } },
    );
    if (functionError)
      throw new Error(
        await getFunctionErrorMessage(
          functionError,
          'Nie udało się obsłużyć wytycznych. Spróbuj ponownie.',
        ),
      );
    if (data?.error) throw new Error(data.error);
    return data as Details;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setError('Brakuje indywidualnego tokenu potwierdzenia.');
      setLoading(false);
      return;
    }
    loadDetails()
      .then(setDetails)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Nie udało się otworzyć zlecenia.'),
      )
      .finally(() => setLoading(false));
  }, [loadDetails, token]);

  const respond = async (action: 'confirm' | 'decline') => {
    if (submitting) return;
    if (name.trim().length < 3) {
      setResponseError('Podaj imię i nazwisko, aby potwierdzić zapoznanie się z wytycznymi.');
      return;
    }
    try {
      setSubmitting(true);
      setResponseError('');
      const { data, error: functionError } = await supabase.functions.invoke(
        'respond-subcontractor-assignment',
        { body: { token, action, name, note } },
      );
      if (functionError)
        throw new Error(
          await getFunctionErrorMessage(
            functionError,
            'Nie udało się obsłużyć wytycznych. Spróbuj ponownie.',
          ),
        );
      if (data?.error) throw new Error(data.error);
      setDetails(data as Details);
    } catch (reason) {
      setResponseError(
        reason instanceof Error ? reason.message : 'Nie udało się zapisać odpowiedzi.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const format = (value?: string) =>
    value
      ? new Date(value).toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })
      : 'do ustalenia';

  return (
    <main className="min-h-screen bg-[#250914] px-4 py-10 text-[#e5e4e2]">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-[#351020] shadow-2xl">
        <header className="border-b border-[#d3bb73]/15 p-6 sm:p-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-[#d3bb73]">
            <ShieldCheck className="h-5 w-5" /> Mavinci
          </div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Potwierdzenie zlecenia</h1>
          <p className="mt-2 text-[#e5e4e2]/60">
            Sprawdź zakres oraz termin przed udzieleniem odpowiedzi.
          </p>
        </header>

        <section className="p-6 sm:p-8">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-[#e5e4e2]/70">
              <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /> Ładowanie wytycznych…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-5 text-red-200">
              {error}
            </div>
          ) : details ? (
            <div className="space-y-6">
              {(details.status === 'confirmed' || details.status === 'declined') && (
                <div
                  className={`flex items-center gap-3 rounded-xl p-4 ${details.status === 'confirmed' ? 'bg-green-400/10 text-green-200' : 'bg-red-400/10 text-red-200'}`}
                >
                  {details.status === 'confirmed' ? <CheckCircle2 /> : <XCircle />}
                  {details.status === 'confirmed'
                    ? 'Wytyczne zostały zaakceptowane. Opiekun wydarzenia otrzymał powiadomienie.'
                    : 'Zgłoszono brak możliwości realizacji.'}
                </div>
              )}
              {details.confirmedAt && (
                <p className="text-sm text-[#e5e4e2]/60">
                  Akceptacja: {details.confirmedByName} · {format(details.confirmedAt)}
                </p>
              )}
              <div>
                <div className="text-sm text-[#d3bb73]">{details.eventName}</div>
                <h2 className="mt-1 text-2xl font-semibold">{details.taskName}</h2>
              </div>
              <div className="grid gap-3 rounded-xl bg-[#250914] p-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-[#e5e4e2]/40">Rozpoczęcie</div>
                  <div className="mt-1 flex gap-2">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />
                    {format(details.startsAt)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#e5e4e2]/40">Zakończenie</div>
                  <div className="mt-1 flex gap-2">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />
                    {format(details.endsAt)}
                  </div>
                </div>
              </div>
              {[
                ['Miejsce', details.locationDescription],
                ['Sale realizacji / scena', details.roomDescription],
                ['Zakres obowiązków', details.scopeOfWork],
                ['Oczekiwany rezultat', details.deliverables],
                ['Wytyczne organizacyjne', details.guidelines],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <h3 className="mb-2 font-semibold text-[#d3bb73]">{label}</h3>
                    <p className="whitespace-pre-wrap leading-7 text-[#e5e4e2]/80">{value}</p>
                  </div>
                ))}

              {details.status === 'sent' && (
                <div className="space-y-4 border-t border-[#d3bb73]/15 pt-6">
                  <label className="block text-sm">
                    Imię i nazwisko potwierdzającego
                    <input
                      maxLength={150}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Imię i nazwisko potwierdzającego"
                      aria-invalid={Boolean(responseError) && name.trim().length < 3}
                      aria-describedby="response-error"
                      className="w-full rounded-lg border border-white/10 bg-[#250914] px-4 py-3 outline-none focus:border-[#d3bb73]"
                    />
                  </label>
                  <textarea
                    maxLength={2000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    placeholder="Opcjonalna uwaga lub pytanie"
                    className="w-full rounded-lg border border-white/10 bg-[#250914] px-4 py-3 outline-none focus:border-[#d3bb73]"
                  />
                  {responseError && (
                    <p id="response-error" role="alert" className="text-sm text-red-300">
                      {responseError}
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      disabled={submitting}
                      onClick={() => respond('confirm')}
                      className="rounded-lg bg-[#d3bb73] px-4 py-3 font-semibold text-[#351020] disabled:opacity-50"
                    >
                      Zapoznałem się i zaakceptowałem
                    </button>
                    <button
                      disabled={submitting}
                      onClick={() => respond('decline')}
                      className="rounded-lg border border-red-400/40 px-4 py-3 font-semibold text-red-300 disabled:opacity-50"
                    >
                      Nie mogę zrealizować
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
