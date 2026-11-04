'use client';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type MutableRefObject,
  type Ref,
} from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export type EventNavigationItem = { id: string; label: string; icon: ComponentType<{ className?: string }> };
export type EventNavigationGroup = { id: string; label: string; tabs: EventNavigationItem[] };

/** Margines przy przewijaniu aktywnej zakładki — zakładka nie chowa się pod strzałką ani wygaszeniem krawędzi. */
const EDGE_PADDING = 44;
const FADE_WIDTH = 36;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

/**
 * Pasek zakładek wydarzenia: grupy (np. Wydarzenie | Przygotowanie | Sprzedaż i rozliczenie), aktywna zakładka jako
 * wypełniona „pigułka”, przewijanie w poziomie ze strzałkami i wygaszeniem krawędzi, kółko myszy przewija w poziomie,
 * klawiatura ←/→/Home/End (roving tabindex, Enter/Spacja otwiera). Na wąskich ekranach — lista wyboru.
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
  /** Płaska lista zakładek (bez grup). */
  tabs?: EventNavigationItem[];
  /** Zakładki w grupach — mają pierwszeństwo przed `tabs`. */
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
  const selectId = `${prefix}-select`;

  const resolvedGroups = useMemo<EventNavigationGroup[]>(() => {
    const source = groups?.length ? groups : [{ id: 'all', label: '', tabs: tabs ?? [] }];
    return source.filter(group => group.tabs.length > 0);
  }, [groups, tabs]);
  const flatTabs = useMemo(() => resolvedGroups.flatMap(group => group.tabs), [resolvedGroups]);
  const showGroupLabels = resolvedGroups.length > 1;
  const activeItem = flatTabs.find(tab => tab.id === activeTab) ?? null;

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const externalRef = useRef(scrollRef);
  externalRef.current = scrollRef;
  const firstScrollRef = useRef(true);

  const setScrollerNode = useCallback((node: HTMLDivElement | null) => {
    assignRef(externalRef.current, node);
    setScroller(node);
  }, []);

  const updateEdges = useCallback(() => {
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const left = scroller.scrollLeft > 1;
    const right = max - scroller.scrollLeft > 1;
    setEdges(previous => (previous.left === left && previous.right === right ? previous : { left, right }));
  }, [scroller]);

  // Strzałki i wygaszenie krawędzi tylko tam, gdzie jest jeszcze treść.
  useEffect(() => {
    if (!scroller) return;
    updateEdges();
    scroller.addEventListener('scroll', updateEdges, { passive: true });
    window.addEventListener('resize', updateEdges);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateEdges()) : null;
    observer?.observe(scroller);
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener('scroll', updateEdges);
      window.removeEventListener('resize', updateEdges);
      observer?.disconnect();
    };
  }, [scroller, updateEdges, flatTabs.length]);

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

  const rovingId = focusId && flatTabs.some(tab => tab.id === focusId)
    ? focusId
    : activeItem?.id ?? flatTabs[0]?.id ?? null;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!flatTabs.length) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % flatTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + flatTabs.length) % flatTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = flatTabs.length - 1;
    else return;
    event.preventDefault();
    const id = flatTabs[next].id;
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

  const maskImage = edges.left || edges.right
    ? `linear-gradient(to right, ${edges.left ? 'transparent 0, #000 ' + FADE_WIDTH + 'px' : '#000 0'}, ${
        edges.right ? '#000 calc(100% - ' + FADE_WIDTH + 'px), transparent 100%' : '#000 100%'
      })`
    : undefined;

  if (!flatTabs.length) return null;

  const ActiveIcon = activeItem?.icon ?? null;

  return (
    <nav aria-label={ariaLabel} className="relative">
      {/* Wąskie ekrany: lista wyboru z grupami. */}
      <div className="relative sm:hidden">
        <label htmlFor={selectId} className="sr-only">
          {ariaLabel}
        </label>
        {ActiveIcon && (
          <ActiveIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#d3bb73]" />
        )}
        <select
          id={selectId}
          value={activeItem?.id ?? ''}
          onChange={event => onChange(event.target.value)}
          className="w-full appearance-none rounded-xl border border-white/[0.06] bg-white/5 py-2.5 pl-10 pr-10 text-sm text-[#e5e4e2] focus:bg-white/[0.08] focus:outline-none"
        >
          {!activeItem && <option value="">Wybierz zakładkę</option>}
          {showGroupLabels
            ? resolvedGroups.map(group => (
                <optgroup key={group.id} label={group.label} className="bg-[#1c1f33] text-[#e5e4e2]/60">
                  {group.tabs.map(tab => (
                    <option key={tab.id} value={tab.id} className="bg-[#1c1f33] text-[#e5e4e2]">
                      {tab.label}
                    </option>
                  ))}
                </optgroup>
              ))
            : flatTabs.map(tab => (
                <option key={tab.id} value={tab.id} className="bg-[#1c1f33] text-[#e5e4e2]">
                  {tab.label}
                </option>
              ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50"
          aria-hidden
        />
      </div>

      {/* Od sm: przewijany pasek zakładek. */}
      <div className="relative hidden rounded-xl bg-white/[0.03] p-1 sm:block">
        {edges.left && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Przewiń zakładki w lewo"
            onClick={() => scrollByPage(-1)}
            className="absolute left-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[#1c1f33]/95 text-[#e5e4e2]/80 shadow-lg shadow-black/30 transition-colors hover:bg-[#1c1f33] hover:text-[#d3bb73]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        {edges.right && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Przewiń zakładki w prawo"
            onClick={() => scrollByPage(1)}
            className="absolute right-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[#1c1f33]/95 text-[#e5e4e2]/80 shadow-lg shadow-black/30 transition-colors hover:bg-[#1c1f33] hover:text-[#d3bb73]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
        <div
          ref={setScrollerNode}
          className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
        >
          <div
            role="tablist"
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            data-crm-tabs="true"
            className="flex w-max min-w-full items-center gap-1"
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusId(null);
            }}
          >
            {resolvedGroups.map((group, groupIndex) => {
              const groupLabelId = `${prefix}-group-${group.id}`;
              return (
                <Fragment key={group.id}>
                  {showGroupLabels && groupIndex > 0 && (
                    <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-white/10" />
                  )}
                  {showGroupLabels && (
                    <span
                      id={groupLabelId}
                      aria-hidden
                      className="shrink-0 select-none pl-1.5 pr-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#e5e4e2]/35"
                    >
                      {group.label}
                    </span>
                  )}
                  {group.tabs.map(tab => {
                    const index = flatTabs.indexOf(tab);
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
                        aria-describedby={showGroupLabels ? groupLabelId : undefined}
                        tabIndex={tab.id === rovingId ? 0 : -1}
                        data-crm-tab-active={selected ? 'true' : 'false'}
                        onClick={() => onChange(tab.id)}
                        onFocus={() => setFocusId(tab.id)}
                        onKeyDown={event => handleKeyDown(event, index)}
                        // Globalny styl zakładek CRM nadaje tło aktywnej; tu tylko kształt „pigułki” bez podkreślenia.
                        style={{ borderRadius: 9999, boxShadow: 'none' }}
                        className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[#d3bb73]/40 ${
                          selected ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2]'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {tab.label}
                      </button>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
