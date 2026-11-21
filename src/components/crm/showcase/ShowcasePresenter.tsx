'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, Eye, EyeOff, Images, MapPin, Maximize2, Minimize2, Star, X } from 'lucide-react';
import {
  SHOWCASE_DEVICES, formatShowcasePrice, showcaseMediaKey, showcaseVisibleBlocks,
  type ShowcaseBlock, type ShowcaseBrand, type ShowcaseDevice, type ShowcaseItemDetail, type ShowcaseItemSummary, type ShowcaseMedia,
  type ShowcaseProductView, type ShowcaseRealizationView, type ShowcaseSectionView, type ShowcaseUrls,
} from '@/lib/showcase/showcaseShared';
import { SectionIcon } from './showcaseUi';
import { OfferAddButton, ShowcaseOfferSheet, useShowcaseOffer, type ShowcaseOfferChoice } from './ShowcaseOfferSheet';

/*
 * Podgląd prezentacji jak na iPadzie (poziomo: iPad Pro 13″ albo iPad Air 11″) — ten sam układ, który dostanie tryb
 * prezentacji na iPadzie (etap 2): działy → karty → karta (zdjęcie główne, wstęp, bloki z nawigacją), galeria na pełnym
 * ekranie, ceny ukryte z przełącznikiem. Marka z księgi znaku (logo, sygnet, kolory i fonty według ról). Puste i ukryte bloki
 * oraz ukryte działy i karty nie pokazują się (kartę otwartą z edytora widać także przed zapisem i gdy jest ukryta).
 * „Do oferty” przy wariantach, pakietach i w nagłówku karty + „Oferta” w pasku: oferta ze spotkania (`ShowcaseOfferSheet`).
 */

type Screen = { kind: 'home' } | { kind: 'section'; id: string } | { kind: 'item'; id: string; sectionId: string | null };
type Lightbox = { photos: ShowcaseMedia[]; index: number; urls: ShowcaseUrls };
const TEXT = '#e5e4e2';

export default function ShowcasePresenter({ brand, sections, items, urls, loadItem, draft = null, start, onClose }: {
  brand: ShowcaseBrand;
  sections: ShowcaseSectionView[];
  items: ShowcaseItemSummary[];
  urls: ShowcaseUrls;
  loadItem: (id: string) => Promise<ShowcaseItemDetail>;
  draft?: ShowcaseItemDetail | null;
  start?: { sectionId?: string | null; itemId?: string | null };
  onClose: () => void;
}) {
  const [device, setDevice] = useState<ShowcaseDevice>(() => {
    try { return (window.localStorage.getItem('mavinci.showcase.device') as ShowcaseDevice) || 'ipad13'; } catch { return 'ipad13'; }
  });
  const size = SHOWCASE_DEVICES.find((item) => item.key === device) || SHOWCASE_DEVICES[0];
  const [screen, setScreen] = useState<Screen>(() => (start?.itemId
    ? { kind: 'item', id: start.itemId, sectionId: start.sectionId || null }
    : start?.sectionId ? { kind: 'section', id: start.sectionId } : { kind: 'home' }));
  /** Kierunek wejścia ekranu (animacja): 1 — następny (z prawej), -1 — poprzedni (z lewej), 0 — bez przesunięcia. */
  const [motion, setMotion] = useState<Motion>(0);
  const [showPrices, setShowPrices] = useState(false);
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  const offer = useShowcaseOffer();
  const canOffer = Boolean(offer.setup?.canOffer);
  const [offerOpen, setOfferOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [details, setDetails] = useState<Record<string, ShowcaseItemDetail>>({});
  const [problem, setProblem] = useState('');
  const overlay = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  // Tablet (sam dotyk) — od razu pokaz na całym ekranie, bez ramki iPada; na komputerze — podgląd w ramce z przełącznikiem.
  const touchOnly = useMemo(() => { try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; } }, []);
  const [full, setFull] = useState(touchOnly);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const fullscreenSupported = useMemo(() => {
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  }, []);
  const [browserFull, setBrowserFull] = useState(false);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth - 48;
      const height = element.clientHeight - 48;
      setScale(Math.max(0.2, Math.min(1, width / (size.width + 28), height / (size.height + 28))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size.width, size.height, full]);

  useEffect(() => {
    try { window.localStorage.setItem('mavinci.showcase.device', device); } catch { /* bez pamięci przeglądarki */ }
  }, [device]);

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const fullscreen = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setBrowserFull(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', fullscreen);
    document.addEventListener('webkitfullscreenchange', fullscreen);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', fullscreen);
      document.removeEventListener('webkitfullscreenchange', fullscreen);
      exitBrowserFull();
    };
  }, []);

  // Ekran nie gaśnie w trakcie pokazu na pełnym ekranie (Safari na iPadzie 16.4+, Chrome; bez obsługi — bez zmian).
  useEffect(() => {
    if (!full) return;
    type Lock = { release: () => Promise<void> };
    const wake = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Lock> } }).wakeLock;
    if (!wake) return;
    let lock: Lock | null = null;
    let active = true;
    const request = () => { wake.request('screen').then((value) => { if (active) lock = value; else void value.release().catch(() => undefined); }).catch(() => undefined); };
    const visible = () => { if (document.visibilityState === 'visible' && active) request(); };
    request();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', visible);
      if (lock) void lock.release().catch(() => undefined);
    };
  }, [full]);

  const enterBrowserFull = () => {
    const element = overlay.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!element) return;
    try {
      if (element.requestFullscreen) void element.requestFullscreen().catch(() => undefined);
      else element.webkitRequestFullscreen?.();
    } catch { /* bez pełnego ekranu przeglądarki — pokaz i tak zajmuje całe okno */ }
  };
  const close = () => { exitBrowserFull(); onClose(); };

  // Komunikat w scenie pokazu (na pełnym ekranie globalny pasek komunikatów jest niewidoczny).
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === 'error' ? 7000 : 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const addToOffer = useCallback((product: ShowcaseProductView, choice: ShowcaseOfferChoice, item: { id: string; title: string }) => {
    const { result, label } = offer.add(product, choice, item);
    if (result === 'added') setNotice({ text: `Dodano do oferty: ${label}`, tone: 'info', openOffer: true });
    else if (result === 'exists') setNotice({ text: `„${label}” jest już w ofercie.`, tone: 'info', openOffer: true });
    else if (result === 'full') setNotice({ text: 'Oferta ze spotkania może mieć najwyżej 30 pozycji.', tone: 'error' });
    else setNotice({ text: `„${label}” dodasz w edytorze oferty po jej utworzeniu.`, tone: 'error' });
  }, [offer]);

  const itemId = screen.kind === 'item' ? screen.id : null;
  useEffect(() => {
    if (!itemId || (draft && draft.item.id === itemId) || details[itemId]) return;
    let active = true;
    setProblem('');
    loadItem(itemId).then((value) => { if (active) setDetails((current) => ({ ...current, [itemId]: value })); })
      .catch((cause) => { if (active) setProblem(cause instanceof Error ? cause.message : 'Nie udało się otworzyć karty.'); });
    return () => { active = false; };
  }, [itemId, draft, details, loadItem]);

  const visibleSections = useMemo(() => sortShown(sections.filter((section) => section.isActive)), [sections]);
  const visibleItems = useCallback((sectionId: string) => sortShown(items.filter((item) => item.sectionId === sectionId && item.isActive)), [items]);
  const current = itemId ? (draft && draft.item.id === itemId ? draft : details[itemId]) : null;
  /** Układ ekranu: w ramce — wybrany iPad; na pełnym ekranie — według szerokości (13″ od 1300 pt, mniejsze jak 11″). */
  const layout: ShowcaseDevice = full ? (viewport.width >= 1300 ? 'ipad13' : 'ipad11') : device;

  const headingFamily = brand.headingFont ? `${brand.headingFont.url ? "'ShowcaseHeading', " : ''}${brand.headingFont.family}, system-ui, sans-serif` : 'system-ui, sans-serif';
  const bodyFamily = brand.bodyFont ? `${brand.bodyFont.url ? "'ShowcaseBody', " : ''}${brand.bodyFont.family}, system-ui, sans-serif` : 'system-ui, sans-serif';
  const fontFaces = [
    brand.headingFont?.url ? `@font-face{font-family:'ShowcaseHeading';src:url('${brand.headingFont.url.replace(/'/g, '%27')}');font-display:swap}` : '',
    brand.bodyFont?.url ? `@font-face{font-family:'ShowcaseBody';src:url('${brand.bodyFont.url.replace(/'/g, '%27')}');font-display:swap}` : '',
  ].join('');
  const theme = { accent: brand.accent, surface: brand.surface, heading: headingFamily };

  const go = (next: Screen, direction: Motion = 0) => { setMotion(direction); setScreen(next); };
  const back = () => {
    if (screen.kind === 'item') go(screen.sectionId ? { kind: 'section', id: screen.sectionId } : { kind: 'home' });
    else go({ kind: 'home' });
  };
  const openPhotos = useCallback((photos: ShowcaseMedia[], index: number, photoUrls: ShowcaseUrls) => setLightbox({ photos, index, urls: photoUrls }), []);

  const section = screen.kind === 'section' ? visibleSections.find((entry) => entry.id === screen.id) || sections.find((entry) => entry.id === screen.id) : null;
  const itemSection = screen.kind === 'item' && screen.sectionId ? sections.find((entry) => entry.id === screen.sectionId) || null : null;
  const siblings = screen.kind === 'item' && screen.sectionId ? visibleItems(screen.sectionId) : [];
  const itemIndex = screen.kind === 'item' ? siblings.findIndex((entry) => entry.id === screen.id) : -1;
  const sectionIndex = section ? visibleSections.findIndex((entry) => entry.id === section.id) : -1;

  /** Poprzedni / następny na tym samym poziomie: dział ↔ dział, karta ↔ karta w dziale (bez zawijania). */
  const step = (direction: 1 | -1) => {
    if (screen.kind === 'section' && sectionIndex >= 0) {
      const target = visibleSections[sectionIndex + direction];
      if (target) go({ kind: 'section', id: target.id }, direction);
    }
    if (screen.kind === 'item' && itemIndex >= 0) {
      const target = siblings[itemIndex + direction];
      if (target) go({ kind: 'item', id: target.id, sectionId: target.sectionId }, direction);
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  // Esc: na pełnym ekranie komputera — powrót do podglądu w ramce; na tablecie i w ramce — zamknięcie podglądu.
  const escape = () => { if (full && !touchOnly) { exitBrowserFull(); setFull(false); } else close(); };
  const escapeRef = useRef(escape);
  escapeRef.current = escape;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Arkusz oferty: Esc zamyka arkusz, strzałki służą polom formularza.
      if (offerOpen) { if (event.key === 'Escape') setOfferOpen(false); return; }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'Escape') { if (lightbox) setLightbox(null); else escapeRef.current(); return; }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      if (lightbox) setLightbox((value) => (value ? { ...value, index: (value.index + direction + value.photos.length) % value.photos.length } : value));
      else stepRef.current(direction);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox, offerOpen]);

  const animation = motion === 1 ? 'showcase-next' : motion === -1 ? 'showcase-prev' : 'showcase-fade';
  const screenKey = screen.kind === 'home' ? 'home' : `${screen.kind}:${screen.id}`;
  const roundButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/30';

  const stage = (
    <>
      {/* Pasek górny */}
      <div className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-3 px-6" style={{ background: screen.kind === 'item' ? brand.surface : `linear-gradient(${brand.surface}, ${brand.surface}e6 70%, transparent)` }}>
        {screen.kind !== 'home' ? (
          <button type="button" onClick={back} className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-black/30 pl-3 pr-4 text-[16px]" style={{ color: brand.accent }}>
            <ChevronLeft className="h-5 w-5" />Wróć
          </button>
        ) : brand.sygnetUrl ? <img src={brand.sygnetUrl} alt="" className="h-8 w-8 object-contain" /> : null}
        <div className="flex min-w-0 flex-1 items-center gap-1 text-[15px] text-[#e5e4e2]/70">
          {screen.kind === 'item' && itemSection ? (
            <>
              <button type="button" onClick={() => go({ kind: 'section', id: itemSection.id })} className="h-11 max-w-[45%] shrink-0 truncate rounded-full px-2 hover:text-[#e5e4e2]" title="Przejdź do działu">
                {itemSection.title}
              </button>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
              <span className="min-w-0 truncate">{current?.item.title || ''}</span>
            </>
          ) : <span className="min-w-0 truncate">{screen.kind === 'home' ? brand.name : screen.kind === 'section' ? section?.title || '' : current?.item.title || ''}</span>}
        </div>
        {canOffer && (
          <button type="button" onClick={() => { setOfferOpen(true); setNotice((value) => (value?.openOffer ? null : value)); }} title="Oferta dla klienta ze spotkania"
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[15px]"
            style={offer.draft.lines.length ? { borderColor: brand.accent, background: brand.accent, color: brand.surface } : { borderColor: `${brand.accent}66`, color: brand.accent }}>
            <ClipboardList className="h-4 w-4" />Oferta{offer.draft.lines.length ? ` · ${offer.draft.lines.length}` : ''}
          </button>
        )}
        <button type="button" onClick={() => setShowPrices((value) => !value)} aria-pressed={showPrices}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[15px]" style={{ borderColor: `${brand.accent}66`, color: showPrices ? brand.surface : brand.accent, background: showPrices ? brand.accent : 'transparent' }}>
          {showPrices ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{showPrices ? 'Ceny widoczne' : 'Ceny'}
        </button>
        {full && fullscreenSupported && (
          <button type="button" onClick={() => (browserFull ? exitBrowserFull() : enterBrowserFull())} className={roundButton} style={{ color: brand.accent }}
            aria-label={browserFull ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'} title={browserFull ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'}>
            {browserFull ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        )}
        {full && (
          <button type="button" onClick={() => { if (touchOnly) close(); else { exitBrowserFull(); setFull(false); } }} className={roundButton} style={{ color: brand.accent }}
            aria-label={touchOnly ? 'Zakończ pokaz' : 'Wróć do podglądu w ramce'} title={touchOnly ? 'Zakończ pokaz' : 'Wróć do podglądu w ramce'}>
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div key={screenKey} className={`h-full w-full ${animation}`}>
        {screen.kind === 'home' && (
          <HomeScreen brand={brand} sections={visibleSections} urls={urls} theme={theme} layout={layout} itemCount={(id) => visibleItems(id).length}
            onOpen={(id) => go({ kind: 'section', id })} />
        )}

        {screen.kind === 'section' && section && (
          <SectionScreen section={section} sections={visibleSections} items={visibleItems(section.id)} urls={urls} theme={theme} layout={layout}
            onSection={(id) => { const index = visibleSections.findIndex((entry) => entry.id === id); go({ kind: 'section', id }, index > sectionIndex ? 1 : index < sectionIndex ? -1 : 0); }}
            onItem={(item) => go({ kind: 'item', id: item.id, sectionId: section.id })}
            onStep={sectionIndex >= 0 && visibleSections.length > 1 ? step : undefined} />
        )}

        {screen.kind === 'item' && (
          current
            ? <ItemScreen detail={current} theme={theme} showPrices={showPrices} openPhotos={openPhotos} wide={layout === 'ipad13'}
                offer={canOffer ? { has: offer.has, add: (product, choice) => addToOffer(product, choice, { id: current.item.id, title: current.item.title }) } : null}
                nav={itemIndex >= 0 && siblings.length > 1 ? { prev: siblings[itemIndex - 1] || null, next: siblings[itemIndex + 1] || null, index: itemIndex, count: siblings.length, sectionTitle: itemSection?.title || '', urls, step } : null} />
            : <div className="flex h-full items-center justify-center text-[18px] text-[#e5e4e2]/50">{problem || 'Wczytuję kartę…'}</div>
        )}
      </div>

      {lightbox && <LightboxView lightbox={lightbox} accent={brand.accent} onChange={setLightbox} />}

      {offerOpen && (
        <ShowcaseOfferSheet offer={offer} theme={theme} onClose={() => setOfferOpen(false)} onNotice={(text, tone = 'info') => setNotice({ text, tone })} />
      )}

      {notice && (
        // Przy otwartym arkuszu oferty — u góry (dół zajmuje podsumowanie i „Utwórz ofertę”).
        <div className={`pointer-events-none absolute inset-x-0 z-50 flex justify-center px-6 ${offerOpen ? 'top-20' : 'bottom-6'}`} role="status" aria-live="polite">
          <div className={`pointer-events-auto flex max-w-[760px] items-center gap-4 rounded-2xl px-5 py-3 text-[16px] shadow-2xl ring-1 ring-white/10 ${notice.tone === 'error' ? 'bg-red-900/95' : ''}`}
            style={notice.tone === 'error' ? undefined : { background: brand.surface }}>
            {notice.tone === 'error' ? <AlertTriangle className="h-5 w-5 shrink-0 text-red-200" /> : <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: brand.accent }} />}
            <span className="min-w-0 flex-1">{notice.text}</span>
            {notice.openOffer && !offerOpen && (
              <button type="button" onClick={() => { setOfferOpen(true); setNotice(null); }} className="h-10 shrink-0 rounded-full px-4 text-[15px] font-medium"
                style={{ background: brand.accent, color: brand.surface }}>Pokaż ofertę</button>
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div ref={overlay} className={`fixed inset-0 z-[60] flex flex-col ${full ? 'bg-black' : 'bg-black/85 backdrop-blur-sm'}`} data-app-overlay="true">
      <style>{`${fontFaces}${SHOWCASE_MOTION_CSS}`}</style>
      {full ? (
        <div className="relative min-h-0 w-full flex-1 overflow-hidden" style={{ background: brand.surface, color: TEXT, fontFamily: bodyFamily }}>{stage}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-[#e5e4e2]">
            <span className="mr-auto text-[#e5e4e2]/70">Podgląd jak na iPadzie (poziomo) — tak zobaczy to klient na spotkaniu. Na tablecie: przesuń palcem w bok — następny dział, karta, zdjęcie.</span>
            {SHOWCASE_DEVICES.map((item) => (
              <button key={item.key} type="button" onClick={() => setDevice(item.key)}
                className={`rounded-lg px-2.5 py-1 text-xs ${device === item.key ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>{item.label}</button>
            ))}
            <button type="button" onClick={() => { setFull(true); enterBrowserFull(); }} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-[#e5e4e2]/70 hover:bg-white/10 hover:text-white"
              title="Pokaz na całym ekranie — jak na spotkaniu (Esc albo ✕ wraca do podglądu)">
              <Maximize2 className="h-3.5 w-3.5" />Pokaz na pełnym ekranie
            </button>
            <button type="button" onClick={close} aria-label="Zamknij podgląd" className="rounded-lg p-1.5 text-[#e5e4e2]/70 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div ref={frame} className="flex min-h-0 flex-1 items-center justify-center">
            <div style={{ width: (size.width + 28) * scale, height: (size.height + 28) * scale }}>
              <div style={{ width: size.width + 28, height: size.height + 28, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                className="rounded-[44px] bg-[#0a0a0c] p-[14px] shadow-2xl ring-1 ring-white/10">
                <div className="relative h-full w-full overflow-hidden rounded-[30px]" style={{ background: brand.surface, color: TEXT, fontFamily: bodyFamily }}>{stage}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type Motion = 1 | -1 | 0;
type Notice = { text: string; tone: 'info' | 'error'; openOffer?: boolean };
/** „Do oferty” w karcie (bez uprawnień do ofert z pokazu — `null`, przyciski się nie pokazują). */
type OfferActions = { has: (product: ShowcaseProductView, choice: ShowcaseOfferChoice) => boolean; add: (product: ShowcaseProductView, choice: ShowcaseOfferChoice) => void } | null;

/** Animacje wejścia ekranu (kierunek gestu) — bez animacji przy „ogranicz ruch” w systemie. */
const SHOWCASE_MOTION_CSS = '@keyframes showcaseNext{from{opacity:0;transform:translateX(56px)}to{opacity:1;transform:none}}'
  + '@keyframes showcasePrev{from{opacity:0;transform:translateX(-56px)}to{opacity:1;transform:none}}'
  + '@keyframes showcaseFade{from{opacity:0}to{opacity:1}}'
  + '.showcase-next{animation:showcaseNext 240ms ease-out}.showcase-prev{animation:showcasePrev 240ms ease-out}.showcase-fade{animation:showcaseFade 160ms ease-out}'
  + '@media (prefers-reduced-motion: reduce){.showcase-next,.showcase-prev,.showcase-fade{animation:none}}';

const sortShown = <T extends { sortOrder: number; title: string }>(list: T[]) =>
  [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl'));

function exitBrowserFull() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
  try {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
    else doc.webkitExitFullscreen?.();
  } catch { /* przeglądarka sama wyszła z pełnego ekranu */ }
}

/**
 * Przesunięcie palcem (dotyk): w poziomie — poprzedni / następny, w dół — zamknięcie (galeria). Pionowe przewijanie
 * zostaje przeglądarce, krawędzie ekranu (24 px) — gestom systemu („wstecz”), paski z `data-no-swipe` — własnemu przewijaniu.
 */
function useSwipe(ref: RefObject<HTMLElement | null>, handlers: { onSwipe?: (direction: 1 | -1) => void; onSwipeDown?: () => void }) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const horizontal = Boolean(handlers.onSwipe);
  const down = Boolean(handlers.onSwipeDown);
  useEffect(() => {
    const element = ref.current;
    if (!element || (!horizontal && !down)) return;
    let start: { x: number; y: number; time: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let swallowClick = false;
    let timer = 0;
    const settle = () => { element.style.transition = 'transform 200ms ease-out'; element.style.transform = ''; };
    const onStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const rect = element.getBoundingClientRect();
      const target = event.target instanceof Element ? event.target : null;
      if (touch.clientX - rect.left < 24 || rect.right - touch.clientX < 24 || target?.closest('[data-no-swipe]')) return;
      start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      axis = null;
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; settle(); return; }
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
        element.style.transition = 'none';
      }
      if (axis === 'x' && latest.current.onSwipe) element.style.transform = `translateX(${Math.round(dx * 0.35)}px)`;
      if (axis === 'y' && latest.current.onSwipeDown && dy > 0) element.style.transform = `translateY(${Math.round(dy * 0.5)}px)`;
    };
    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const quick = Date.now() - start.time < 300;
      const kind = axis;
      start = null;
      axis = null;
      settle();
      const swallow = () => { swallowClick = true; window.clearTimeout(timer); timer = window.setTimeout(() => { swallowClick = false; }, 400); };
      if (kind === 'x' && latest.current.onSwipe && (Math.abs(dx) > 90 || (quick && Math.abs(dx) > 40))) { swallow(); latest.current.onSwipe(dx < 0 ? 1 : -1); }
      else if (kind === 'y' && latest.current.onSwipeDown && (dy > 120 || (quick && dy > 60))) { swallow(); latest.current.onSwipeDown(); }
    };
    const onCancel = () => { start = null; axis = null; settle(); };
    const onClick = (event: MouseEvent) => { if (swallowClick) { swallowClick = false; event.preventDefault(); event.stopPropagation(); } };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: true });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onCancel);
    element.addEventListener('click', onClick, true);
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onCancel);
      element.removeEventListener('click', onClick, true);
      element.style.transform = '';
      element.style.transition = '';
    };
  }, [ref, horizontal, down]);
}

function HomeScreen({ brand, sections, urls, theme, layout, itemCount, onOpen }: {
  brand: ShowcaseBrand; sections: ShowcaseSectionView[]; urls: ShowcaseUrls; theme: Theme; layout: ShowcaseDevice;
  itemCount: (sectionId: string) => number; onOpen: (sectionId: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto px-10 pb-12 pt-24">
      <div className="mb-8 flex items-end gap-6">
        {brand.logoUrl && <img src={brand.logoUrl} alt={brand.name} className="h-24 w-auto max-w-[220px] object-contain" />}
        <div>
          <h1 className={`${layout === 'ipad11' ? 'text-[36px]' : 'text-[44px]'} leading-tight`} style={{ fontFamily: theme.heading }}>Co możemy dla Państwa przygotować</h1>
          <p className="mt-1 text-[18px] text-[#e5e4e2]/60">Wybierz dział, żeby zobaczyć, jak to wygląda.</p>
        </div>
      </div>
      <div className={`grid gap-5 ${layout === 'ipad11' ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {sections.map((entry) => {
          const cover = entry.cover ? urls[showcaseMediaKey(entry.cover)]?.thumb : null;
          const count = itemCount(entry.id);
          return (
            <button key={entry.id} type="button" onClick={() => onOpen(entry.id)}
              className={`group relative ${layout === 'ipad11' ? 'h-[220px]' : 'h-[300px]'} overflow-hidden rounded-3xl text-left ring-1 ring-white/10`} style={{ background: `linear-gradient(135deg, ${theme.accent}33, ${theme.surface})` }}>
              {cover && <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute left-5 top-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-black/40" style={{ color: theme.accent }}>
                <SectionIcon icon={entry.icon} className="h-6 w-6" />
              </div>
              <div className="absolute inset-x-5 bottom-4">
                <div className="text-[26px] leading-tight" style={{ fontFamily: theme.heading }}>{entry.title}</div>
                <div className="mt-1 line-clamp-2 text-[15px] text-[#e5e4e2]/70">{entry.subtitle || `${count} ${plural(count, 'pozycja', 'pozycje', 'pozycji')}`}</div>
              </div>
            </button>
          );
        })}
      </div>
      {!sections.length && <p className="mt-10 text-center text-[18px] text-[#e5e4e2]/50">Brak widocznych działów — dodaj dział i karty w edytorze.</p>}
    </div>
  );
}

function SectionScreen({ section, sections, items, urls, theme, layout, onSection, onItem, onStep }: {
  section: ShowcaseSectionView; sections: ShowcaseSectionView[]; items: ShowcaseItemSummary[]; urls: ShowcaseUrls; theme: Theme; layout: ShowcaseDevice;
  onSection: (sectionId: string) => void; onItem: (item: ShowcaseItemSummary) => void; onStep?: (direction: 1 | -1) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useSwipe(scroller, { onSwipe: onStep });
  return (
    <div ref={scroller} className="h-full overflow-y-auto px-10 pb-12 pt-24">
      <div className="mb-6 flex items-center gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl" style={{ background: `${theme.accent}22`, color: theme.accent }}>
          <SectionIcon icon={section.icon} className="h-8 w-8" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[40px] leading-tight" style={{ fontFamily: theme.heading }}>{section.title}</h1>
          {section.subtitle && <p className="text-[18px] text-[#e5e4e2]/60">{section.subtitle}</p>}
        </div>
      </div>
      {sections.length > 1 && (
        // Przejście do innego działu bez wracania na start (przesunięcie palcem w bok — sąsiedni dział).
        <div data-no-swipe className="-mx-10 mb-8 flex gap-2 overflow-x-auto px-10 pb-1">
          {sections.map((entry) => {
            const active = entry.id === section.id;
            return (
              <button key={entry.id} type="button" onClick={() => onSection(entry.id)} aria-current={active ? 'page' : undefined}
                className="flex h-11 shrink-0 items-center gap-2 rounded-full border px-5 text-[15px]"
                style={{ borderColor: active ? theme.accent : `${theme.accent}55`, background: active ? theme.accent : 'transparent', color: active ? theme.surface : theme.accent }}>
                <SectionIcon icon={entry.icon} className="h-4 w-4" />{entry.title}
              </button>
            );
          })}
        </div>
      )}
      <div className={`grid gap-5 ${layout === 'ipad11' ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {items.map((item) => {
          const thumb = item.thumbKey ? urls[item.thumbKey]?.thumb : null;
          return (
            <button key={item.id} type="button" onClick={() => onItem(item)}
              className="group flex flex-col overflow-hidden rounded-3xl bg-black/25 text-left ring-1 ring-white/10">
              <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-black/30">
                {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  : <Images className="absolute inset-0 m-auto h-10 w-10" style={{ color: `${theme.accent}55` }} />}
              </div>
              <div className="space-y-1 p-5">
                <div className="text-[22px] leading-tight" style={{ fontFamily: theme.heading }}>{item.title}</div>
                {item.tagline && <div className="line-clamp-2 text-[15px]" style={{ color: theme.accent }}>{item.tagline}</div>}
              </div>
            </button>
          );
        })}
      </div>
      {!items.length && <p className="mt-10 text-center text-[18px] text-[#e5e4e2]/50">Ten dział nie ma jeszcze widocznych kart.</p>}
    </div>
  );
}

type Theme = { accent: string; surface: string; heading: string };

const plural = (value: number, one: string, few: string, many: string) =>
  (value === 1 ? one : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 12 || value % 100 > 14) ? few : many);

type ItemNav = {
  prev: ShowcaseItemSummary | null;
  next: ShowcaseItemSummary | null;
  index: number;
  count: number;
  sectionTitle: string;
  urls: ShowcaseUrls;
  step: (direction: 1 | -1) => void;
};

function ItemScreen({ detail, theme, showPrices, openPhotos, wide, nav, offer }: {
  detail: ShowcaseItemDetail; theme: Theme; showPrices: boolean; wide: boolean; nav: ItemNav | null; offer: OfferActions;
  openPhotos: (photos: ShowcaseMedia[], index: number, urls: ShowcaseUrls) => void;
}) {
  const { item, products, realizations, urls } = detail;
  const blocks = useMemo(() => showcaseVisibleBlocks(item.content, products), [item.content, products]);
  const scroller = useRef<HTMLDivElement>(null);
  useSwipe(scroller, { onSwipe: nav ? nav.step : undefined });
  const hero = item.content.hero ? urls[showcaseMediaKey(item.content.hero)]?.url : null;
  const jump = (id: string) => {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-block="${id}"]`);
    // Pasek górny (64) + pasek bloków (68) + odstęp — tytuł bloku nie chowa się pod paskami.
    if (target && scroller.current) scroller.current.scrollTo({ top: target.offsetTop - 150, behavior: 'smooth' });
  };
  const linked = item.productIds.map((id) => products.find((product) => product.id === id)).filter((product): product is ShowcaseProductView => Boolean(product));
  const offerable = offer ? linked.filter((product) => product.isActive && !product.configurable) : [];
  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <div className="relative h-[72%] min-h-[420px] w-full overflow-hidden">
        {hero ? <img src={hero} alt="" className="absolute inset-0 h-full w-full cursor-zoom-in object-cover" onClick={() => item.content.hero && openPhotos([item.content.hero], 0, urls)} />
          : <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 30% 30%, ${theme.accent}40, ${theme.surface})` }} />}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10" />
        <div className="absolute inset-x-10 bottom-10 max-w-[900px]">
          <h1 className="text-[56px] leading-[1.05]" style={{ fontFamily: theme.heading }}>{item.title}</h1>
          {item.tagline && <p className="mt-3 text-[24px]" style={{ color: theme.accent }}>{item.tagline}</p>}
          {item.content.lead && <p className="mt-4 whitespace-pre-line text-[19px] leading-relaxed text-[#e5e4e2]/85">{item.content.lead}</p>}
          {showPrices && linked.some((product) => product.priceNet != null) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {linked.filter((product) => product.priceNet != null).map((product) => (
                <span key={product.id} className="rounded-full bg-black/50 px-4 py-1.5 text-[16px]" style={{ color: theme.accent }}>
                  {linked.length > 1 ? `${product.name}: ` : 'od '}{formatShowcasePrice(product.priceNet)}{product.unit ? ` / ${product.unit}` : ''}
                </span>
              ))}
            </div>
          )}
          {offer && offerable.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {offerable.map((product) => (
                <OfferAddButton key={product.id} theme={theme} added={offer.has(product, null)} label={offerable.length > 1 ? `Do oferty: ${product.name}` : 'Do oferty'}
                  onClick={() => offer.add(product, null)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {blocks.length > 1 && (
        <div data-no-swipe className="sticky top-16 z-10 flex gap-2 overflow-x-auto px-10 py-3" style={{ background: theme.surface }}>
          {blocks.map((block) => (
            <button key={block.id} type="button" onClick={() => jump(block.id)} className="flex h-11 shrink-0 items-center rounded-full border px-5 text-[15px]"
              style={{ borderColor: `${theme.accent}55`, color: theme.accent }}>{block.title}</button>
          ))}
        </div>
      )}
      <div className="space-y-16 px-10 pb-20 pt-10">
        {blocks.map((block) => (
          <section key={block.id} data-block={block.id}>
            <h2 className="text-[34px] leading-tight" style={{ fontFamily: theme.heading }}>{block.title}</h2>
            {block.kind !== 'text' && block.text && <p className="mt-2 max-w-[900px] whitespace-pre-line text-[18px] text-[#e5e4e2]/70">{block.text}</p>}
            <div className="mt-6">
              <BlockView block={block} products={products} realizations={realizations} urls={urls} theme={theme} showPrices={showPrices} openPhotos={openPhotos} wide={wide} offer={offer} />
            </div>
          </section>
        ))}
        {!blocks.length && <p className="text-center text-[18px] text-[#e5e4e2]/50">Karta nie ma jeszcze treści do pokazania.</p>}
        {nav && (
          // Koniec karty: sąsiednie karty działu (to samo daje przesunięcie palcem w bok i strzałki ← → na klawiaturze / pilocie).
          <nav className="border-t pt-10" style={{ borderColor: `${theme.accent}26` }} aria-label="Inne karty działu">
            <p className="mb-5 text-center text-[15px] text-[#e5e4e2]/50">
              Karta {nav.index + 1} z {nav.count}{nav.sectionTitle ? ` · ${nav.sectionTitle}` : ''} — przesuń palcem w bok, żeby przejść do sąsiedniej
            </p>
            <div className="grid grid-cols-2 gap-5">
              {nav.prev ? <NeighbourCard item={nav.prev} direction={-1} urls={nav.urls} theme={theme} onOpen={() => nav.step(-1)} /> : <div />}
              {nav.next ? <NeighbourCard item={nav.next} direction={1} urls={nav.urls} theme={theme} onOpen={() => nav.step(1)} /> : <div />}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

function NeighbourCard({ item, direction, urls, theme, onOpen }: { item: ShowcaseItemSummary; direction: 1 | -1; urls: ShowcaseUrls; theme: Theme; onOpen: () => void }) {
  const thumb = item.thumbKey ? urls[item.thumbKey]?.thumb : null;
  return (
    <button type="button" onClick={onOpen}
      className={`flex min-h-[112px] items-center gap-5 rounded-3xl bg-black/25 p-4 ring-1 ring-white/10 ${direction === 1 ? 'flex-row-reverse text-right' : 'text-left'}`}>
      <span className="relative h-20 w-32 shrink-0 overflow-hidden rounded-2xl bg-black/30">
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Images className="absolute inset-0 m-auto h-7 w-7" style={{ color: `${theme.accent}55` }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1 text-[14px] ${direction === 1 ? 'justify-end' : ''}`} style={{ color: theme.accent }}>
          {direction === -1 && <ChevronLeft className="h-4 w-4" />}{direction === 1 ? 'Następna karta' : 'Poprzednia karta'}{direction === 1 && <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="mt-1 line-clamp-2 block text-[22px] leading-tight" style={{ fontFamily: theme.heading }}>{item.title}</span>
      </span>
    </button>
  );
}

function Tile({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="flex flex-col rounded-3xl bg-black/25 p-6 ring-1 ring-white/10" style={style}>{children}</div>;
}

function Points({ items, style, theme, wide }: { items: Array<{ title: string; text: string }>; style: string; theme: Theme; wide: boolean }) {
  if (style === 'steps') {
    return (
      <ol className="space-y-5">
        {items.map((entry, index) => (
          <li key={index} className="flex gap-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[20px] font-semibold" style={{ background: theme.accent, color: theme.surface }}>{index + 1}</span>
            <div className="pt-1.5">
              <div className="text-[22px]">{entry.title}</div>
              {entry.text && <p className="mt-1 whitespace-pre-line text-[17px] text-[#e5e4e2]/70">{entry.text}</p>}
            </div>
          </li>
        ))}
      </ol>
    );
  }
  if (style === 'checklist') {
    return (
      <ul className={`grid gap-x-10 gap-y-4 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {items.map((entry, index) => (
          <li key={index} className="flex gap-3">
            <Check className="mt-1 h-6 w-6 shrink-0" style={{ color: theme.accent }} />
            <div>
              <div className="text-[19px]">{entry.title}</div>
              {entry.text && <p className="mt-0.5 whitespace-pre-line text-[16px] text-[#e5e4e2]/65">{entry.text}</p>}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`grid gap-5 ${wide ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {items.map((entry, index) => (
        <Tile key={index}>
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${theme.accent}22`, color: theme.accent }}><Check className="h-6 w-6" /></span>
          <div className="text-[21px] leading-snug">{entry.title}</div>
          {entry.text && <p className="mt-2 whitespace-pre-line text-[16px] text-[#e5e4e2]/65">{entry.text}</p>}
        </Tile>
      ))}
    </div>
  );
}

function Photos({ photos, layout, urls, openPhotos, wide }: {
  photos: ShowcaseMedia[]; layout: string; urls: ShowcaseUrls; wide: boolean;
  openPhotos: (photos: ShowcaseMedia[], index: number, urls: ShowcaseUrls) => void;
}) {
  if (layout === 'large') {
    return (
      <div className="space-y-6">
        {photos.map((photo, index) => (
          <figure key={photo.id}>
            <img src={urls[showcaseMediaKey(photo)]?.url || ''} alt={photo.caption} onClick={() => openPhotos(photos, index, urls)}
              className="max-h-[680px] w-full cursor-zoom-in rounded-3xl object-cover" />
            {photo.caption && <figcaption className="mt-2 text-[16px] text-[#e5e4e2]/60">{photo.caption}</figcaption>}
          </figure>
        ))}
      </div>
    );
  }
  return (
    <div className={`grid gap-3 ${wide ? 'grid-cols-4' : 'grid-cols-3'}`}>
      {photos.map((photo, index) => (
        <button key={photo.id} type="button" onClick={() => openPhotos(photos, index, urls)} className="aspect-square overflow-hidden rounded-2xl bg-black/30">
          <img src={urls[showcaseMediaKey(photo)]?.thumb || ''} alt={photo.caption} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
        </button>
      ))}
    </div>
  );
}

function Price({ value, unit, theme, onRequest = false }: { value: number | null; unit?: string; theme: Theme; onRequest?: boolean }) {
  if (onRequest) return <div className="text-[18px]" style={{ color: theme.accent }}>Wycena indywidualna</div>;
  if (value == null) return null;
  return <div className="text-[22px] font-semibold" style={{ color: theme.accent }}>{formatShowcasePrice(value)}{unit ? <span className="text-[15px] font-normal"> / {unit}</span> : null}</div>;
}

/** Dół kafelka: cena i „Do oferty” (mt-auto — w jednym rzędzie kafelków na tej samej wysokości; kafelek jest kolumną flex). */
function TileFooter({ price, action }: { price: ReactNode; action: ReactNode }) {
  if (!price && !action) return null;
  return <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">{price || <span />}{action}</div>;
}

function BlockView({ block, products, realizations, urls, theme, showPrices, openPhotos, wide, offer }: {
  block: ShowcaseBlock; products: ShowcaseProductView[]; realizations: ShowcaseRealizationView[]; urls: ShowcaseUrls; theme: Theme; showPrices: boolean; wide: boolean; offer: OfferActions;
  openPhotos: (photos: ShowcaseMedia[], index: number, urls: ShowcaseUrls) => void;
}) {
  switch (block.kind) {
    case 'photos':
      return <Photos photos={block.photos} layout={block.style} urls={urls} openPhotos={openPhotos} wide={wide} />;
    case 'points':
      return <Points items={block.rows} style={block.style} theme={theme} wide={wide} />;
    case 'specs':
      return (
        <div className="overflow-hidden rounded-3xl ring-1 ring-white/10">
          {block.rows.map((row, index) => (
            <div key={row.id} className={`grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 px-6 py-4 text-[18px] ${index % 2 ? 'bg-black/10' : 'bg-black/25'}`}>
              <span className="text-[#e5e4e2]/65">{row.title}</span><span className="whitespace-pre-line">{row.text}</span>
            </div>
          ))}
        </div>
      );
    case 'faq':
      return <Faq rows={block.rows} theme={theme} />;
    case 'text':
      return <div className="max-w-[960px] space-y-4 text-[19px] leading-relaxed text-[#e5e4e2]/85">{block.text.split('\n\n').map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}</div>;
    case 'realizations': {
      const list = block.refs.map((id) => realizations.find((entry) => entry.id === id)).filter((entry): entry is ShowcaseRealizationView => Boolean(entry));
      return (
        <div className={`grid gap-5 ${wide ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {list.map((entry) => (
            <button key={entry.id} type="button" disabled={!entry.photos.length} onClick={() => openPhotos(entry.photos, 0, urls)}
              className="group flex flex-col overflow-hidden rounded-3xl bg-black/25 text-left ring-1 ring-white/10">
              <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/30">
                {entry.photos[0] && <img src={urls[showcaseMediaKey(entry.photos[0])]?.thumb || ''} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />}
                {entry.photos.length > 1 && <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[13px]"><Images className="h-4 w-4" />{entry.photos.length}</span>}
              </div>
              <div className="p-5">
                <div className="text-[20px] leading-snug">{entry.title}</div>
                <div className="mt-1 flex items-center gap-1 text-[14px] text-[#e5e4e2]/55">
                  {entry.location && <MapPin className="h-4 w-4" />}{[entry.location, entry.date ? entry.date.slice(0, 4) : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          ))}
        </div>
      );
    }
    case 'catalog': {
      const product = products.find((entry) => entry.id === block.productId);
      if (!product) return null;
      const offerFor = (choice: ShowcaseOfferChoice) => (offer && product.isActive && !product.configurable
        ? <OfferAddButton theme={theme} compact added={offer.has(product, choice)} onClick={() => offer.add(product, choice)} />
        : null);
      if (block.style === 'benefits') {
        return <Points items={product.benefits.length ? product.benefits : product.variants.flatMap((variant) => variant.benefits.map((benefit) => ({ title: benefit, text: '' })))} style="benefits" theme={theme} wide={wide} />;
      }
      if (block.style === 'variants') {
        return (
          <div className={`grid gap-5 ${product.variants.length >= 3 && wide ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {product.variants.map((variant) => {
              const image = variant.image ? urls[showcaseMediaKey(variant.image)]?.thumb : null;
              return (
                <Tile key={variant.id} style={variant.recommended ? { boxShadow: `0 0 0 2px ${theme.accent}` } : undefined}>
                  {image && <img src={image} alt="" className="-mx-6 -mt-6 mb-5 aspect-[16/9] w-[calc(100%+3rem)] max-w-none rounded-t-3xl object-cover" />}
                  <div className="flex items-start gap-2">
                    <div className="flex-1 text-[22px] leading-snug">{variant.name}</div>
                    {variant.recommended && <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px]" style={{ background: theme.accent, color: theme.surface }}><Star className="h-3.5 w-3.5" />Polecany</span>}
                  </div>
                  {variant.shortDescription && <p className="mt-2 text-[16px] text-[#e5e4e2]/70">{variant.shortDescription}</p>}
                  {variant.benefits.length > 0 && (
                    <ul className="mt-3 space-y-1.5">{variant.benefits.map((benefit, index) => <li key={index} className="flex gap-2 text-[16px]"><Check className="mt-0.5 h-5 w-5 shrink-0" style={{ color: theme.accent }} />{benefit}</li>)}</ul>
                  )}
                  <TileFooter price={showPrices && variant.priceNet != null ? <Price value={variant.priceNet} unit={product.unit} theme={theme} /> : null} action={offerFor({ kind: 'variant', optionId: variant.id })} />
                </Tile>
              );
            })}
          </div>
        );
      }
      if (block.style === 'packages') {
        return (
          <div className={`grid gap-5 ${product.packages.length >= 3 && wide ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {product.packages.map((entry) => {
              const image = entry.image ? urls[showcaseMediaKey(entry.image)]?.thumb : null;
              return (
                <Tile key={entry.id} style={entry.highlighted ? { boxShadow: `0 0 0 2px ${theme.accent}` } : undefined}>
                  {image && <img src={image} alt="" className="-mx-6 -mt-6 mb-5 aspect-[16/9] w-[calc(100%+3rem)] max-w-none rounded-t-3xl object-cover" />}
                  <div className="text-[22px] leading-snug">{entry.name}</div>
                  {entry.description && <p className="mt-2 whitespace-pre-line text-[16px] text-[#e5e4e2]/70">{entry.description}</p>}
                  {entry.scope && <p className="mt-3 text-[15px] text-[#e5e4e2]/60"><span style={{ color: theme.accent }}>W pakiecie: </span>{entry.scope}</p>}
                  {entry.bonus && <p className="mt-2 text-[15px]" style={{ color: theme.accent }}>Gratis: {entry.bonus}</p>}
                  <TileFooter price={showPrices && (entry.priceOnRequest || entry.priceNet != null) ? <Price value={entry.priceNet} theme={theme} onRequest={entry.priceOnRequest} /> : null} action={offerFor({ kind: 'package', optionId: entry.id })} />
                </Tile>
              );
            })}
          </div>
        );
      }
      return (
        <div className={`grid gap-6 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {product.requirements.length > 0 && (
            <Tile>
              <div className="mb-4 text-[20px]" style={{ color: theme.accent }}>Co zapewnia obiekt lub klient</div>
              <Points items={product.requirements} style="checklist" theme={theme} wide={false} />
            </Tile>
          )}
          {(product.setupHours != null || product.teardownHours != null || product.preparation.length > 0) && (
            <Tile>
              <div className="mb-4 text-[20px]" style={{ color: theme.accent }}>Montaż i ustalenia</div>
              <ul className="space-y-3 text-[18px]">
                {product.setupHours != null && <li className="flex gap-3"><Clock className="mt-0.5 h-6 w-6 shrink-0" style={{ color: theme.accent }} />Montaż: ok. {String(product.setupHours).replace('.', ',')} h przed wydarzeniem</li>}
                {product.teardownHours != null && <li className="flex gap-3"><Clock className="mt-0.5 h-6 w-6 shrink-0" style={{ color: theme.accent }} />Demontaż: ok. {String(product.teardownHours).replace('.', ',')} h</li>}
                {product.preparation.map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <Check className="mt-0.5 h-6 w-6 shrink-0" style={{ color: theme.accent }} />
                    <span>{step.title}{step.leadDays != null ? <span className="text-[#e5e4e2]/55"> — {step.leadDays} dni przed</span> : null}
                      {step.details && <span className="block text-[15px] text-[#e5e4e2]/55">{step.details}</span>}</span>
                  </li>
                ))}
              </ul>
            </Tile>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function Faq({ rows, theme }: { rows: Array<{ id: string; title: string; text: string }>; theme: Theme }) {
  const [open, setOpen] = useState<string | null>(rows[0]?.id || null);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="overflow-hidden rounded-2xl bg-black/25 ring-1 ring-white/10">
          <button type="button" onClick={() => setOpen(open === row.id ? null : row.id)} className="flex w-full items-center gap-3 px-6 py-4 text-left text-[20px]">
            <span className="flex-1">{row.title}</span>
            <ChevronRight className={`h-6 w-6 shrink-0 transition-transform ${open === row.id ? 'rotate-90' : ''}`} style={{ color: theme.accent }} />
          </button>
          {open === row.id && row.text && <p className="whitespace-pre-line px-6 pb-5 text-[17px] text-[#e5e4e2]/75">{row.text}</p>}
        </div>
      ))}
    </div>
  );
}

function LightboxView({ lightbox, accent, onChange }: { lightbox: Lightbox; accent: string; onChange: (value: Lightbox | null) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const many = lightbox.photos.length > 1;
  const step = (delta: number) => onChange({ ...lightbox, index: (lightbox.index + delta + lightbox.photos.length) % lightbox.photos.length });
  // Palcem: w bok — poprzednie / następne zdjęcie, w dół — zamknięcie galerii.
  useSwipe(area, { onSwipe: many ? step : undefined, onSwipeDown: () => onChange(null) });
  const photo = lightbox.photos[lightbox.index];
  if (!photo) return null;
  const url = lightbox.urls[showcaseMediaKey(photo)]?.url || '';
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black">
      <div className="flex h-16 items-center gap-3 px-6 text-[15px] text-white/70">
        <span className="flex-1">{many ? `${lightbox.index + 1} / ${lightbox.photos.length}` : ''}</span>
        <button type="button" onClick={() => onChange(null)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10" aria-label="Zamknij galerię"><X className="h-6 w-6" /></button>
      </div>
      <div ref={area} className="relative min-h-0 flex-1">
        <img src={url} alt={photo.caption} className="absolute inset-0 h-full w-full select-none object-contain" draggable={false} />
        {many && (
          <>
            <button type="button" onClick={() => step(-1)} className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3" style={{ color: accent }} aria-label="Poprzednie"><ChevronLeft className="h-8 w-8" /></button>
            <button type="button" onClick={() => step(1)} className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3" style={{ color: accent }} aria-label="Następne"><ChevronRight className="h-8 w-8" /></button>
          </>
        )}
      </div>
      <div className="min-h-[56px] px-6 py-4 text-center text-[17px] text-white/75">{photo.caption}</div>
    </div>
  );
}
