'use client';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type EventNavigationItem = { id: string; label: string; icon?: ComponentType<{ className?: string }> };
/** Zgodność wsteczna: grupy są spłaszczane do jednego paska (bez etykiet grup). */
export type EventNavigationGroup = { id: string; label: string; tabs: EventNavigationItem[] };

/** Odstęp od krawędzi przy przewijaniu aktywnej zakładki do widoku. */
const EDGE_PADDING = 24;
/** Ruch wskaźnika (px), po którym wciśnięcie staje się przeciąganiem paska, a nie kliknięciem. */
const DRAG_THRESHOLD = 6;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

type DragState = {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  dragging: boolean;
};

/**
 * Pasek zakładek w stylu Material (MUI Tabs, variant="scrollable", scrollButtons="auto"): jeden rząd, tekst
 * (opcjonalnie mała ikona), złoty pasek wskaźnika pod aktywną zakładką przesuwający się między zakładkami.
 * Gdy zakładki się nie mieszczą: przyciski przewijania przy krawędziach (tylko w stronę, gdzie jest treść),
 * przeciąganie myszą („chwyć i przesuń” — przeciągnięcie nie otwiera zakładki), kółko myszy przewija w poziomie,
 * a na dotyku — natywne przesuwanie. Klawiatura: ←/→/Home/End (roving tabindex), Enter/Spacja otwiera.
 */
export default function EventNavigation({
  tabs,
  groups,
  activeTab,
  onChange,
  scrollRef,
  ariaLabel = 'Zakładki wydarzenia',
  idPrefix,
  panelId,
}: {
  /** Zakładki w kolejności wyświetlania. */
  tabs?: EventNavigationItem[];
  /** Starszy wariant wywołania — grupy są spłaszczane. */
  groups?: EventNavigationGroup[];
  activeTab: string;
  onChange: (id: string) => void;
  /** Element przewijanego paska (dla zgodności ze starszymi wywołaniami). */
  scrollRef?: Ref<HTMLDivElement>;
  ariaLabel?: string;
  /** Prefiks identyfikatorów zakładek: `${idPrefix}-tab-${id}` (np. dla aria-labelledby panelu). */
  idPrefix?: string;
  /** Identyfikator panelu treści (aria-controls). */
  panelId?: string;
}) {
  const generatedId = useId();
  const prefix = idPrefix || `event-nav-${generatedId.replace(/:/g, '')}`;

  const items = useMemo<EventNavigationItem[]>(
    () => (groups?.length ? groups.flatMap(group => group.tabs) : tabs ?? []),
    [groups, tabs],
  );

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [indicatorAnimated, setIndicatorAnimated] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const contentRef = useRef<HTMLDivElement | null>(null);
  const externalRef = useRef(scrollRef);
  externalRef.current = scrollRef;
  const firstScrollRef = useRef(true);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const setScrollerNode = useCallback((node: HTMLDivElement | null) => {
    assignRef(externalRef.current, node);
    setScroller(node);
  }, []);

  const measure = useCallback(() => {
    if (scroller) {
      const max = scroller.scrollWidth - scroller.clientWidth;
      const overflow = max > 1;
      const left = overflow && scroller.scrollLeft > 1;
      const right = overflow && max - scroller.scrollLeft > 1;
      setEdges(previous =>
        previous.overflow === overflow && previous.left === left && previous.right === right
          ? previous
          : { overflow, left, right },
      );
    }
    const element = tabRefs.current.get(activeTab);
    if (element) {
      const next = { left: element.offsetLeft, width: element.offsetWidth };
      setIndicator(previous =>
        previous && previous.left === next.left && previous.width === next.width ? previous : next,
      );
    } else {
      setIndicator(null);
    }
  }, [scroller, activeTab]);

  // Pomiar paska wskaźnika i krawędzi: przy zmianie zakładki, rozmiaru, liczby zakładek i po wczytaniu fontów.
  useEffect(() => {
    measure();
    if (!scroller) return;
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    observer?.observe(scroller);
    if (contentRef.current) observer?.observe(contentRef.current);
    let active = true;
    void (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => {
      if (active) measure();
    });
    return () => {
      active = false;
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [scroller, measure, items.length]);

  // Animacja paska dopiero po pierwszym pomiarze (bez „wjazdu” od lewej przy wczytaniu strony).
  useEffect(() => {
    if (!indicator || indicatorAnimated) return;
    const frame = requestAnimationFrame(() => setIndicatorAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [indicator, indicatorAnimated]);

  // Pionowe kółko myszy przewija pasek w poziomie (tylko gdy zakładki się nie mieszczą).
  useEffect(() => {
    if (!scroller) return;
    const handleWheel = (event: WheelEvent) => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max <= 1) return;
      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (rawDelta === 0) return;
      event.preventDefault();
      const multiplier = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? scroller.clientWidth : 1;
      scroller.scrollLeft = Math.min(max, Math.max(0, scroller.scrollLeft + rawDelta * multiplier));
    };
    scroller.addEventListener('wheel', handleWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', handleWheel);
  }, [scroller]);

  const ensureVisible = useCallback(
    (element: HTMLElement, smooth: boolean) => {
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const item = element.getBoundingClientRect();
      let delta = 0;
      if (item.left < box.left + EDGE_PADDING) delta = item.left - box.left - EDGE_PADDING;
      else if (item.right > box.right - EDGE_PADDING) delta = item.right - box.right + EDGE_PADDING;
      if (delta !== 0) scroller.scrollBy({ left: delta, behavior: smooth ? 'smooth' : 'auto' });
    },
    [scroller],
  );

  // Aktywna zakładka zawsze w polu widzenia (bez przewijania całej strony).
  useEffect(() => {
    const element = tabRefs.current.get(activeTab);
    if (!element || !scroller) return;
    ensureVisible(element, !firstScrollRef.current);
    firstScrollRef.current = false;
  }, [activeTab, scroller, ensureVisible]);

  useEffect(() => {
    setFocusId(null);
  }, [activeTab]);

  const rovingId =
    focusId && items.some(tab => tab.id === focusId)
      ? focusId
      : items.some(tab => tab.id === activeTab)
        ? activeTab
        : items[0]?.id ?? null;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!items.length) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    const id = items[next].id;
    setFocusId(id);
    const element = tabRefs.current.get(id);
    if (element) {
      element.focus({ preventScroll: true });
      ensureVisible(element, true);
    }
  };

  const scrollByPage = (direction: -1 | 1) => {
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(160, scroller.clientWidth * 0.7), behavior: 'smooth' });
  };

  // Przeciąganie myszą/rysikiem. Dotyk zostaje przy natywnym przesuwaniu (touch-action: pan-x).
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    if (!scroller || event.pointerType === 'touch' || event.button !== 0) return;
    if (scroller.scrollWidth - scroller.clientWidth <= 1) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      dragging: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    if (!drag.dragging) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      setDragging(true);
      try {
        scroller.setPointerCapture(event.pointerId);
      } catch {
        /* Wskaźnik mógł już zostać zwolniony. */
      }
    }
    event.preventDefault();
    scroller.scrollLeft = drag.startScrollLeft - deltaX;
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.dragging) return;
    // Kliknięcie, które przeglądarka wyśle po przeciągnięciu, nie może otworzyć zakładki.
    suppressClickRef.current = true;
    setDragging(false);
    try {
      if (scroller?.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    } catch {
      /* Wskaźnik mógł już zostać zwolniony. */
    }
  };

  if (!items.length) return null;

  const scrollButtonClass =
    'hidden w-10 shrink-0 items-center justify-center text-[#e5e4e2]/70 transition-colors hover:bg-white/[0.04] hover:text-[#d3bb73] disabled:pointer-events-none sm:flex';

  return (
    <div className="relative flex items-stretch">
      {edges.overflow && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Przewiń zakładki w lewo"
          disabled={!edges.left}
          onClick={() => scrollByPage(-1)}
          className={`${scrollButtonClass} ${edges.left ? '' : 'invisible'}`}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      <div
        ref={setScrollerNode}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClickCapture={event => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragStart={event => event.preventDefault()}
        className={`min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [touch-action:pan-x_pan-y] [&::-webkit-scrollbar]:hidden ${
          edges.overflow ? (dragging ? 'cursor-grabbing select-none [&_button]:cursor-grabbing' : 'cursor-grab') : ''
        }`}
      >
        <div
          ref={contentRef}
          role="tablist"
          aria-label={ariaLabel}
          aria-orientation="horizontal"
          data-crm-tabs="true"
          className="relative flex w-max min-w-full"
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusId(null);
          }}
        >
          {items.map((tab, index) => {
            const selected = tab.id === activeTab;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                ref={element => {
                  if (element) tabRefs.current.set(tab.id, element);
                  else tabRefs.current.delete(tab.id);
                }}
                id={`${prefix}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={tab.id === rovingId ? 0 : -1}
                data-crm-tab-active={selected ? 'true' : 'false'}
                data-crm-tab-variant="underline"
                onClick={() => onChange(tab.id)}
                onFocus={() => setFocusId(tab.id)}
                onKeyDown={event => handleKeyDown(event, index)}
                draggable={false}
                className={`flex min-h-[48px] shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-medium uppercase tracking-[0.02em] outline-none transition-colors duration-150 ${
                  selected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                {tab.label}
              </button>
            );
          })}
          {indicator && (
            <span
              aria-hidden
              className={`pointer-events-none absolute bottom-0 h-0.5 bg-[#d3bb73] ${
                indicatorAnimated ? 'transition-[left,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]' : ''
              }`}
              style={{ left: indicator.left, width: indicator.width }}
            />
          )}
        </div>
      </div>
      {edges.overflow && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Przewiń zakładki w prawo"
          disabled={!edges.right}
          onClick={() => scrollByPage(1)}
          className={`${scrollButtonClass} ${edges.right ? '' : 'invisible'}`}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}
