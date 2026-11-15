'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Building2, CalendarSearch, Check, Compass, FileText, MessageSquare, Palette, Phone, QrCode, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { SellerPortalContext } from '@/lib/seller/portal';
import type { SellerHotelContext } from '@/lib/seller/hotel';
import { SELLER_JOURNEY_STAGES } from '@/lib/seller/offerJourney';
import {
  SELLER_GUIDE_OPEN_EVENT, SELLER_GUIDE_SESSION_KEY, SELLER_ONBOARDING_STEPS,
  type SellerOnboardingFlags, type SellerOnboardingPatch, type SellerOnboardingStep,
} from '@/lib/seller/onboarding';

type Onboarding = { flags: SellerOnboardingFlags | null; update: (patch: SellerOnboardingPatch) => Promise<unknown> };

const STEP_META: Record<SellerOnboardingStep, { label: string; Icon: typeof Building2 }> = {
  hotel_checked: { label: 'Twój hotel', Icon: Building2 },
  branding_seen: { label: 'Wygląd ofert', Icon: Palette },
  manager_met: { label: 'Twój opiekun', Icon: UserRound },
  journey_seen: { label: 'Jak to działa', Icon: Compass },
  first_step: { label: 'Pierwszy krok', Icon: FileText },
};

const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#111522] hover:bg-[#dcc68a]';
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2.5 text-sm text-[#e5e4e2]/85 hover:bg-white/10';

const sessionShown = () => { try { return window.sessionStorage.getItem(SELLER_GUIDE_SESSION_KEY) === '1'; } catch { return false; } };
const markSessionShown = () => { try { window.sessionStorage.setItem(SELLER_GUIDE_SESSION_KEY, '1'); } catch { /* Blocked storage: the guide may open again. */ } };

/**
 * „Witaj w portalu MAVINCI” — przewodnik pierwszego uruchomienia (5 kroków). Otwiera się sam raz w sesji,
 * dopóki sprzedawca nie przygotuje pierwszej oferty, nie ukończy go albo nie zamknie na stałe. Ponownie: „Przewodnik” na pulpicie.
 */
export default function SellerOnboardingGuide({ context, onboarding, autoOpen }: {
  context: SellerPortalContext;
  onboarding: Onboarding;
  /** Pulpit: oferty wczytane i jeszcze żadnej nie ma. */
  autoOpen: boolean;
}) {
  const { flags, update } = onboarding;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hotel, setHotel] = useState<SellerHotelContext | null>(null);
  const [hotelError, setHotelError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const firstOpenStep = useCallback((current: SellerOnboardingFlags | null) => {
    const index = SELLER_ONBOARDING_STEPS.findIndex((key) => current?.[key] !== true);
    return index < 0 ? SELLER_ONBOARDING_STEPS.length - 1 : index;
  }, []);
  const show = useCallback((startAt?: number) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    markSessionShown();
    setStep(startAt ?? firstOpenStep(flags));
    setOpen(true);
  }, [firstOpenStep, flags]);

  useEffect(() => {
    if (!autoOpen || !flags || open) return;
    if (flags.completed || flags.dismissed || sessionShown()) return;
    show();
    // Only the first time the conditions are met in this page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, flags]);
  useEffect(() => {
    // Link „Przewodnik” z pomocy: /seller?przewodnik=1
    const params = new URLSearchParams(window.location.search);
    if (params.get('przewodnik') !== '1') return;
    params.delete('przewodnik');
    window.history.replaceState(window.history.state, '', window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash);
    show(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const handler = () => show(0);
    window.addEventListener(SELLER_GUIDE_OPEN_EVENT, handler);
    return () => window.removeEventListener(SELLER_GUIDE_OPEN_EVENT, handler);
  }, [show]);
  useEffect(() => {
    if (!open || hotel || hotelError) return;
    let active = true;
    void supabase.rpc('get_seller_hotel_context', { p_organization: context.profile.organization_id || null })
      .then(({ data, error }) => { if (!active) return; if (error) setHotelError(true); else setHotel(data as SellerHotelContext); });
    return () => { active = false; };
  }, [open, hotel, hotelError, context.profile.organization_id]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => returnFocus.current?.focus?.(), 0);
  }, []);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open, close]);

  if (!open) return null;
  const key = SELLER_ONBOARDING_STEPS[step];
  const advance = () => {
    void update({ [key]: true });
    if (step < SELLER_ONBOARDING_STEPS.length - 1) setStep(step + 1);
  };
  const finish = (patch: SellerOnboardingPatch = {}) => { void update({ first_step: true, completed: true, ...patch }); close(); };
  const organizationName = context.profile.organization?.alias || context.profile.organization?.name || 'Twój hotel';
  const rooms = (hotel?.location?.rooms || []).filter((room) => room.name?.trim());
  const branded = context.brands.some((brand) => Boolean(brand.branding?.organization_branding_configured || brand.branding?.hotel_logo_url));
  const manager = context.manager;

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="seller-guide-title"
      className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-[#1c1f33] text-[#e5e4e2] shadow-2xl outline-none sm:rounded-2xl">
      <header className="flex items-start justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">Witaj w portalu MAVINCI · krok {step + 1} z {SELLER_ONBOARDING_STEPS.length}</p>
          <h2 id="seller-guide-title" className="mt-2 text-xl font-light">{STEP_META[key].label}</h2>
        </div>
        <button type="button" onClick={close} aria-label="Zamknij przewodnik" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
      </header>
      <nav aria-label="Kroki przewodnika" className="px-5 sm:px-6">
        <ol className="grid grid-cols-5 gap-1.5">{SELLER_ONBOARDING_STEPS.map((item, index) => {
          const done = flags?.[item] === true; const current = index === step; const Icon = STEP_META[item].Icon;
          return <li key={item}><button type="button" onClick={() => setStep(index)} aria-current={current ? 'step' : undefined} aria-label={`${index + 1}. ${STEP_META[item].label}${done ? ' — zrobione' : ''}`}
            className={`flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-[10px] leading-3 transition sm:text-[11px] ${current ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : done ? 'text-emerald-200/80 hover:bg-white/5' : 'text-white/40 hover:bg-white/5'}`}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-full ${current ? 'bg-[#d3bb73]/20' : done ? 'bg-emerald-300/15' : 'bg-white/5'}`}>{done && !current ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}</span>
            <span className="hidden text-center sm:block">{STEP_META[item].label}</span>
          </button></li>;
        })}</ol>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm leading-6 sm:p-6">
        {key === 'hotel_checked' && <div className="space-y-4">
          <p className="text-white/70">Oferty przygotowujesz w imieniu: <span className="text-white">{organizationName}</span>. Sale i osoby kontaktowe hotelu pochodzą z kartoteki MAVINCI — w ofercie wybierasz je z listy, bez przepisywania.</p>
          <div className="rounded-xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-white/40">{hotel?.location?.name || 'Przestrzenie hotelu'}</p>
            {!hotel && !hotelError && <p className="mt-2 text-white/45">Wczytywanie sal…</p>}
            {hotelError && <p className="mt-2 text-white/55">Nie udało się wczytać sal. Zobaczysz je w Profilu → Przestrzenie i kontakty hotelu.</p>}
            {hotel && (rooms.length
              ? <ul className="mt-3 flex flex-wrap gap-2">{rooms.map((room) => <li key={room.id || room.name} className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs">{room.name}{room.kind === 'outdoor' ? ' · na zewnątrz' : ''}</li>)}</ul>
              : <p className="mt-2 text-amber-100/80">W bazie nie ma jeszcze sal. Napisz opiekunowi, jakie macie przestrzenie — dopisze je, a pojawią się w kreatorze ofert.</p>)}
            {hotel && <p className="mt-3 text-xs text-white/45">Osoby kontaktowe hotelu: {hotel.contacts?.length || 0}</p>}
          </div>
          <p className="text-xs text-white/45">Coś się nie zgadza? Napisz do opiekuna — to on poprawia kartotekę hotelu.</p>
          <Link href="/seller/profile#hotel-directory" onClick={close} className="inline-flex items-center gap-2 text-[#d3bb73] hover:underline"><Building2 className="h-4 w-4" />Zobacz bazę hotelu</Link>
        </div>}

        {key === 'branding_seen' && <div className="space-y-4">
          <p className="text-white/70">PDF i strona oferty dla klienta mają logo i kolory hotelu. Oferta MAVINCI jest <span className="text-white">wkładką do Twojej oferty</span>: pobierasz PDF i wysyłasz go klientowi ze swojej skrzynki — razem z własnymi materiałami.</p>
          <div className={`flex items-start gap-3 rounded-xl p-4 ${branded ? 'bg-emerald-300/[0.07]' : 'bg-amber-300/[0.07]'}`}>
            {branded ? <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-200" /> : <Palette className="mt-1 h-4 w-4 shrink-0 text-amber-100" />}
            <p className={branded ? 'text-emerald-100/90' : 'text-amber-100/90'}>{branded ? 'Logo i kolory hotelu są już ustawione — oferty wyglądają jak Twoje.' : 'Nie ma jeszcze logo hotelu. Dodaj je w Profilu — zajmie to dwie minuty, a każda kolejna oferta będzie w Twoich barwach.'}</p>
          </div>
          <Link href="/seller/profile?tab=branding" onClick={() => { void update({ branding_seen: true }); close(); }} className="inline-flex items-center gap-2 text-[#d3bb73] hover:underline"><Palette className="h-4 w-4" />{branded ? 'Zobacz wygląd ofert' : 'Ustaw wygląd ofert'}</Link>
        </div>}

        {key === 'manager_met' && <div className="space-y-4">
          <p className="text-white/70">Opiekun MAVINCI sprawdza termin, zespół i sprzęt, zgadza się na ceny spoza cennika i prowadzi z Tobą wydarzenie. Pisz do niego śmiało — także przed ofertą.</p>
          <div className="rounded-xl bg-black/20 p-4">
            {manager?.name ? <>
              <p className="text-base">{manager.name}</p>
              <p className="text-xs text-white/45">{manager.position || 'Opiekun współpracy MAVINCI'}</p>
              <div className="mt-3 space-y-1 text-white/70">
                {manager.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-[#d3bb73]" />{manager.phone}</p>}
                {manager.email && <p className="break-all">{manager.email}</p>}
              </div>
            </> : <p className="text-white/60">Opiekun zostanie przypisany wkrótce. Do tego czasu wiadomości odbiera zespół MAVINCI odpowiedzialny za współpracę z hotelami.</p>}
          </div>
          <Link href="/seller/messages" onClick={() => { void update({ manager_met: true }); close(); }} className="inline-flex items-center gap-2 text-[#d3bb73] hover:underline"><MessageSquare className="h-4 w-4" />Napisz do opiekuna</Link>
        </div>}

        {key === 'journey_seen' && <div className="space-y-4">
          <p className="text-white/70">Każda oferta przechodzi przez pięć etapów. Ten sam pasek widzisz Ty i opiekun — zawsze z jednym zdaniem „Teraz”, co dzieje się dalej.</p>
          <ol className="space-y-2">{SELLER_JOURNEY_STAGES.map((stage, index) => <li key={stage.key} className="flex items-start gap-3 rounded-lg bg-black/20 p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs text-[#d3bb73]">{index + 1}</span>
            <span><span className="block text-white">{stage.label}</span><span className="block text-xs text-white/50">{stage.hint}</span></span>
          </li>)}</ol>
          <ul className="space-y-1.5 text-xs leading-5 text-white/55">
            <li>• Pozycja własna albo cena poniżej cennika? Kreator sam poprosi opiekuna o zgodę. Do zgody PDF dla klienta czeka.</li>
            <li>• Klient powiedział „tak”? Zapisz to w ofercie („Klient zaakceptował”) — oferta od razu trafi do opiekuna.</li>
          </ul>
          <Link href="/seller/help" onClick={close} className="inline-flex items-center gap-2 text-[#d3bb73] hover:underline"><Compass className="h-4 w-4" />Pełna instrukcja portalu</Link>
        </div>}

        {key === 'first_step' && <div className="space-y-3">
          <p className="text-white/70">Od czego zaczniesz? Możesz wrócić do przewodnika z pulpitu w każdej chwili.</p>
          {[
            { href: '/seller/offers/new', Icon: FileText, title: 'Przygotuj ofertę', text: 'Klient wie, czego chce — oferta z cennikiem w kilka minut, z Twoim logo.' },
            { href: '/seller/inquiries', Icon: CalendarSearch, title: 'Sprawdź termin', text: 'Klient pyta o datę i budżet — opiekun sprawdzi dostępność i podpowie zakres.' },
            { href: '/seller/materials', Icon: QrCode, title: 'Wydrukuj kartę z kodem QR', text: 'Goście hotelu sami zapytają o wydarzenie — zapytanie trafi do Ciebie i opiekuna.' },
          ].map(({ href, Icon, title, text }) => <Link key={href} href={href} onClick={() => finish()} className="flex items-start gap-3 rounded-xl bg-black/20 p-4 transition hover:bg-black/30">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" />
            <span className="min-w-0 flex-1"><span className="block text-white">{title}</span><span className="block text-xs leading-5 text-white/50">{text}</span></span>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-white/35" />
          </Link>)}
        </div>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 p-4 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className={secondary}><ArrowLeft className="h-4 w-4" />Wstecz</button>}
          <button type="button" onClick={close} className="min-h-11 rounded-lg px-3 text-sm text-white/55 hover:text-white">Dokończę później</button>
        </div>
        {key === 'first_step'
          ? <button type="button" onClick={() => finish()} className={secondary}><Check className="h-4 w-4" />Zakończ przewodnik</button>
          : <button type="button" onClick={advance} className={primary}>{step === 0 ? 'Zgadza się, dalej' : 'Dalej'}<ArrowRight className="h-4 w-4" /></button>}
      </footer>
    </div>
  </div>;
}
