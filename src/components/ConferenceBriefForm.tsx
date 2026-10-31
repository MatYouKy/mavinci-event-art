'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { trackMarketingLead } from '@/lib/marketing/trackLead.client';
import { SITE } from '@/lib/SEO/site';

const scopes = ['Nagłośnienie i mikrofony', 'Ekrany LED i prezentacje', 'Oświetlenie', 'Streaming i kamery', 'Nagranie i montaż', 'Gala lub bankiet', 'Pełna obsługa techniczna'];
const fieldClass = 'mt-2 w-full rounded-lg border border-white/10 bg-[#190f1b] px-3 py-3 text-base text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';

function parseDate(value: string): string | null {
  if (!value.trim()) return '';
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export default function ConferenceBriefForm({ cityName, citySlug }: { cityName: string; citySlug: string }) {
  const [dateText, setDateText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const pending = useRef<{ id: string; signature: string } | null>(null);
  const dateIso = parseDate(dateText);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    if (dateIso === null) { setError('Podaj prawidłową datę DD.MM.RRRR lub pozostaw termin pusty.'); return; }
    const form = event.currentTarget;
    const data = new FormData(form);
    const get = (name: string) => String(data.get(name) || '').trim();
    const selectedScopes = data.getAll('scope').map(String).filter(scope => scopes.includes(scope));
    if (!get('name') || !get('email')) { setError('Uzupełnij imię i adres e-mail.'); return; }
    const details = {
      event_type: 'conference', city: get('city'), venue: get('venue'), event_date: dateIso || null,
      participants: get('participants') || null, rooms: get('rooms') || null, technical_scope: selectedScopes,
      source_city_slug: citySlug,
    };
    const message = [
      `Miasto: ${details.city}`, `Obiekt: ${details.venue || 'do ustalenia'}`,
      `Termin: ${dateText || 'do ustalenia'}`, `Uczestnicy: ${details.participants || 'do ustalenia'}`,
      `Liczba sal: ${details.rooms || 'do ustalenia'}`, `Zakres: ${selectedScopes.join(', ') || 'do ustalenia'}`,
      '', get('message'),
    ].join('\n');
    const payload = { name: get('name'), email: get('email'), phone: get('phone') || null,
      company: get('company') || null, category: 'event_inquiry', source_page: `/oferta/konferencje/${citySlug}`,
      subject: `Obsługa konferencji — ${details.city}`, message, intake_metadata: details,
      status: 'new', priority: 'high', user_agent: navigator.userAgent };
    const signature = JSON.stringify(payload);
    if (!pending.current || pending.current.signature !== signature) pending.current = { id: crypto.randomUUID(), signature };
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const id = pending.current.id;
      const { error } = await supabase.from('contact_messages').upsert({ ...payload, id }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      trackMarketingLead('conference_inquiry', id);
      pending.current = null;
      setSent(true);
      form.reset();
      setDateText('');
    } catch {
      setError('Nie udało się potwierdzić wysłania. Spróbuj ponownie lub skontaktuj się z nami telefonicznie.');
    } finally { locked.current = false; setBusy(false); }
  }

  if (sent) return <div role="status" className="mt-8 rounded-2xl bg-white/5 p-6"><h3 className="text-xl text-[#d3bb73]">Dziękujemy za brief</h3><p className="mt-3 leading-7 text-white/75">Zapytanie zostało zapisane. Skontaktujemy się, aby omówić zakres i dostępność terminu.</p></div>;
  return <details className="mt-8 rounded-2xl bg-[#491529]/25 p-5 sm:p-7">
    <summary className="cursor-pointer py-2 text-lg text-[#d3bb73]">Wypełnij krótki brief konferencji</summary>
    <p className="mt-3 text-sm leading-6 text-white/65">Nie musisz znać wszystkich szczegółów. Wymagane są tylko miasto, imię i e-mail.</p>
    <form onSubmit={submit} className="mt-6 space-y-5">
      <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <label className="block text-sm">Miasto wydarzenia *<input name="city" defaultValue={cityName} required maxLength={120} className={fieldClass} /></label>
        <label className="block text-sm">Obiekt / hotel<input name="venue" maxLength={200} placeholder="Jeśli jest już wybrany" className={fieldClass} /></label>
        <div><label htmlFor={`conference-date-${citySlug}`} className="block text-sm">Termin — DD.MM.RRRR</label><input id={`conference-date-${citySlug}`} inputMode="numeric" maxLength={10} placeholder="Do ustalenia" value={dateText} onChange={event => setDateText(event.target.value)} className={fieldClass} /><label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/60">Lub wybierz z kalendarza<input type="date" aria-label="Wybierz datę konferencji z kalendarza" value={dateIso || ''} onChange={event => setDateText(event.target.value ? event.target.value.split('-').reverse().join('.') : '')} className="max-w-full rounded bg-[#190f1b] px-2 py-2 text-white [color-scheme:dark]" /></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Uczestnicy<input name="participants" type="number" min="1" max="100000" step="1" className={fieldClass} /></label><label className="block text-sm">Liczba sal<input name="rooms" type="number" min="1" max="200" step="1" className={fieldClass} /></label></div>
      </fieldset>
      <fieldset disabled={busy}><legend className="mb-3 text-sm">Jakiego zakresu potrzebujesz?</legend><div className="grid gap-2 sm:grid-cols-2">{scopes.map(scope => <label key={scope} className="flex min-h-11 items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-white/75"><input type="checkbox" name="scope" value={scope} className="accent-[#d3bb73]" />{scope}</label>)}</div></fieldset>
      <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <label className="block text-sm">Imię i nazwisko *<input name="name" autoComplete="name" required maxLength={150} className={fieldClass} /></label>
        <label className="block text-sm">E-mail *<input name="email" type="email" autoComplete="email" required maxLength={254} className={fieldClass} /></label>
        <label className="block text-sm">Telefon<input name="phone" type="tel" autoComplete="tel" maxLength={40} className={fieldClass} /></label>
        <label className="block text-sm">Firma / agencja<input name="company" autoComplete="organization" maxLength={200} className={fieldClass} /></label>
        <label className="block text-sm sm:col-span-2">Program i dodatkowe informacje<textarea name="message" maxLength={5000} rows={4} placeholder="Godziny programu, prelegenci zdalni, bankiet, dostęp do sali…" className={fieldClass} /></label>
      </fieldset>
      <p className="text-xs leading-5 text-white/55">Dane posłużą do odpowiedzi na zapytanie. <Link href="/polityka-prywatnosci" className="text-[#d3bb73] underline underline-offset-4">Polityka prywatności</Link>.</p>
      {error && <p role="alert" className="text-sm leading-6 text-rose-200">{error} <a href={SITE.phoneHref} className="underline">{SITE.telephone}</a></p>}
      <button disabled={busy} className="min-h-12 w-full rounded-full bg-[#d3bb73] px-6 py-3 text-sm font-medium text-[#190f1b] disabled:opacity-60 sm:w-auto">{busy ? 'Wysyłanie…' : 'Wyślij brief do wyceny'}</button>
    </form>
  </details>;
}
