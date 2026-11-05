'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import SellerInquiryFields from '@/components/seller/SellerInquiryFields';
import { emptySellerInquiry, sellerInquiryPayload, validateSellerInquiry, type SellerInquiryValues } from '@/lib/seller/inquiries';

type InquiryForm = { active?: boolean; hotel_name?: string | null; brand_name?: string | null; label?: string | null; logo_url?: string | null };

/** Public inquiry form opened from the hotel's QR code. */
export default function PublicInquiryForm({ token }: { token: string }) {
  const [form, setForm] = useState<InquiryForm | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'inactive' | 'error' | 'sent'>('loading');
  const [values, setValues] = useState<SellerInquiryValues>(emptySellerInquiry);
  const [dateValidity, setDateValidity] = useState({ event_date: true, event_end_date: true });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const requestRef = useRef<{ key: string; id: string } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    const { data, error: loadError } = await supabase.rpc('get_seller_inquiry_form', { p_token: token });
    if (loadError) { setState(/nieaktywny/i.test(loadError.message || '') ? 'inactive' : 'error'); return; }
    const result = data as InquiryForm | null;
    if (!result || result.active === false) { setState('inactive'); return; }
    setForm(result); setState('ready');
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const problem = validateSellerInquiry(values, { datesValid: dateValidity.event_date && dateValidity.event_end_date });
    if (problem) { setError(problem); return; }
    if (!consent) { setError('Zaznacz zgodę na kontakt w sprawie zapytania.'); return; }
    const payload = { ...sellerInquiryPayload(values), consent: true };
    const key = JSON.stringify(payload);
    // A retry after a lost response reuses the request id and is not duplicated.
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    setSending(true); setError('');
    const { error: submitError } = await supabase.rpc('submit_public_seller_inquiry', { p_token: token, p_request_id: requestRef.current.id, p_values: payload });
    setSending(false);
    if (submitError) { setError(submitError.message || 'Nie udało się wysłać zapytania. Spróbuj ponownie.'); return; }
    requestRef.current = null;
    setState('sent');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hotel = form?.hotel_name || 'Hotel';
  const logo = form?.logo_url && /^https:\/\//i.test(form.logo_url) ? form.logo_url : null;

  return <main className="min-h-screen bg-[#0f1119] px-4 pb-16 pt-10 text-[#e5e4e2] sm:pt-14">
    <div className="mx-auto max-w-xl">
      {state === 'loading' && <p role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-white/60"><Loader2 className="h-5 w-5 animate-spin" />Wczytywanie formularza…</p>}
      {state === 'inactive' && <div className="rounded-2xl bg-[#1c1f33] p-8 text-center"><h1 className="text-xl font-light">Ten formularz jest nieaktywny</h1><p className="mt-3 text-sm leading-6 text-white/60">Kod QR mógł zostać wyłączony. Zapytaj o wydarzenie w recepcji hotelu.</p></div>}
      {state === 'error' && <div className="rounded-2xl bg-[#1c1f33] p-8 text-center"><h1 className="text-xl font-light">Nie udało się wczytać formularza</h1><p className="mt-3 text-sm text-white/60">Sprawdź połączenie z internetem.</p><button type="button" onClick={() => void load()} className="mt-5 min-h-11 rounded-lg bg-[#d3bb73] px-5 text-sm font-medium text-[#111522]">Spróbuj ponownie</button></div>}
      {state === 'sent' && <div role="status" className="rounded-2xl bg-[#1c1f33] p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />
        <h1 className="mt-4 text-2xl font-light">Dziękujemy!</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">Twoje zapytanie trafiło do {hotel} i zespołu wydarzeń. Sprawdzimy termin i odezwiemy się najszybciej, jak to możliwe.</p>
        <button type="button" onClick={() => { setValues(emptySellerInquiry()); setConsent(false); setState('ready'); }} className="mt-6 min-h-11 rounded-lg bg-white/5 px-5 text-sm hover:bg-white/10">Wyślij kolejne zapytanie</button>
      </div>}
      {state === 'ready' && <>
        <header className="mb-6 text-center">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- brand logo (public URL).
            <img src={logo} alt="" className="mx-auto mb-4 h-10 max-w-[10rem] object-contain" />
          )}
          <p className="text-xs uppercase tracking-[0.2em] text-[#d3bb73]">{hotel}{form?.label ? ` · ${form.label}` : ''}</p>
          <h1 className="mt-3 text-3xl font-light">Planujesz wydarzenie?</h1>
          <p className="mt-2 text-sm leading-6 text-white/60">Zostaw kilka informacji — sprawdzimy termin i przygotujemy propozycję oprawy: muzyka, światło, scena, atrakcje.</p>
        </header>
        <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl bg-[#1c1f33] p-5 sm:p-6">
          <SellerInquiryFields compact value={values} disabled={sending} guestLabel="Imię i nazwisko *"
            onChange={(patch) => { setValues((current) => ({ ...current, ...patch })); setError(''); }}
            onDateValidity={(field, valid) => setDateValidity((current) => current[field] === valid ? current : { ...current, [field]: valid })} />
          <label className="flex items-start gap-3 text-sm leading-6 text-white/75"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setError(''); }} className="mt-1 h-5 w-5 shrink-0 accent-[#d3bb73]" />
            <span>Zgadzam się na kontakt telefoniczny lub e-mailowy w sprawie tego zapytania. Dane trafią do hotelu i firmy MAVINCI wyłącznie w tym celu. <Link href="/polityka-prywatnosci" target="_blank" className="text-[#d3bb73] underline underline-offset-2">Polityka prywatności</Link></span></label>
          {error && <p role="alert" className="rounded-lg bg-rose-300/10 p-3 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={sending} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-5 text-base font-medium text-[#111522] disabled:opacity-50">{sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}{sending ? 'Wysyłanie…' : 'Wyślij zapytanie'}</button>
        </form>
      </>}
    </div>
  </main>;
}
