'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgePercent, FileText, LayoutDashboard, Maximize2, Minimize2, Route, Send, Wand2, X, type LucideIcon } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import DemoDashboard from './DemoDashboard';
import DemoOfferWizard from './DemoOfferWizard';
import DemoGuestOffer from './DemoGuestOffer';
import DemoEarnings from './DemoEarnings';
import DemoHowItWorks from './DemoHowItWorks';
import { defaultDraft, hexAlpha, initials, readableOn, type DemoConfig, type DemoOfferDraft, type DemoService } from './demoData';

export type DemoTab = 'dashboard' | 'wizard' | 'guest' | 'earnings' | 'how';

type Props = {
  config: DemoConfig;
  services: DemoService[];
  servicesSource: 'catalog' | 'sample';
  onExit: () => void;
};

const exitFullscreen = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* brak wsparcia */ } };

/** Pełnoekranowy pokaz portalu sprzedawcy w barwach hotelu — wyraźnie oznaczony jako tryb pokazowy. */
export default function DemoPresentation({ config, services, servicesSource, onExit }: Props) {
  const [tab, setTab] = useState<DemoTab>('dashboard');
  const [draft, setDraft] = useState<DemoOfferDraft>(defaultDraft);
  const [fullscreen, setFullscreen] = useState(false);
  const hotel = config.hotelName.trim() || 'Twój hotel';
  const brand = config.brand?.name || 'MAVINCI';
  const onAccent = readableOn(config.accent);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => { document.body.style.overflow = previous; document.removeEventListener('fullscreenchange', sync); exitFullscreen(); };
  }, []);
  useEffect(() => { if (!config.showEarnings && tab === 'earnings') setTab('dashboard'); }, [config.showEarnings, tab]);
  useEffect(() => { document.getElementById('demo-scroll')?.scrollTo({ top: 0 }); }, [tab]);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch { /* np. Safari na iPhone — pokaz działa także bez pełnego ekranu */ }
  };

  const tabs: { id: DemoTab; label: string; icon: LucideIcon }[] = [
    { id: 'dashboard', label: 'Pulpit', icon: LayoutDashboard },
    { id: 'wizard', label: 'Kreator oferty', icon: Wand2 },
    { id: 'guest', label: 'Oferta dla gościa', icon: FileText },
    ...(config.showEarnings ? [{ id: 'earnings' as DemoTab, label: 'Wynagrodzenie', icon: BadgePercent }] : []),
    { id: 'how', label: 'Jak to działa', icon: Route },
  ];

  return <OverlayPortal><div className="fixed inset-0 z-[90] flex flex-col bg-[#0f1119] text-[#e5e4e2]" role="dialog" aria-modal="true" aria-label={`Pokaz portalu — ${hotel}`}>
    <header className="shrink-0" style={{ background: `linear-gradient(120deg, ${hexAlpha(config.accent, 0.28)}, #151827 55%)` }}>
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/95 md:h-12 md:w-12">
          {config.logoUrl ? <img src={config.logoUrl} alt={`Logo ${hotel}`} className="h-full w-full object-contain p-1.5" /> : <span className="text-sm font-medium text-[#111522]/70">{initials(hotel)}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium md:text-lg">{hotel}</p>
          <p className="truncate text-xs text-white/55">Portal sprzedawcy · w partnerstwie z {brand}</p>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-amber-300/15 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-100 sm:inline-flex">Tryb pokazowy</span>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/10">{fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}</button>
        <button type="button" onClick={() => { exitFullscreen(); onExit(); }} className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-white/[0.06] px-3 text-sm hover:bg-white/10"><X className="h-5 w-5" /><span className="hidden md:inline">Zakończ pokaz</span></button>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:px-5" aria-label="Sekcje pokazu">
        {tabs.map(item => {
          const active = tab === item.id;
          return <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={active ? 'page' : undefined} className={`flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-4 text-sm transition-colors ${active ? '' : 'text-white/60 hover:bg-white/5 hover:text-white'}`} style={active ? { background: hexAlpha(config.accent, 0.22), color: '#fff' } : undefined}>
            <item.icon className="h-4 w-4" style={active ? { color: config.accent } : undefined} />{item.label}
          </button>;
        })}
      </nav>
    </header>

    <main id="demo-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        {tab === 'dashboard' && <DemoDashboard config={config} onNavigate={setTab} />}
        {tab === 'wizard' && <DemoOfferWizard config={config} services={services} servicesSource={servicesSource} draft={draft} onDraftChange={setDraft} onShowGuestOffer={() => setTab('guest')} />}
        {tab === 'guest' && <DemoGuestOffer config={config} services={services} draft={draft} onEdit={() => setTab('wizard')} />}
        {tab === 'earnings' && config.showEarnings && <DemoEarnings config={config} />}
        {tab === 'how' && <DemoHowItWorks config={config} />}

        <section className="mt-10 flex flex-col items-start justify-between gap-4 rounded-3xl p-6 md:flex-row md:items-center md:p-8" style={{ background: `linear-gradient(120deg, ${hexAlpha(config.accent, 0.3)}, ${hexAlpha(config.accent, 0.08)})` }}>
          <div>
            <p className="text-xl font-light md:text-2xl">Zaczynamy współpracę?</p>
            <p className="mt-1 max-w-xl text-sm text-white/65">Wyślemy zaproszenie do portalu osobie z hotelu. Pierwszą ofertę przygotujecie razem z opiekunem{config.presenterName ? ` — ${config.presenterName}` : ''}.</p>
          </div>
          <Link href="/crm/salespeople?new=1" onClick={exitFullscreen} className="inline-flex min-h-14 items-center gap-3 rounded-2xl px-6 text-base font-medium shadow-lg transition-transform hover:scale-[1.02]" style={{ background: config.accent, color: onAccent }}>
            <Send className="h-5 w-5" />Zaproś hotel do portalu
          </Link>
        </section>
        <p className="mt-6 pb-4 text-center text-xs text-white/30">Tryb pokazowy — wszystkie dane są przykładowe. Nic nie zostało zapisane ani wysłane.{servicesSource === 'catalog' ? ' Usługi pochodzą z aktualnego katalogu; ceny są poglądowe.' : ''}</p>
      </div>
    </main>
    <span className="pointer-events-none fixed bottom-3 right-3 z-[91] rounded-full bg-amber-300/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#111522] shadow-lg sm:hidden">Tryb pokazowy</span>
  </div></OverlayPortal>;
}
