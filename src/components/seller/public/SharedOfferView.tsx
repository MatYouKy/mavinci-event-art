'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock3, Download, Loader2, Mail, MapPin, MessageCircle, Phone, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerPhoneHref, sellerWhatsAppHref } from '@/lib/seller/portal';
import { publicBranding, publicDate, publicMoney, publicText } from './publicBranding';

type SharedOffer = {
  status: 'active' | 'accepted' | 'expired' | 'revoked';
  offer?: { number: string | null; title: string; event_date: string | null; location: string | null; guest_count: number | null; client_name: string | null; client_company: string | null; valid_until: string | null; description: string | null };
  items?: { name: string; description: string | null; quantity: number; days: number; unit: string | null; unit_price_net: number; total_net: number }[];
  totals?: { net: number; vat: number; gross: number; vat_percent: number };
  branding?: { hotel_name: string | null; brand_name: string | null; has_logo?: boolean; has_cover?: boolean; snapshot: unknown };
  seller?: { name: string | null; position?: string | null; email: string | null; phone: string | null } | null;
  document?: { available: boolean; filename: string | null };
  accepted?: { at: string; name: string } | null;
};

const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const quantityLabel = (item: NonNullable<SharedOffer['items']>[number]) =>
  `${Number(item.quantity)} ${item.unit || 'szt.'}${Number(item.days) > 1 ? ` × ${item.days} dni` : ''}`;

function InactiveCard({ title, text }: { title: string; text: string }) {
  return <main className="flex min-h-[70vh] items-center justify-center bg-[#f4f1ec] px-4 pb-16 pt-10 text-[#1f1a22]">
    <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-[0_20px_60px_rgba(20,10,20,0.12)]">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-[#5d5560]">{text}</p>
    </div>
  </main>;
}

/** Public, hotel-branded offer page opened by the guest from a share link. */
export default function SharedOfferView({ token }: { token: string }) {
  const [data, setData] = useState<SharedOffer | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error } = await supabase.rpc('get_shared_seller_offer', { p_token: token });
    if (error) {
      setLoadError(/nieaktywny/i.test(error.message || '') ? 'inactive' : 'network');
      setData(null);
    } else { setData(result as SharedOffer); setLoadError(''); }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    // One view per page load (the RPC records it).
    if (loaded.current) return;
    loaded.current = true;
    void load();
    try { setPdfError(new URLSearchParams(window.location.search).get('pdf') === 'niedostepny'); } catch { /* ignore */ }
  }, [load]);

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (name.trim().length < 2) { setFormError('Podaj imię i nazwisko.'); return; }
    if (!emailPattern.test(email.trim())) { setFormError('Podaj poprawny adres e-mail.'); return; }
    if (!consent) { setFormError('Zaznacz zgodę, aby potwierdzić akceptację.'); return; }
    setSending(true); setFormError('');
    const { data: result, error } = await supabase.rpc('accept_shared_seller_offer', { p_token: token, p_name: name.trim(), p_email: email.trim(), p_note: note.trim(), p_consent: true });
    setSending(false);
    if (error) { setFormError(error.message || 'Nie udało się zapisać akceptacji. Spróbuj ponownie.'); return; }
    const acceptedAt = (result as { accepted_at?: string } | null)?.accepted_at || new Date().toISOString();
    setData((current) => current ? { ...current, status: 'accepted', accepted: { at: acceptedAt, name: name.trim() } } : current);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading && !data) return <main role="status" className="flex min-h-[70vh] items-center justify-center gap-2 bg-[#f4f1ec] pt-10 text-[#5d5560]"><Loader2 className="h-5 w-5 animate-spin" />Wczytywanie oferty…</main>;
  if (loadError === 'inactive' || data?.status === 'revoked') return <InactiveCard title="Ten link do oferty jest nieaktywny" text="Oferta mogła zostać wycofana lub zastąpiona nowszą wersją. Skontaktuj się z osobą, która przesłała Ci link." />;
  if (loadError || !data?.offer) return <main className="flex min-h-[70vh] items-center justify-center bg-[#f4f1ec] px-4 pt-10 text-[#1f1a22]"><div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg"><h1 className="text-xl font-semibold">Nie udało się wczytać oferty</h1><p className="mt-3 text-sm text-[#5d5560]">Sprawdź połączenie z internetem i spróbuj ponownie.</p><button type="button" onClick={() => void load()} className="mt-5 min-h-11 rounded-lg bg-[#1f1a22] px-5 text-sm text-white">Spróbuj ponownie</button></div></main>;

  const offer = data.offer;
  const snapshot = data.branding?.snapshot;
  // Logo hotelu leży w prywatnym buckecie — trasa serwera podpisuje krótki link (tylko dla aktywnego linku gościa).
  const brand = publicBranding(snapshot, data.branding?.has_logo ? `/bridge/public/seller-offer-asset?token=${encodeURIComponent(token)}&kind=logo` : null);
  const hotel = data.branding?.hotel_name || publicText(snapshot, 'organization_name') || 'Oferta wydarzenia';
  const client = [offer.client_company, offer.client_name].filter(Boolean).join(' · ');
  const eventDate = publicDate(offer.event_date);
  const validUntil = publicDate(offer.valid_until);
  const seller = data.seller;
  const phoneHref = sellerPhoneHref(seller?.phone);
  const whatsAppHref = sellerWhatsAppHref(seller?.phone);
  const footer = publicText(snapshot, 'footer_text');
  const disclosure = publicText(snapshot, 'disclosure_text');

  return <main className="bg-[#f4f1ec] pb-16 text-[#1f1a22]">
    <section style={{ backgroundColor: brand.primary, color: brand.onPrimary }} className="px-4 pb-24 pt-10 sm:pt-14">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          {brand.logoUrl
            // eslint-disable-next-line @next/next/no-img-element -- hotel logo from the offer branding (public URL).
            ? <img src={brand.logoUrl} alt={hotel} className="h-12 max-w-[11rem] object-contain" />
            : <p className="text-lg font-semibold tracking-wide">{hotel}</p>}
        </div>
        <p className="mt-8 text-xs uppercase tracking-[0.2em] opacity-75">{client ? `Oferta dla: ${client}` : 'Oferta wydarzenia'}{offer.number ? ` · ${offer.number}` : ''}</p>
        <h1 className="mt-3 text-3xl font-light leading-tight sm:text-4xl">{offer.title}</h1>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm opacity-90">
          {eventDate && <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />{eventDate}</span>}
          {offer.location && <span className="flex items-center gap-2"><MapPin className="h-4 w-4" />{offer.location}</span>}
          {offer.guest_count ? <span className="flex items-center gap-2"><Users className="h-4 w-4" />{offer.guest_count} gości</span> : null}
        </div>
      </div>
    </section>

    <div className="mx-auto -mt-16 max-w-3xl space-y-5 px-4">
      {data.status === 'accepted' && <div role="status" className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-5 text-emerald-900 shadow-sm">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
        <div><p className="font-semibold">Oferta zaakceptowana</p><p className="mt-1 text-sm">{data.accepted?.name ? `${data.accepted.name} · ` : ''}{data.accepted?.at ? new Date(data.accepted.at).toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }) : ''}. Dziękujemy! Skontaktujemy się, aby potwierdzić szczegóły wydarzenia.</p></div>
      </div>}
      {data.status === 'expired' && <div role="status" className="flex items-start gap-3 rounded-2xl bg-amber-50 p-5 text-amber-900 shadow-sm">
        <Clock3 className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
        <div><p className="font-semibold">Termin ważności oferty minął</p><p className="mt-1 text-sm">Skontaktuj się z hotelem — chętnie przygotujemy aktualną propozycję.</p></div>
      </div>}

      <section aria-labelledby="shared-offer-items" className="rounded-2xl bg-white p-5 shadow-[0_20px_60px_rgba(20,10,20,0.08)] sm:p-7">
        {offer.description && <p className="mb-6 whitespace-pre-wrap text-[15px] leading-7 text-[#3d3640]">{offer.description}</p>}
        <h2 id="shared-offer-items" className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: brand.onPrimary === '#ffffff' ? brand.primary : '#5d5560' }}>W ofercie</h2>
        <ul className="mt-3 divide-y divide-[#1f1a22]/[0.06]">{(data.items || []).map((item, index) => <li key={`${item.name}-${index}`} className="py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><p className="font-medium">{item.name}</p><p className="mt-0.5 text-xs text-[#6d6570]">{quantityLabel(item)} · {publicMoney(item.unit_price_net)} netto / {item.unit || 'szt.'}</p></div>
            <p className="shrink-0 text-right font-medium">{publicMoney(item.total_net)}</p>
          </div>
          {item.description && <details className="mt-2 text-sm text-[#4d4550]"><summary className="cursor-pointer text-xs text-[#6d6570]">Szczegóły</summary><p className="mt-2 whitespace-pre-wrap leading-6">{item.description}</p></details>}
        </li>)}</ul>
        {data.totals && <dl className="mt-4 space-y-2 rounded-xl bg-[#f6f3ef] p-4 text-sm">
          <div className="flex justify-between"><dt className="text-[#5d5560]">Razem netto</dt><dd>{publicMoney(data.totals.net)}</dd></div>
          <div className="flex justify-between"><dt className="text-[#5d5560]">VAT {Number(data.totals.vat_percent)}%</dt><dd>{publicMoney(data.totals.vat)}</dd></div>
          <div className="flex justify-between pt-2 text-base font-semibold"><dt>Razem brutto</dt><dd>{publicMoney(data.totals.gross)}</dd></div>
        </dl>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {data.document?.available && <a href={`/bridge/public/seller-offer-pdf?token=${encodeURIComponent(token)}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium" style={{ backgroundColor: brand.primary, color: brand.onPrimary }}><Download className="h-4 w-4" />Pobierz PDF</a>}
          {validUntil && <p className="text-xs text-[#6d6570]">Oferta ważna do {validUntil}</p>}
        </div>
        {pdfError && <p role="alert" className="mt-3 text-sm text-amber-800">Plik PDF jest chwilowo niedostępny. Spróbuj ponownie za chwilę lub poproś o przesłanie dokumentu.</p>}
      </section>

      {data.status === 'active' && <section aria-labelledby="shared-offer-accept" className="rounded-2xl bg-white p-5 shadow-[0_20px_60px_rgba(20,10,20,0.08)] sm:p-7">
        <h2 id="shared-offer-accept" className="text-xl font-light">Akceptuję ofertę</h2>
        <p className="mt-1 text-sm text-[#5d5560]">Potwierdź wybór — hotel i zespół wydarzenia skontaktują się, aby ustalić szczegóły.</p>
        <form onSubmit={accept} noValidate className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-[#5d5560]">Imię i nazwisko<input required autoComplete="name" maxLength={200} value={name} onChange={(event) => { setName(event.target.value); setFormError(''); }} className="mt-1.5 min-h-12 w-full rounded-lg bg-[#f4f1ec] px-3 text-base text-[#1f1a22] outline-none ring-1 ring-transparent focus:ring-[#1f1a22]/20" /></label>
            <label className="text-xs text-[#5d5560]">E-mail<input required type="email" inputMode="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => { setEmail(event.target.value); setFormError(''); }} className="mt-1.5 min-h-12 w-full rounded-lg bg-[#f4f1ec] px-3 text-base text-[#1f1a22] outline-none ring-1 ring-transparent focus:ring-[#1f1a22]/20" /></label>
          </div>
          <label className="block text-xs text-[#5d5560]">Uwagi (opcjonalnie)<textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1.5 w-full rounded-lg bg-[#f4f1ec] px-3 py-2.5 text-base text-[#1f1a22] outline-none ring-1 ring-transparent focus:ring-[#1f1a22]/20" placeholder="np. prosimy o kontakt po 16:00" /></label>
          <label className="flex items-start gap-3 text-sm leading-6 text-[#3d3640]"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setFormError(''); }} className="mt-1 h-5 w-5 shrink-0" style={{ accentColor: brand.primary }} />
            <span>Akceptuję ofertę w przedstawionym zakresie i zgadzam się na kontakt w sprawie realizacji wydarzenia. Szczegóły i warunki zostaną potwierdzone przed realizacją. <Link href="/polityka-prywatnosci" target="_blank" className="underline underline-offset-2">Polityka prywatności</Link></span></label>
          {formError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{formError}</p>}
          <button type="submit" disabled={sending} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-medium disabled:opacity-60 sm:w-auto sm:px-8" style={{ backgroundColor: brand.primary, color: brand.onPrimary }}>{sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}{sending ? 'Zapisywanie…' : 'Akceptuję ofertę'}</button>
        </form>
      </section>}

      {seller && (seller.name || seller.email || seller.phone) && <section aria-labelledby="shared-offer-contact" className="rounded-2xl bg-white p-5 shadow-[0_20px_60px_rgba(20,10,20,0.08)] sm:p-7">
        <h2 id="shared-offer-contact" className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6d6570]">Masz pytania?</h2>
        <p className="mt-2 text-lg">{seller.name || hotel}</p>
        <p className="text-sm text-[#6d6570]">{[seller.position, hotel].filter(Boolean).join(' · ')}</p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          {phoneHref && <a href={phoneHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#f4f1ec] px-4 text-sm"><Phone className="h-4 w-4" />{seller.phone}</a>}
          {whatsAppHref && <a href={whatsAppHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#f4f1ec] px-4 text-sm"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
          {seller.email && <a href={`mailto:${seller.email}`} className="inline-flex min-h-11 items-center gap-2 break-all rounded-lg bg-[#f4f1ec] px-4 text-sm"><Mail className="h-4 w-4 shrink-0" />{seller.email}</a>}
        </div>
      </section>}

      <footer className="space-y-2 px-1 text-center text-xs leading-5 text-[#7d7580]">
        {footer && <p className="whitespace-pre-wrap">{footer}</p>}
        {disclosure && <p className="whitespace-pre-wrap">{disclosure}</p>}
        {data.branding?.brand_name && <p>Realizacja wydarzenia: {data.branding.brand_name}</p>}
      </footer>
    </div>
  </main>;
}
