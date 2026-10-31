'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { trackMarketingLead } from '@/lib/marketing/trackLead.client';
import { SITE } from '@/lib/SEO/site';

const field = 'mt-2 w-full rounded-lg border border-white/10 bg-[#190f1b] px-3 py-3 text-base text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';
function parseDate(value: string): string | null {
  if (!value.trim()) return '';
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export default function ThemedPartyBriefForm({ sourcePath, motif = '', cityName = '' }: { sourcePath: string; motif?: string; cityName?: string }) {
  const [dateText, setDateText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const pending = useRef<{ id: string; signature: string } | null>(null);
  const iso = parseDate(dateText);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    if (iso === null) { setError('Podaj prawidłową datę DD.MM.RRRR albo pozostaw termin pusty.'); return; }
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) || '').trim();
    if (!value('city') || !value('name') || !value('email')) { setError('Uzupełnij miasto, imię i e-mail.'); return; }
    const details = { event_type: 'themed_party', motif: value('motif') || null, city: value('city'), venue: value('venue') || null, event_date: iso || null, participants: value('participants') || null, budget: value('budget') || null };
    const message = [`Motyw: ${details.motif || 'do ustalenia'}`, `Miasto: ${details.city}`, `Obiekt: ${details.venue || 'do ustalenia'}`, `Termin: ${dateText || 'do ustalenia'}`, `Uczestnicy: ${details.participants || 'do ustalenia'}`, `Budżet: ${details.budget || 'do ustalenia'}`, '', value('message')].join('\n');
    const payload = { name: value('name'), email: value('email'), phone: value('phone') || null, company: value('company') || null,
      category: 'event_inquiry', source_page: sourcePath, subject: `Wieczór tematyczny — ${details.motif || 'wybór motywu'} — ${details.city}`,
      message, intake_metadata: details, status: 'new', priority: 'high', user_agent: navigator.userAgent };
    const signature = JSON.stringify(payload);
    if (!pending.current || pending.current.signature !== signature) pending.current = { id: crypto.randomUUID(), signature };
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const id = pending.current.id;
      const { error: saveError } = await supabase.from('contact_messages').upsert({ ...payload, id }, { onConflict: 'id', ignoreDuplicates: true });
      if (saveError) throw saveError;
      trackMarketingLead('themed_party_inquiry', id);
      pending.current = null;
      setSent(true);
      form.reset();
      setDateText('');
    } catch {
      setError('Nie udało się potwierdzić wysłania zapytania. Spróbuj ponownie lub zadzwoń.');
    } finally { locked.current = false; setBusy(false); }
  }
  if (sent) return <div role="status" className="mt-7 rounded-xl bg-white/5 p-5"><h3 className="text-lg text-[#d3bb73]">Dziękujemy za zapytanie</h3><p className="mt-3 leading-7 text-white/75">Zapisaliśmy szczegóły wydarzenia. Skontaktujemy się, żeby omówić program i dostępność terminu.</p></div>;
  return <details className="mt-7 rounded-2xl bg-[#190f1b]/60 p-5 sm:p-7">
    <summary className="cursor-pointer py-2 text-lg text-[#d3bb73]">Wypełnij krótki brief wieczoru</summary>
    <p className="mt-3 text-sm leading-6 text-white/65">Wymagamy tylko miasta, imienia i e-maila. Pozostałe szczegóły mogą być jeszcze do ustalenia.</p>
    <form onSubmit={submit} className="mt-6 space-y-5">
      <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <label className="block text-sm">Motyw / pomysł na wieczór<input name="motif" defaultValue={motif} maxLength={160} placeholder="Do ustalenia" className={field} /></label>
        <label className="block text-sm">Miasto wydarzenia *<input name="city" defaultValue={cityName} required maxLength={120} className={field} /></label>
        <label className="block text-sm">Hotel / obiekt<input name="venue" maxLength={200} placeholder="Jeśli jest już wybrany" className={field} /></label>
        <div><label className="block text-sm">Termin — DD.MM.RRRR<input inputMode="numeric" maxLength={10} placeholder="Do ustalenia" value={dateText} onChange={e => setDateText(e.target.value)} className={field} /></label><label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/60">Lub wybierz z kalendarza<input type="date" value={iso || ''} onChange={e => setDateText(e.target.value ? e.target.value.split('-').reverse().join('.') : '')} className="max-w-full rounded bg-[#190f1b] px-2 py-2 text-white [color-scheme:dark]" /></label></div>
        <label className="block text-sm">Liczba uczestników<input name="participants" type="number" min="1" max="100000" step="1" className={field} /></label>
        <label className="block text-sm">Orientacyjny budżet<input name="budget" maxLength={120} placeholder="Kwota / przedział, jeśli ustalony" className={field} /></label>
        <label className="block text-sm">Imię i nazwisko *<input name="name" autoComplete="name" required maxLength={150} className={field} /></label>
        <label className="block text-sm">E-mail *<input name="email" type="email" autoComplete="email" required maxLength={254} className={field} /></label>
        <label className="block text-sm">Telefon<input name="phone" type="tel" autoComplete="tel" maxLength={40} className={field} /></label>
        <label className="block text-sm">Firma / agencja<input name="company" autoComplete="organization" maxLength={200} className={field} /></label>
        <label className="block text-sm sm:col-span-2">Co chcesz zorganizować?<textarea name="message" rows={4} maxLength={5000} placeholder="Cel spotkania, konferencja przed wieczorem, muzyka, atrakcje, godziny programu…" className={field} /></label>
      </fieldset>
      <p className="text-xs leading-5 text-white/55">Dane posłużą do odpowiedzi na zapytanie. <Link href="/polityka-prywatnosci" className="text-[#d3bb73] underline underline-offset-4">Polityka prywatności</Link>.</p>
      {error && <p role="alert" className="text-sm leading-6 text-rose-200">{error} <a href={SITE.phoneHref} className="underline">{SITE.telephone}</a></p>}
      <button disabled={busy} className="min-h-12 w-full rounded-full bg-[#d3bb73] px-6 py-3 text-sm font-medium text-[#190f1b] disabled:opacity-60 sm:w-auto">{busy ? 'Wysyłanie…' : 'Wyślij zapytanie o wieczór'}</button>
    </form>
  </details>;
}
