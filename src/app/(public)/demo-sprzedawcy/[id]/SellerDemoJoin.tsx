'use client';
import { useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';

const field = 'mt-1.5 w-full rounded-xl border border-white/10 bg-[var(--brand-burgundy-950)] px-4 py-3 text-sm text-[var(--brand-platinum)] outline-none placeholder:text-white/40 transition-colors focus:bg-[var(--brand-burgundy-900)]';
type Join = { fullName: string; organization: string; email: string; phone: string; note: string };

/**
 * „Chcę dołączyć” w demo z broszury: zgłoszenie trafia do CRM jako zapytanie dla osoby, która wysłała broszurę
 * (trasa /bridge/seller-demo/[id], akcja `join`). Pola wypełniają się danymi wpisanymi wyżej w demo.
 */
export default function SellerDemoJoin({ post, ready, prefill }: {
  post: (data: unknown) => Promise<Response>;
  ready: boolean;
  prefill: { fullName: string; organization: string; email: string; phone: string };
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Join>({ fullName: '', organization: '', email: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const start = () => { setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(prefill).filter(([key, value]) => value && !current[key as keyof Join])) })); setOpen(true); };
  const change = (patch: Partial<Join>) => { setError(''); setForm((current) => ({ ...current, ...patch })); };
  const submit = async () => {
    if (form.fullName.trim().length < 2) return setError('Podaj imię i nazwisko.');
    if (!form.organization.trim()) return setError('Podaj nazwę hotelu lub agencji.');
    if (!form.email.trim() && !form.phone.trim()) return setError('Podaj e-mail albo telefon, abyśmy mogli się odezwać.');
    setBusy(true); setError('');
    try { await post({ action: 'join', join: form }); setSent(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się wysłać zgłoszenia.'); }
    finally { setBusy(false); }
  };

  return <div className="mt-6 rounded-xl bg-[var(--brand-burgundy-900)] p-5 text-sm leading-6 text-white/65">
    <p className="text-white">Tak może wyglądać Twoja codzienna praca.</p>
    <p className="mt-2">Po rozpoczęciu współpracy otrzymasz dostęp do portalu, katalogu i ustalonych warunków. Oferty przedstawisz pod własną marką, a zakres realizacji omówisz z opiekunem Mavinci.</p>
    {sent ? <p role="status" className="mt-4 flex items-start gap-2 rounded-lg bg-green-400/10 p-3 text-green-100"><Check className="mt-1 h-4 w-4 shrink-0" />Dziękujemy! Zgłoszenie trafiło do opiekuna Mavinci — odezwie się, aby umówić krótką rozmowę.</p>
    : !open ? <button type="button" disabled={!ready} onClick={start} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-gold)] px-5 py-3 text-sm font-semibold text-[#260d17] disabled:opacity-50">Chcę dołączyć <ArrowRight className="h-4 w-4" /></button>
    : <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/60">Imię i nazwisko<input required maxLength={120} autoComplete="name" value={form.fullName} onChange={(event) => change({ fullName: event.target.value })} className={field} /></label>
        <label className="text-xs text-white/60">Hotel lub agencja<input required maxLength={160} autoComplete="organization" value={form.organization} onChange={(event) => change({ organization: event.target.value })} className={field} /></label>
        <label className="text-xs text-white/60">E-mail<input type="email" maxLength={200} autoComplete="email" value={form.email} onChange={(event) => change({ email: event.target.value })} placeholder="E-mail lub telefon" className={field} /></label>
        <label className="text-xs text-white/60">Telefon<input type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={(event) => change({ phone: event.target.value })} placeholder="E-mail lub telefon" className={field} /></label>
        <label className="text-xs text-white/60 sm:col-span-2">Wiadomość — opcjonalnie<textarea rows={3} maxLength={2000} value={form.note} onChange={(event) => change({ note: event.target.value })} placeholder="np. najlepsza pora na telefon, liczba sal, pytania" className={`${field} resize-y`} /></label>
      </fieldset>
      <p className="text-xs leading-5 text-white/45">Zgłoszenie i dane kontaktowe trafią do zespołu Mavinci wyłącznie w celu rozmowy o współpracy. <a className="underline" href="/polityka-prywatnosci" target="_blank" rel="noreferrer">Polityka prywatności</a>.</p>
      {error && <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-xs text-red-200">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-gold)] px-5 py-3 text-sm font-semibold text-[#260d17] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Wyślij zgłoszenie</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-xs text-white/50 hover:text-white">Anuluj</button>
      </div>
    </form>}
  </div>;
}
