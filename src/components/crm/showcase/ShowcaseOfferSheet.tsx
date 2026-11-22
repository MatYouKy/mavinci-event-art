'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlertTriangle, BadgePercent, Building2, CheckCircle2, ChevronLeft, ClipboardList, ExternalLink, FileText, GripVertical, Loader2, Mail, MapPin,
  Minus, Package, Pencil, Plus, RotateCcw, Search, Send, Sparkles, Target, Trash2, User, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH, EVENT_ASSUMPTION_OPTIONS, EVENT_ASSUMPTION_VALUE_MAX_LENGTH, EVENT_GOAL_MAX_LENGTH,
  getEventAssumptionOption, normalizeEventAssumptionItems, syncGuestCountAssumptions, type EventAssumptionItem, type EventAssumptionKey,
} from '@/lib/CRM/Offers/eventAssumptions';
import {
  SHOWCASE_OFFER_DISCOUNT_DISPLAYS, SHOWCASE_OFFER_LIMITS, addShowcaseOfferLine, emptyShowcaseOfferClient, emptyShowcaseOfferDraft, formatShowcaseAmount,
  formatShowcasePercent, isShowcaseOfferEmail, isShowcaseOfferPlaceholder, normalizeShowcaseOfferDraft, showcaseOfferApprovalHint, showcaseOfferDiscount,
  showcaseOfferAssumptionsFromDraft, showcaseOfferLineFor, showcaseOfferPrice, showcaseOfferProblem,
  type ShowcaseOfferAddResult, type ShowcaseOfferAssumption, type ShowcaseOfferAssumptionsDraft, type ShowcaseOfferDiscountDisplay, type ShowcaseOfferApproval, type ShowcaseOfferClient, type ShowcaseOfferClientContext, type ShowcaseOfferClientHit,
  type ShowcaseOfferDraft, type ShowcaseOfferEmailSetup, type ShowcaseOfferInquiry, type ShowcaseOfferKind, type ShowcaseOfferLine,
  type ShowcaseOfferLocation, type ShowcaseOfferPreview, type ShowcaseOfferResult, type ShowcaseOfferSetup, type ShowcaseOfferStatus,
  type ShowcaseProductView, type ShowcaseUrls,
} from '@/lib/showcase/showcaseShared';
import { errorMessage, showcaseGet, showcaseOfferGeneratePdf, showcasePost, type ShowcaseProductOption } from './showcaseApi';
import { useDragList } from './showcaseUi';

/*
 * „Oferta ze spotkania” w pokazie Prezentacji (CRM, także na iPadzie w przeglądarce): klient mówi „chcę ofertę” — sprzedawca
 * dodaje warianty i pakiety („Do oferty”), wybiera klienta (z CRM albo nowego) i otwarte zapytanie albo nowe, ustawia rabat
 * i od razu tworzy ofertę z PDF. Potem: PDF na ekranie, wysyłka e-mailem, prośba o akceptację rabatu powyżej progu, oferta
 * w CRM. Szkic zostaje w przeglądarce (osobno dla każdego pracownika); ceny i rabat liczy serwer jak kreator ofert.
 * Ten sam przepływ na Macu (natywny pokaz) i w aplikacji na iPadzie. Pozycje także z katalogu („Dodaj pozycję”), miejsce —
 * z podpowiedzi bazy lokalizacji albo wpisane ręcznie. Rabat pozycji i rabat całej oferty — razem, z rabatem łącznym; jak klient
 * widzi rabat w PDF (przy pozycjach, rabat łączny, same ceny po rabacie) — wybór sprzedawcy zapamiętany na serwerze. Osoba
 * kontaktowa firmy — lista wyboru. Klient może być roboczy (sama nazwa, bez dodawania do bazy) — przypisuje się go później w CRM.
 * „Założenia i cel” — trzy karty założeń realizacji i cel eventu do oferty i PDF, z „Zaproponuj z AI” (`op=offerAssumptionsAI`).
 */

type Theme = { accent: string; surface: string; heading: string };
export type ShowcaseOfferChoice = { kind: ShowcaseOfferKind; optionId?: string | null } | null;
type Choice = ShowcaseOfferChoice;
type ItemRef = { id: string; title: string } | null;
type Tone = 'info' | 'error';

const STORAGE = 'mavinci.showcase.offer';
const DISCOUNT_PRESETS = [0, 5, 10, 15];
/** Rabat pozycji: 0–100% co 1 punkt (na iPadzie lista wyboru to kółko jak wybór godziny). */
const DISCOUNT_STEPS = Array.from({ length: 101 }, (_, index) => index);
const TEXT = '#e5e4e2';
/** Cyfry zwykłym fontem — w foncie nagłówków marki „0” wygląda jak „O”. */
const DIGITS: CSSProperties = { fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' };

export type ShowcaseOfferState = {
  setup: ShowcaseOfferSetup | null;
  draft: ShowcaseOfferDraft;
  update: (change: (draft: ShowcaseOfferDraft) => ShowcaseOfferDraft) => void;
  add: (product: ShowcaseProductView, choice: Choice, item: ItemRef) => { result: ShowcaseOfferAddResult['result'] | 'unavailable'; label: string };
  has: (product: ShowcaseProductView, choice: Choice) => boolean;
  reset: () => void;
  /** Jak klient widzi rabat w PDF (szkic + zapamiętanie wyboru na serwerze); `false` — wyboru nie zapamiętano. */
  setDiscountDisplay: (display: ShowcaseOfferDiscountDisplay) => Promise<boolean>;
};

/**
 * Szkic oferty ze spotkania: uprawnienia, progi i rabat w PDF z ustawień sprzedawcy (serwer), szkic w przeglądarce (osobno dla
 * każdego pracownika). Rabat w PDF z ustawień obowiązuje w nowym, jeszcze nieruszanym szkicu.
 */
export function useShowcaseOffer(): ShowcaseOfferState {
  const [setup, setSetup] = useState<ShowcaseOfferSetup | null>(null);
  const [draft, setDraft] = useState<ShowcaseOfferDraft>(() => emptyShowcaseOfferDraft());
  const key = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useEffect(() => {
    let active = true;
    showcaseGet<ShowcaseOfferSetup>('offerSetup')
      // Serwer bez tego ustawienia — rabat przy pozycjach.
      .then((value) => { if (active) setSetup({ ...value, discountDisplay: ['total', 'none'].includes(value.discountDisplay) ? value.discountDisplay : 'lines' }); })
      .catch(() => { if (active) setSetup(null); });
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user?.id;
      if (!active || !user) return;
      key.current = `${STORAGE}.${user}`;
      try {
        const saved = window.localStorage.getItem(key.current);
        if (saved) setDraft((current) => (current.lines.length ? current : normalizeShowcaseOfferDraft(JSON.parse(saved))));
      } catch { /* bez pamięci przeglądarki — pusty szkic */ }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!key.current) return;
    try { window.localStorage.setItem(key.current, JSON.stringify(draft)); } catch { /* bez pamięci przeglądarki */ }
  }, [draft]);

  // Rabat w PDF z ustawień sprzedawcy — w szkicu jeszcze nieruszanym.
  const preferredDisplay = setup?.discountDisplay;
  useEffect(() => {
    if (!preferredDisplay) return;
    setDraft((current) => (current.updatedAt || current.discountDisplay === preferredDisplay ? current : { ...current, discountDisplay: preferredDisplay }));
  }, [preferredDisplay, draft.id]);

  const update = useCallback((change: (draft: ShowcaseOfferDraft) => ShowcaseOfferDraft) => {
    setDraft((current) => ({ ...change(current), updatedAt: new Date().toISOString() }));
  }, []);
  const add = useCallback((product: ShowcaseProductView, choice: Choice, item: ItemRef) => {
    const line = showcaseOfferLineFor(product, choice, item);
    if (!line) return { result: 'unavailable' as const, label: product.name };
    const outcome = addShowcaseOfferLine(draftRef.current, line);
    if (outcome.result === 'added') {
      draftRef.current = outcome.draft;
      setDraft(outcome.draft);
    }
    return { result: outcome.result, label: line.label };
  }, []);
  const has = useCallback((product: ShowcaseProductView, choice: Choice) => {
    const line = showcaseOfferLineFor(product, choice, null);
    return Boolean(line && draft.lines.some((entry) => entry.key === line.key));
  }, [draft.lines]);
  const reset = useCallback(() => setDraft(emptyShowcaseOfferDraft(setupRef.current?.discountDisplay)), []);
  const setDiscountDisplay = useCallback(async (display: ShowcaseOfferDiscountDisplay) => {
    setDraft((current) => ({ ...current, discountDisplay: display, updatedAt: new Date().toISOString() }));
    setSetup((current) => (current ? { ...current, discountDisplay: display } : current));
    try {
      await showcasePost<{ discountDisplay: ShowcaseOfferDiscountDisplay }>('offerDiscountDisplay', { discountDisplay: display });
      return true;
    } catch {
      return false;
    }
  }, []);
  return { setup, draft, update, add, has, reset, setDiscountDisplay };
}

/** Przycisk „Do oferty” na kafelku wariantu / pakietu i w nagłówku karty. */
export function OfferAddButton({ theme, added, label = 'Do oferty', onClick, compact = false }: {
  theme: Theme; added: boolean; label?: string; onClick: () => void; compact?: boolean;
}) {
  return (
    <button type="button" data-no-swipe onClick={(event) => { event.stopPropagation(); onClick(); }}
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border text-[15px] ${compact ? 'px-3.5' : 'px-4'}`}
      style={added ? { borderColor: theme.accent, background: `${theme.accent}26`, color: theme.accent } : { borderColor: `${theme.accent}80`, color: theme.accent }}>
      {added ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{added ? 'W ofercie' : label}
    </button>
  );
}

// Obwódka w kolorze akcentu marki tylko przy aktywnym polu (`--offer-accent` ustawia arkusz).
const inputClass = 'h-12 w-full rounded-xl bg-black/30 px-4 text-[16px] text-[#e5e4e2] outline-none ring-1 ring-white/10 placeholder:text-[#e5e4e2]/35 focus:ring-2 focus:ring-[color:var(--offer-accent)]';
const pillInputClass = 'h-11 rounded-full bg-black/30 text-[15px] outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-[color:var(--offer-accent)]';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-[#e5e4e2]/45">{hint}</span>}
    </label>
  );
}

function Section({ title, icon, children, aside }: { title: ReactNode; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-4 border-b border-white/10 px-6 py-6">
      <div className="flex items-center gap-2">
        <span className="opacity-70">{icon}</span>
        <h3 className="flex-1 text-[19px]">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stepper({ value, min, max, onChange, disabled = false, suffix, theme }: {
  value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean; suffix: string; theme: Theme;
}) {
  return (
    <div className={`flex items-center rounded-full bg-black/30 ring-1 ring-white/10 ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label={`Mniej (${suffix})`}
        className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30" style={{ color: theme.accent }}><Minus className="h-4 w-4" /></button>
      <span className="min-w-[64px] text-center text-[15px] tabular-nums">{value} {suffix}</span>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`Więcej (${suffix})`}
        className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30" style={{ color: theme.accent }}><Plus className="h-4 w-4" /></button>
    </div>
  );
}

/** Rabat w procentach z listy (0–100%; na iPadzie — kółko wyboru). `null` — różne rabaty pozycji (nic nie wybrane). */
function DiscountSelect({ value, onChange, theme, label }: { value: number | null; onChange: (value: number) => void; theme: Theme; label: string }) {
  const steps = value != null && !DISCOUNT_STEPS.includes(value) ? [...DISCOUNT_STEPS, value].sort((a, b) => a - b) : DISCOUNT_STEPS;
  const active = value != null && value > 0;
  return (
    <span className="relative inline-flex items-center">
      <BadgePercent className="pointer-events-none absolute left-3.5 h-4 w-4" style={{ color: active ? theme.accent : 'rgba(229,228,226,.5)' }} />
      <select value={value == null ? '' : String(value)} aria-label={label} onChange={(event) => { if (event.target.value !== '') onChange(showcaseOfferDiscount(event.target.value)); }}
        className={`${pillInputClass} appearance-none pl-10 pr-5`} style={active ? { color: theme.accent, boxShadow: `inset 0 0 0 1px ${theme.accent}` } : { color: TEXT }}>
        {value == null && <option value="">Różne — wybierz…</option>}
        {steps.map((step) => <option key={step} value={String(step)}>{step > 0 ? `Rabat −${formatShowcasePercent(step)}` : 'Bez rabatu'}</option>)}
      </select>
    </span>
  );
}

/** Karty założeń szkicu → karty do edycji (bez przycinania w trakcie pisania); karta liczby gości z pola „Liczba osób”. */
const assumptionItems = (assumptions: ShowcaseOfferAssumption[], guestCount: number | null): EventAssumptionItem[] => syncGuestCountAssumptions(
  assumptions.length === 3
    ? assumptions.map((item) => ({ key: item.key as EventAssumptionKey, label: item.label, value: item.value, badge_value: item.badge }))
    : normalizeEventAssumptionItems([]),
  guestCount,
);
const assumptionDraft = (items: EventAssumptionItem[], guestCount: number | null): ShowcaseOfferAssumption[] =>
  syncGuestCountAssumptions(items, guestCount).map((item) => ({ key: item.key, label: item.label, value: item.value, badge: item.badge_value || '' }));

/**
 * „Założenia i cel” — trzy karty założeń realizacji (kategoria, własny tytuł, znacznik w PDF, treść) i cel eventu, jak założenia
 * oferty w CRM. „Zaproponuj z AI”: wskazówki sprzedawcy; zapytanie, pozycje, termin, miejsce i notatkę ze spotkania dokłada serwer
 * (`op=offerAssumptionsAI` — ten sam na Macu, iPadzie i telefonie). Puste karty — oferta weźmie założenia i cel z zapytania.
 */
function AssumptionsSection({ draft, update, theme, onNotice }: {
  draft: ShowcaseOfferDraft;
  update: ShowcaseOfferState['update'];
  theme: Theme;
  onNotice: (text: string, tone?: Tone) => void;
}) {
  const guestCount = draft.event.guestCount;
  const items = useMemo(() => assumptionItems(draft.assumptions, guestCount), [draft.assumptions, guestCount]);
  const [aiOpen, setAiOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [withGoal, setWithGoal] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [sources, setSources] = useState('');
  const lock = useRef(false);
  const accent = { color: theme.accent };

  const save = (next: EventAssumptionItem[]) => update((current) => ({ ...current, assumptions: assumptionDraft(next, current.event.guestCount) }));
  const updateItem = (index: number, patch: Partial<EventAssumptionItem>) =>
    save(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  const changeKey = (index: number, key: EventAssumptionKey) => {
    const option = getEventAssumptionOption(key);
    save(items.map((item, position) => (position === index
      ? { key, label: key === 'custom' ? '' : option.label, value: option.defaultValue || '', badge_value: option.defaultBadgeValue || '' }
      : item)));
  };

  const generate = async () => {
    if (lock.current) return;
    lock.current = true;
    setGenerating(true);
    setAiError('');
    try {
      // Karty w kolejności z ekranu — serwer zwraca je w tej samej kolejności.
      const proposal = await showcasePost<ShowcaseOfferAssumptionsDraft>('offerAssumptionsAI', {
        draft: { ...draft, assumptions: assumptionDraft(items, guestCount) }, instructions: instructions.trim(), generateGoal: withGoal,
      });
      const next = showcaseOfferAssumptionsFromDraft(proposal.items);
      if (next.length !== 3) throw new Error('AI nie przygotowało trzech kompletnych założeń. Spróbuj ponownie.');
      update((current) => ({ ...current, assumptions: next, goal: withGoal && proposal.goal ? proposal.goal.slice(0, EVENT_GOAL_MAX_LENGTH) : current.goal }));
      setSources(proposal.sources || '');
      setAiOpen(false);
      onNotice(withGoal ? 'AI uzupełniło założenia i cel eventu — sprawdź je przed utworzeniem oferty.' : 'AI uzupełniło założenia — sprawdź je przed utworzeniem oferty.');
    } catch (cause) {
      setAiError(errorMessage(cause, 'Nie udało się przygotować założeń przez AI.'));
    } finally {
      lock.current = false;
      setGenerating(false);
    }
  };

  const used = new Set(items.map((item) => item.key));
  return (
    <Section title="Założenia i cel" icon={<Target className="h-5 w-5" />}
      aside={(
        <button type="button" onClick={() => { setAiError(''); setAiOpen((open) => !open); }} disabled={generating} aria-expanded={aiOpen}
          className="flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] disabled:opacity-40" style={{ borderColor: `${theme.accent}80`, color: theme.accent }}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{generating ? 'AI przygotowuje…' : 'Zaproponuj z AI'}
        </button>
      )}>
      <p className="text-[15px] text-[#e5e4e2]/65">
        Trzy najważniejsze informacje o realizacji — te same karty i znaczniki trafią do oferty PDF.
        {draft.inquiryId ? ' Puste karty — oferta weźmie założenia i cel z zapytania klienta.' : ''}
      </p>
      {aiOpen && (
        <div className="space-y-3 rounded-2xl bg-black/25 p-4" style={{ boxShadow: `inset 0 0 0 1px ${theme.accent}55` }}>
          <p className="text-[15px] text-[#e5e4e2]/75">
            AI uzupełni trzy wybrane karty w tej samej kolejności — z {draft.inquiryId ? 'ustaleń, analiz i korespondencji zapytania, ' : 'nazwy, terminu i miejsca eventu, '}
            pozycji oferty, notatki ze spotkania i Twoich wskazówek. Brakujące fakty oznaczy do doprecyzowania; propozycję sprawdzasz przed utworzeniem oferty.
          </p>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={withGoal} disabled={generating} onChange={(event) => setWithGoal(event.target.checked)} />Uzupełnij również cel eventu
          </label>
          <Field label="Co chcesz osiągnąć? (opcjonalnie)" hint={`Puste pole — propozycja według bazowej instrukcji. ${instructions.length}/${EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH}`}>
            <textarea value={instructions} maxLength={EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH} rows={3} disabled={generating}
              placeholder="Np. konferencja: podkreśl, że systemy liniowe dają każdemu na sali doskonały dźwięk. Ton profesjonalny, bez sloganów."
              onChange={(event) => setInstructions(event.target.value.slice(0, EVENT_ASSUMPTION_AI_INSTRUCTIONS_MAX_LENGTH))} className={`${inputClass} h-auto py-3 leading-relaxed`} />
          </Field>
          <p className="text-[13px] text-[#e5e4e2]/45">Propozycja zastąpi treść trzech kart{withGoal ? ' i cel eventu' : ''}.</p>
          {aiError && <p role="alert" className="text-[14px] text-red-300">{aiError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAiOpen(false)} disabled={generating} className="h-11 rounded-full bg-black/30 px-5 text-[15px] disabled:opacity-40" style={accent}>Anuluj</button>
            <button type="button" onClick={generate} disabled={generating}
              className="flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-medium disabled:opacity-40" style={{ background: theme.accent, color: theme.surface }}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{generating ? 'AI przygotowuje…' : 'Przygotuj propozycję'}
            </button>
          </div>
        </div>
      )}
      {sources && <p className="text-[13px] text-[#e5e4e2]/45">{sources}</p>}
      <div className="grid gap-3 lg:grid-cols-3">
        {items.map((item, index) => {
          const option = getEventAssumptionOption(item.key);
          const guestLocked = item.key === 'guest_count';
          return (
            <div key={`${index}-${item.key}`} className="space-y-2 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold" style={{ ...DIGITS, color: theme.accent, background: `${theme.accent}26` }}>{index + 1}</span>
                <select value={item.key} aria-label={`Kategoria karty ${index + 1}`} onChange={(event) => changeKey(index, event.target.value as EventAssumptionKey)}
                  className={inputClass}>
                  {EVENT_ASSUMPTION_OPTIONS.map((choice) => (
                    <option key={choice.key} value={choice.key} disabled={choice.key !== 'custom' && choice.key !== item.key && used.has(choice.key)}>
                      {choice.key === 'custom' ? 'Własne założenie' : choice.label}
                    </option>
                  ))}
                </select>
              </div>
              {item.key === 'custom' && (
                <input value={item.label === option.label ? '' : item.label} maxLength={80} placeholder="Własny tytuł (np. Energia na parkiecie)"
                  onChange={(event) => updateItem(index, { label: event.target.value.slice(0, 80) })} className={inputClass} />
              )}
              {guestLocked ? (
                <p className="text-[14px]" style={accent}>
                  {guestCount ? `${guestCount} osób — z pola „Liczba osób” powyżej.` : 'Uzupełnij „Liczba osób” powyżej — karta wypełni się sama.'}
                </p>
              ) : (
                <>
                  <input value={item.badge_value || ''} maxLength={7} placeholder={`Znacznik w PDF (np. 180, 6 H) — puste: 0${index + 1}`} aria-label={`Znacznik karty ${index + 1}`}
                    onChange={(event) => updateItem(index, { badge_value: event.target.value.toLocaleUpperCase('pl-PL').slice(0, 7) })} className={inputClass} style={DIGITS} />
                  <textarea value={item.value} maxLength={EVENT_ASSUMPTION_VALUE_MAX_LENGTH} rows={option.multiline ? 4 : 2} placeholder={option.placeholder || option.question}
                    aria-label={option.question} onChange={(event) => updateItem(index, { value: event.target.value.slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH) })}
                    className={`${inputClass} h-auto py-3 leading-relaxed`} />
                  <div className="flex gap-2 text-[13px] text-[#e5e4e2]/45">
                    <span className="flex-1">{option.question}</span>
                    <span className={item.value.length >= EVENT_ASSUMPTION_VALUE_MAX_LENGTH ? 'text-amber-200' : ''} style={DIGITS}>{item.value.length}/{EVENT_ASSUMPTION_VALUE_MAX_LENGTH}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <Field label="Cel eventu">
        <textarea value={draft.goal} maxLength={EVENT_GOAL_MAX_LENGTH} rows={3} placeholder="Co klient chce osiągnąć? (np. integracja zespołu i podziękowanie za rok pracy)"
          onChange={(event) => update((current) => ({ ...current, goal: event.target.value.slice(0, EVENT_GOAL_MAX_LENGTH) }))} className={`${inputClass} h-auto py-3 leading-relaxed`} />
      </Field>
    </Section>
  );
}

const dateLabel = (value: string | null) => {
  if (!value) return '';
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}${time ? `, ${time}` : ''}`;
};

/** Arkusz oferty ze spotkania (w scenie pokazu — działa także na pełnym ekranie i w ramce iPada). */
export function ShowcaseOfferSheet({ offer, theme, onClose, onNotice }: {
  offer: ShowcaseOfferState;
  theme: Theme;
  onClose: () => void;
  onNotice: (text: string, tone?: Tone) => void;
}) {
  const { draft, update, setup } = offer;
  const [preview, setPreview] = useState<ShowcaseOfferPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ShowcaseOfferClientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [context, setContext] = useState<ShowcaseOfferClientContext | null>(null);
  const [newPerson, setNewPerson] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ShowcaseOfferResult | null>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [approval, setApproval] = useState<ShowcaseOfferApproval | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [email, setEmail] = useState<ShowcaseOfferEmailSetup | null>(null);
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', text: '', accountId: '' });
  const [sent, setSent] = useState(false);
  const [customDiscount, setCustomDiscount] = useState('');
  const [addingLine, setAddingLine] = useState(false);
  const emailBox = useRef<HTMLDivElement>(null);

  // Formularz wysyłki pod przyciskami — przewinięcie do niego po otwarciu.
  useEffect(() => {
    if (email) emailBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [email]);

  // Własny rabat (pole „Inny”) — po wczytaniu innego szkicu pokazuje jego wartość.
  useEffect(() => {
    setCustomDiscount(DISCOUNT_PRESETS.includes(draft.discountPercent) ? '' : String(draft.discountPercent).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  const client = draft.client;
  const chosen = Boolean(client.organizationId || client.contactId);
  /** Klient roboczy (sama nazwa, bez bazy). */
  const placeholderChosen = !chosen && isShowcaseOfferPlaceholder(client);
  const setClient = (patch: Partial<ShowcaseOfferClient>) => update((current) => ({ ...current, client: { ...current.client, ...patch } }));

  // Podgląd cen (serwer) po zmianie pozycji, rabatu albo liczby osób.
  const previewKey = JSON.stringify({ lines: draft.lines, discount: draft.discountPercent, guests: draft.event.guestCount });
  useEffect(() => {
    if (result) return;
    if (!draft.lines.length) { setPreview(null); setPreviewError(''); return; }
    let active = true;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      showcasePost<ShowcaseOfferPreview>('offerPreview', { draft: normalizeShowcaseOfferDraft(draft) })
        .then((value) => { if (active) { setPreview(value); setPreviewError(''); } })
        .catch((cause) => { if (active) setPreviewError(errorMessage(cause, 'Nie udało się przeliczyć oferty.')); })
        .finally(() => { if (active) setPreviewing(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, result]);

  // Wyszukiwanie klienta w CRM.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || chosen) { setHits([]); return; }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      showcaseGet<{ clients: ShowcaseOfferClientHit[] }>('offerClients', { q: term })
        .then((value) => { if (active) setHits(value.clients); })
        .catch(() => { if (active) setHits([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, chosen]);

  // Osoby kontaktowe firmy i otwarte zapytania klienta.
  useEffect(() => {
    if (!chosen) { setContext(null); return; }
    let active = true;
    showcaseGet<ShowcaseOfferClientContext>('offerClient', client.organizationId ? { organization: client.organizationId } : { contact: client.contactId })
      .then((value) => { if (active) setContext(value); })
      .catch(() => { if (active) setContext({ persons: [], inquiries: [] }); });
    return () => { active = false; };
  }, [chosen, client.organizationId, client.contactId]);

  const choose = (hit: ShowcaseOfferClientHit) => {
    update((current) => ({
      ...current,
      inquiryId: null,
      inquiryTitle: '',
      client: {
        ...emptyShowcaseOfferClient(),
        organizationId: hit.organizationId,
        organizationName: hit.organizationName,
        contactId: hit.kind === 'contact' ? hit.id : null,
        contactName: hit.kind === 'contact' ? hit.name : '',
      },
    }));
    setQuery('');
    setHits([]);
    setNewPerson(false);
  };
  const clearClient = () => {
    update((current) => ({ ...current, inquiryId: null, inquiryTitle: '', client: emptyShowcaseOfferClient() }));
    setContext(null);
    setNewPerson(false);
  };
  /** Klient roboczy: oferta bez klienta w bazie — sama nazwa, klienta przypisuje się później w CRM. */
  const choosePlaceholder = (name: string) => {
    const placeholder = name.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!placeholder) return;
    update((current) => ({ ...current, inquiryId: null, inquiryTitle: '', client: { ...emptyShowcaseOfferClient(), placeholder } }));
    setQuery('');
    setHits([]);
    setNewClient(false);
    setNewPerson(false);
  };
  const chooseInquiry = (inquiry: ShowcaseOfferInquiry | null) => update((current) => ({
    ...current,
    inquiryId: inquiry?.id || null,
    inquiryTitle: inquiry?.title || '',
    event: inquiry && current.event.guestCount == null && inquiry.guestCount ? { ...current.event, guestCount: inquiry.guestCount } : current.event,
  }));
  const selectedInquiry = context?.inquiries.find((entry) => entry.id === draft.inquiryId) || null;

  const setLine = (key: string, patch: Partial<ShowcaseOfferLine>) => update((current) => ({
    ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
  }));
  const removeLine = (key: string) => update((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) }));
  const drag = useDragList<ShowcaseOfferLine>({ items: draft.lines, keyOf: (line) => line.key, onMove: (lines) => update((current) => ({ ...current, lines })), group: 'showcase-offer-lines' });

  const normalized = useMemo(() => normalizeShowcaseOfferDraft(draft), [draft]);
  const localProblem = showcaseOfferProblem(normalized);
  const problem = localProblem || preview?.problem || previewError || null;
  // Próg akceptacji liczy rabat łączny (rabaty pozycji i rabat całej oferty).
  const hint = showcaseOfferApprovalHint(setup, preview?.effectiveDiscountPercent ?? draft.discountPercent);
  /** Rabat wszystkich pozycji, jeśli wszystkie mają ten sam (lista „Ten sam rabat na wszystkie pozycje”). */
  const sharedLineDiscount = draft.lines.length && draft.lines.every((line) => line.discountPercent === draft.lines[0].discountPercent) ? draft.lines[0].discountPercent : null;
  /** Jak klient widzi rabat w PDF (preferencja sprzedawcy, zapamiętana na serwerze dla kolejnych ofert). */
  const changeDiscountDisplay = (display: ShowcaseOfferDiscountDisplay) => {
    if (display === draft.discountDisplay) return;
    void offer.setDiscountDisplay(display).then((saved) => {
      if (!saved) onNotice('Nie udało się zapamiętać ustawienia na serwerze — obowiązuje w tej ofercie.', 'error');
    });
  };
  const discountDisplayOption = SHOWCASE_OFFER_DISCOUNT_DISPLAYS.find((display) => display.key === draft.discountDisplay) || SHOWCASE_OFFER_DISCOUNT_DISPLAYS[0];
  const canCreate = Boolean(setup?.canOffer) && !problem && !previewing && Boolean(preview) && !busy;

  const generatePdf = async (id: string, number: string) => {
    setBusy('Generuję PDF oferty…');
    try {
      await showcaseOfferGeneratePdf(id, (label) => setBusy(label));
      setPdfReady(true);
      return true;
    } catch (cause) {
      setPdfReady(false);
      onNotice(`Oferta ${number} jest zapisana, ale PDF się nie wygenerował: ${errorMessage(cause, 'spróbuj ponownie.')}`, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy('Tworzę ofertę i zapytanie…');
    let created: ShowcaseOfferResult;
    try {
      created = await showcasePost<ShowcaseOfferResult>('offerCreate', { draft: normalized });
    } catch (cause) {
      const saved = cause as { inquiryId?: string; organizationId?: string; contactId?: string };
      if (saved?.inquiryId) {
        // Zapytanie i klient już są w CRM — ponowna próba dopina do nich ofertę.
        update((current) => ({
          ...current,
          inquiryId: saved.inquiryId!,
          inquiryTitle: current.inquiryTitle || 'Zapytanie ze spotkania',
          client: saved.organizationId || saved.contactId
            ? { ...current.client, organizationId: saved.organizationId || null, contactId: saved.contactId || null, company: '', nip: '', firstName: '', lastName: '' }
            : current.client,
        }));
      }
      setBusy(null);
      onNotice(errorMessage(cause, 'Nie udało się utworzyć oferty.'), 'error');
      return;
    }
    setResult(created);
    setApproval(created.approval);
    setPdfReady(false);
    setSent(false);
    setEmail(null);
    offer.reset();
    await generatePdf(created.offerId, created.number);
  };

  const showPdf = async () => {
    if (!result) return;
    // Okno otwiera się od razu (w kliknięciu) — inaczej przeglądarka blokuje je jako wyskakujące.
    const win = window.open('', '_blank');
    try {
      const pdf = await showcaseGet<{ url: string; name: string }>('offerPdf', { id: result.offerId });
      if (win) {
        win.opener = null;
        win.location.href = pdf.url;
      } else {
        onNotice('Przeglądarka zablokowała nowe okno — zezwól na wyskakujące okna dla CRM.', 'error');
      }
    } catch (cause) {
      win?.close();
      onNotice(errorMessage(cause, 'Nie udało się otworzyć PDF.'), 'error');
    }
  };

  const openEmail = async () => {
    if (!result) return;
    setBusy('Przygotowuję wiadomość…');
    try {
      const value = await showcaseGet<ShowcaseOfferEmailSetup>('offerEmail', { id: result.offerId });
      setEmail(value);
      setEmailForm({ to: value.to || result.clientEmail, subject: value.subject, text: value.text, accountId: value.accounts[0]?.id || '' });
    } catch (cause) {
      onNotice(errorMessage(cause, 'Nie udało się przygotować wiadomości.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sendEmail = async () => {
    if (!result || !email) return;
    setBusy('Wysyłam ofertę…');
    try {
      const value = await showcasePost<{ sent: boolean; warning: string | null }>('offerEmailSend', {
        id: result.offerId, to: emailForm.to, subject: emailForm.subject, text: emailForm.text, accountId: emailForm.accountId, recipientName: email.recipientName,
      });
      setSent(true);
      setEmail(null);
      onNotice(value.warning || `Oferta ${result.number} wysłana do ${emailForm.to}.`, value.warning ? 'error' : 'info');
    } catch (cause) {
      onNotice(errorMessage(cause, 'Nie udało się wysłać oferty.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const requestApproval = async () => {
    if (!result) return;
    setBusy('Wysyłam prośbę o akceptację…');
    try {
      setApproval(await showcasePost<ShowcaseOfferApproval>('offerApproval', { id: result.offerId, note: approvalNote }));
      onNotice('Prośba o akceptację rabatu wysłana — dostaniesz powiadomienie po decyzji.');
    } catch (cause) {
      onNotice(errorMessage(cause, 'Nie udało się wysłać prośby o akceptację.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const refreshStatus = async () => {
    if (!result) return;
    try {
      const status = await showcaseGet<ShowcaseOfferStatus>('offerStatus', { id: result.offerId });
      setApproval(status.approval);
      setPdfReady(status.pdfReady);
      if (status.approval.canSend && status.approval.required) onNotice('Rabat zaakceptowany — możesz wysłać ofertę.');
    } catch (cause) {
      onNotice(errorMessage(cause, 'Nie udało się odświeżyć oferty.'), 'error');
    }
  };

  const newOffer = () => {
    setCustomDiscount('');
    setResult(null);
    setApproval(null);
    setEmail(null);
    setSent(false);
    setPreview(null);
  };

  const timePart = draft.event.date.includes('T') ? draft.event.date.split('T')[1] : '';
  const datePart = draft.event.date.split('T')[0] || '';
  const setDate = (date: string, time: string) => update((current) => ({ ...current, event: { ...current.event, date: date ? (time ? `${date}T${time}` : date) : '' } }));
  const lineView = (key: string) => preview?.lines.find((entry) => entry.key === key) || null;
  const accent = { color: theme.accent };
  const primary: CSSProperties = { background: theme.accent, color: theme.surface };

  return (
    <div className="absolute inset-0 z-40" data-no-swipe>
      <button type="button" aria-label="Zamknij ofertę" className="absolute inset-0 h-full w-full cursor-default bg-black/55" onClick={onClose} />
      <aside role="dialog" aria-label="Oferta dla klienta" className="absolute inset-y-0 right-0 flex w-full max-w-[640px] flex-col shadow-2xl ring-1 ring-white/10"
        style={{ background: theme.surface, color: TEXT, ['--offer-accent' as string]: theme.accent }}>
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-6">
          <ClipboardList className="h-6 w-6" style={accent} />
          <h2 className="flex-1 text-[22px]" style={{ fontFamily: theme.heading }}>{result ? `Oferta ${result.number}` : 'Oferta dla klienta'}</h2>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30" style={accent}><X className="h-5 w-5" /></button>
        </header>

        {result ? (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <div className="rounded-3xl bg-black/25 p-6 ring-1 ring-white/10">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="mt-1 h-8 w-8 shrink-0" style={accent} />
                <div className="min-w-0 flex-1">
                  <div className="text-[22px] leading-snug">Oferta {result.number} jest gotowa</div>
                  <div className="mt-1 text-[16px] text-[#e5e4e2]/65">{result.clientName}{result.inquiryCreated ? ' · nowe zapytanie w CRM' : ' · dopięta do zapytania klienta'}</div>
                  {result.clientPlaceholder && <div className="mt-1 text-[14px] text-amber-200">Klient roboczy — przypisz klienta w CRM (oferta → Klient) przed wysłaniem oferty.</div>}
                  <div className="mt-3 text-[26px] font-semibold" style={accent}>{formatShowcaseAmount(result.gross)} <span className="text-[15px] font-normal text-[#e5e4e2]/60">brutto · {formatShowcaseAmount(result.net)} netto</span></div>
                </div>
              </div>
            </div>

            {approval?.required && !approval.canSend && (
              <div className="space-y-3 rounded-3xl bg-amber-400/10 p-5 ring-1 ring-amber-400/30">
                <div className="flex gap-3 text-[16px]">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <div>{approval.reasons.join(' · ') || 'Rabat przekracza próg.'}</div>
                    <div className="mt-1 text-[14px] text-[#e5e4e2]/60">
                      {approval.status === 'pending' ? 'Prośba o akceptację czeka na decyzję. Ofertę możesz już pokazać klientowi.' : 'Ofertę możesz pokazać klientowi od razu — wyślesz ją po akceptacji rabatu.'}
                    </div>
                  </div>
                </div>
                {approval.status !== 'pending' && (
                  <input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} maxLength={1000} placeholder="Uzasadnienie (opcjonalnie), np. stały klient"
                    className={inputClass} />
                )}
                <div className="flex flex-wrap gap-2">
                  {approval.status !== 'pending' && (
                    <button type="button" onClick={requestApproval} disabled={Boolean(busy)} className="flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-medium" style={primary}>
                      <Send className="h-4 w-4" />Poproś o akceptację
                    </button>
                  )}
                  <button type="button" onClick={refreshStatus} className="flex h-11 items-center gap-2 rounded-full bg-black/30 px-5 text-[15px]" style={accent}>
                    <RotateCcw className="h-4 w-4" />Sprawdź decyzję
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {pdfReady ? (
                <button type="button" onClick={showPdf} className="flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-medium" style={primary}>
                  <FileText className="h-5 w-5" />Pokaż PDF klientowi
                </button>
              ) : (
                <button type="button" onClick={() => void generatePdf(result.offerId, result.number)} disabled={Boolean(busy)}
                  className="flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-medium" style={primary}>
                  <RotateCcw className="h-5 w-5" />Wygeneruj PDF
                </button>
              )}
              <button type="button" onClick={openEmail} disabled={!pdfReady || Boolean(busy) || sent || (approval ? !approval.canSend : false)}
                title={approval && !approval.canSend ? 'Wysyłka po akceptacji rabatu' : !pdfReady ? 'Najpierw PDF oferty' : ''}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-black/30 text-[17px] ring-1 ring-white/10 disabled:opacity-40" style={accent}>
                <Mail className="h-5 w-5" />{sent ? 'Wysłano e-mailem' : 'Wyślij e-mailem'}
              </button>
              <a href={`/crm/offers/${result.offerId}`} target="_blank" rel="noopener noreferrer"
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-black/30 text-[17px] ring-1 ring-white/10" style={accent}>
                <ExternalLink className="h-5 w-5" />Otwórz w CRM
              </a>
              <button type="button" onClick={newOffer} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-black/30 text-[17px] ring-1 ring-white/10" style={accent}>
                <Plus className="h-5 w-5" />Nowa oferta
              </button>
            </div>

            {email && (
              <div ref={emailBox} className="space-y-4 rounded-3xl bg-black/25 p-5 ring-1 ring-white/10">
                <div className="text-[18px]">Wyślij ofertę {email.number}</div>
                {email.accounts.length ? (
                  <>
                    <Field label="Z adresu">
                      <select value={emailForm.accountId} onChange={(event) => setEmailForm((form) => ({ ...form, accountId: event.target.value }))} className={inputClass}>
                        {email.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Do" hint="Kilka adresów oddziel przecinkiem.">
                      <input type="email" multiple value={emailForm.to} onChange={(event) => setEmailForm((form) => ({ ...form, to: event.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="Temat">
                      <input value={emailForm.subject} onChange={(event) => setEmailForm((form) => ({ ...form, subject: event.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="Treść" hint="Stopka firmy dołączy się jak w CRM. PDF oferty w załączniku.">
                      <textarea value={emailForm.text} onChange={(event) => setEmailForm((form) => ({ ...form, text: event.target.value }))} rows={6}
                        className={`${inputClass} h-auto py-3 leading-relaxed`} />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEmail(null)} className="h-11 rounded-full bg-black/30 px-5 text-[15px]" style={accent}>Anuluj</button>
                      <button type="button" onClick={sendEmail}
                        disabled={Boolean(busy) || !emailForm.accountId || !emailForm.subject.trim() || !emailForm.text.trim() || !emailForm.to.split(/[,;]/).map((value) => value.trim()).filter(Boolean).every(isShowcaseOfferEmail)}
                        className="flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-medium disabled:opacity-40" style={primary}>
                        <Send className="h-4 w-4" />Wyślij
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[15px] text-[#e5e4e2]/65">Nie masz skrzynki do wysyłki. Dodaj ją w CRM (Wiadomości → Skrzynki) albo wyślij ofertę z CRM.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {setup && !setup.canOffer && (
                <p className="m-6 rounded-2xl bg-amber-400/10 p-4 text-[15px] ring-1 ring-amber-400/30">{setup.reason}</p>
              )}

              <Section title="Klient" icon={<Building2 className="h-5 w-5" />}
                aside={!chosen && !placeholderChosen ? (
                  <button type="button" onClick={() => setNewClient((value) => !value)} className="h-11 rounded-full px-4 text-[15px]" style={accent}>
                    {newClient ? 'Szukaj w CRM' : 'Nowy klient'}
                  </button>
                ) : null}>
                {chosen ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10">
                      {client.organizationId ? <Building2 className="h-6 w-6 shrink-0" style={accent} /> : <User className="h-6 w-6 shrink-0" style={accent} />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[18px]">{client.organizationName || client.contactName || 'Klient z CRM'}</div>
                        {client.organizationId && client.contactName && <div className="truncate text-[14px] text-[#e5e4e2]/60">{client.contactName}</div>}
                      </div>
                      <button type="button" onClick={clearClient} className="h-11 rounded-full px-4 text-[15px]" style={accent}>Zmień</button>
                    </div>
                    {client.organizationId && context && (
                      <div>
                        <div className="mb-2 text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Osoba kontaktowa</div>
                        <select value={newPerson ? 'new' : client.contactId || ''} aria-label="Osoba kontaktowa"
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === 'new') { setNewPerson(true); setClient({ contactId: null, contactName: '' }); return; }
                            const person = context.persons.find((entry) => entry.id === value) || null;
                            setNewPerson(false);
                            setClient({ contactId: person?.id || null, contactName: person?.name || '', firstName: '', lastName: '', email: '', phone: '' });
                          }}
                          className={inputClass}>
                          <option value="">Bez osoby kontaktowej (oferta na firmę)</option>
                          {context.persons.map((person) => (
                            <option key={person.id} value={person.id}>{[person.name, person.email || person.phone].filter(Boolean).join(' — ')}</option>
                          ))}
                          <option value="new">+ Nowa osoba kontaktowa</option>
                        </select>
                        {newPerson && (
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <Field label="Imię"><input value={client.firstName} onChange={(event) => setClient({ firstName: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                            <Field label="Nazwisko"><input value={client.lastName} onChange={(event) => setClient({ lastName: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                            <Field label="E-mail"><input type="email" value={client.email} onChange={(event) => setClient({ email: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                            <Field label="Telefon"><input type="tel" value={client.phone} onChange={(event) => setClient({ phone: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                          </div>
                        )}
                      </div>
                    )}
                    {context && (
                      <div>
                        <div className="mb-2 text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Zapytanie</div>
                        <div className="space-y-2">
                          <InquiryOption active={!draft.inquiryId} theme={theme} title="Nowe zapytanie" detail="Źródło: rozmowa na spotkaniu · etap „Zakwalifikowane”" onClick={() => chooseInquiry(null)} />
                          {context.inquiries.map((inquiry) => (
                            <InquiryOption key={inquiry.id} active={draft.inquiryId === inquiry.id} theme={theme} title={inquiry.title}
                              detail={[inquiry.stageLabel, dateLabel(inquiry.date), inquiry.location].filter(Boolean).join(' · ')} onClick={() => chooseInquiry(inquiry)} />
                          ))}
                          {draft.inquiryId && !selectedInquiry && (
                            <InquiryOption active theme={theme} title={draft.inquiryTitle || 'Zapytanie klienta'} detail="Oferta trafi do tego zapytania" onClick={() => undefined} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : placeholderChosen ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10">
                    <Pencil className="h-6 w-6 shrink-0" style={accent} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[18px]">{client.placeholder}</div>
                      <div className="text-[14px] text-[#e5e4e2]/60">Klient roboczy — bez dodawania do bazy. Klienta przypiszesz w CRM, zanim wyślesz ofertę.</div>
                    </div>
                    <button type="button" onClick={() => { setQuery(client.placeholder); clearClient(); }} className="h-11 rounded-full px-4 text-[15px]" style={accent}>Zmień</button>
                  </div>
                ) : newClient ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><Field label="Firma (opcjonalnie)"><input value={client.company} onChange={(event) => setClient({ company: event.target.value })} className={inputClass} autoComplete="off" /></Field></div>
                    <Field label="NIP"><input inputMode="numeric" value={client.nip} onChange={(event) => setClient({ nip: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                    <div />
                    <Field label="Imię"><input value={client.firstName} onChange={(event) => setClient({ firstName: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                    <Field label="Nazwisko"><input value={client.lastName} onChange={(event) => setClient({ lastName: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                    <Field label="E-mail"><input type="email" value={client.email} onChange={(event) => setClient({ email: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                    <Field label="Telefon"><input type="tel" value={client.phone} onChange={(event) => setClient({ phone: event.target.value })} className={inputClass} autoComplete="off" /></Field>
                    <p className="col-span-2 text-[13px] text-[#e5e4e2]/45">Bez duplikatów: istniejąca firma (NIP, nazwa) i osoba (e-mail, telefon) zostaną użyte zamiast nowych.</p>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-[#e5e4e2]/40" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firma, NIP, osoba, e-mail albo telefon" autoComplete="off"
                      className={`${inputClass} pl-12`} />
                    {searching && <Loader2 className="absolute right-4 top-3.5 h-5 w-5 animate-spin" style={accent} />}
                    {hits.length > 0 && (
                      <div className="mt-2 max-h-[320px] overflow-y-auto rounded-2xl bg-black/40 ring-1 ring-white/10">
                        {hits.map((hit) => (
                          <button key={`${hit.kind}:${hit.id}`} type="button" onClick={() => choose(hit)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5">
                            {hit.kind === 'organization' ? <Building2 className="h-5 w-5 shrink-0" style={accent} /> : <User className="h-5 w-5 shrink-0" style={accent} />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[16px]">{hit.name}</span>
                              {hit.detail && <span className="block truncate text-[13px] text-[#e5e4e2]/55">{hit.detail}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {query.trim().length >= 2 && !searching && !hits.length && (
                      <p className="mt-2 text-[14px] text-[#e5e4e2]/55">Brak wyników. <button type="button" className="underline" style={accent} onClick={() => setNewClient(true)}>Dodaj nowego klienta</button></p>
                    )}
                    {query.trim().length >= 2 && !searching && (
                      <button type="button" onClick={() => choosePlaceholder(query)}
                        className="mt-2 flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-black/25 px-4 py-2 text-left ring-1 ring-white/10 hover:bg-white/5">
                        <Pencil className="h-5 w-5 shrink-0" style={accent} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[16px]">Bez bazy: „{query.trim()}”</span>
                          <span className="block text-[13px] text-[#e5e4e2]/55">Klient roboczy — oferta bez klienta w CRM, przypiszesz go później.</span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </Section>

              <Section title="Event" icon={<ClipboardList className="h-5 w-5" />}>
                {draft.inquiryId ? (
                  <p className="text-[15px] text-[#e5e4e2]/65">
                    Termin, miejsce i ustalenia z zapytania „{selectedInquiry?.title || draft.inquiryTitle || 'klienta'}”
                    {selectedInquiry && (selectedInquiry.date || selectedInquiry.location) ? ` (${[dateLabel(selectedInquiry.date), selectedInquiry.location].filter(Boolean).join(', ')})` : ''}.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><Field label="Nazwa eventu"><input value={draft.event.name} onChange={(event) => update((current) => ({ ...current, event: { ...current.event, name: event.target.value } }))} placeholder="np. Gala firmowa 2027" className={inputClass} /></Field></div>
                    <Field label="Termin"><input type="date" value={datePart} onChange={(event) => setDate(event.target.value, timePart)} className={inputClass} /></Field>
                    <Field label="Godzina (opcjonalnie)"><input type="time" value={timePart} disabled={!datePart} onChange={(event) => setDate(datePart, event.target.value)} className={inputClass} /></Field>
                    <div className="col-span-2">
                      <LocationField value={draft.event.location} locationId={draft.event.locationId} theme={theme}
                        onChange={(location, locationId) => update((current) => ({ ...current, event: { ...current.event, location, locationId } }))} />
                    </div>
                  </div>
                )}
                <Field label="Liczba osób" hint="Ceny „na osobę” i „na stół” liczą się z tej liczby.">
                  <input inputMode="numeric" value={draft.event.guestCount ?? ''} placeholder="np. 120"
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
                      update((current) => ({ ...current, event: { ...current.event, guestCount: digits ? Math.min(100000, Number(digits)) || null : null } }));
                    }} className={inputClass} />
                </Field>
              </Section>

              <AssumptionsSection draft={draft} update={update} theme={theme} onNotice={onNotice} />

              <Section title={<>Pozycje <span style={DIGITS}>({draft.lines.length})</span></>} icon={<ClipboardList className="h-5 w-5" />}
                aside={(
                  <span className="flex items-center gap-2">
                    {previewing ? <Loader2 className="h-5 w-5 animate-spin" style={accent} /> : null}
                    <button type="button" onClick={() => setAddingLine(true)} disabled={draft.lines.length >= SHOWCASE_OFFER_LIMITS.lines}
                      className="flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] disabled:opacity-40" style={{ borderColor: `${theme.accent}80`, color: theme.accent }}>
                      <Plus className="h-4 w-4" />Dodaj pozycję
                    </button>
                  </span>
                )}>
                {!draft.lines.length && (
                  <p className="rounded-2xl bg-black/20 p-5 text-[15px] text-[#e5e4e2]/60">Dodaj pozycję z katalogu („Dodaj pozycję”) albo przyciskiem „Do oferty” przy wariancie i pakiecie na kartach pokazu.</p>
                )}
                <div className="space-y-3">
                  {draft.lines.map((line) => {
                    const view = lineView(line.key);
                    return (
                      <div key={line.key} {...drag.rowProps(line)} className={`rounded-2xl bg-black/25 p-4 ring-1 ring-white/10 ${drag.indicator(line)} ${drag.dragging(line) ? 'opacity-50' : ''}`}>
                        <div className="flex items-start gap-3">
                          <span {...drag.handleProps(line)} className="mt-1 cursor-grab text-[#e5e4e2]/35" title="Przeciągnij, żeby zmienić kolejność"><GripVertical className="h-5 w-5" /></span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[17px] leading-snug">{view?.name || line.label}</div>
                            {line.itemTitle && <div className="text-[13px] text-[#e5e4e2]/45">z karty „{line.itemTitle}”</div>}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[17px] font-semibold tabular-nums" style={accent}>{view && !view.error ? formatShowcaseAmount(view.subtotal) : '—'}</div>
                            {view && !view.error && line.discountPercent > 0 && <div className="text-[13px] text-[#e5e4e2]/45 tabular-nums line-through">{formatShowcaseAmount(view.listSubtotal)}</div>}
                            {view && !view.error && <div className="text-[13px] text-[#e5e4e2]/45 tabular-nums">{view.quantity} × {formatShowcaseAmount(view.unitPrice)}{view.days > 1 ? ` × ${view.days} dni` : ''}</div>}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
                          {view?.quantityFromAudience
                            ? <span className="rounded-full bg-black/30 px-4 py-2.5 text-[14px] text-[#e5e4e2]/70">{view.quantity} {view.unit === 'stół' ? 'stołów' : 'osób'} (z liczby osób)</span>
                            : <Stepper value={line.quantity} min={1} max={SHOWCASE_OFFER_LIMITS.quantity} suffix="szt." theme={theme} onChange={(quantity) => setLine(line.key, { quantity })} />}
                          <Stepper value={line.days} min={1} max={SHOWCASE_OFFER_LIMITS.days} suffix={line.days === 1 ? 'dzień' : 'dni'} theme={theme} onChange={(days) => setLine(line.key, { days })} />
                          <DiscountSelect value={line.discountPercent} theme={theme} label={`Rabat pozycji: ${view?.name || line.label}`}
                            onChange={(discountPercent) => setLine(line.key, { discountPercent })} />
                          {line.priceOnRequest && (
                            <label className="relative">
                              <span className="sr-only">Uzgodniona cena netto</span>
                              <input inputMode="decimal" defaultValue={line.agreedPrice ?? ''} placeholder="Uzgodniona cena" aria-label="Uzgodniona cena netto"
                                onChange={(event) => setLine(line.key, { agreedPrice: showcaseOfferPrice(event.target.value) })}
                                className={`${pillInputClass} w-[240px] pl-4 pr-20`} />
                              <span className="pointer-events-none absolute right-4 top-3 text-[14px] text-[#e5e4e2]/50">zł netto</span>
                            </label>
                          )}
                          <button type="button" onClick={() => removeLine(line.key)} aria-label={`Usuń: ${line.label}`} className="ml-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-[#e5e4e2]/60 hover:text-red-300">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        {view?.error && <p className="mt-2 pl-8 text-[14px] text-red-300">{view.error}</p>}
                      </div>
                    );
                  })}
                </div>
              </Section>

              <Section title="Rabat" icon={<BadgePercent className="h-5 w-5" />}>
                <div className="space-y-2">
                  <div className="text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Rabat pozycji</div>
                  <p className="text-[14px] text-[#e5e4e2]/55">Przy każdej pozycji („Rabat” pod pozycją).</p>
                  {draft.lines.length > 1 && (
                    <label className="flex flex-wrap items-center gap-3 text-[15px]">
                      <span className="text-[#e5e4e2]/70">Ten sam rabat na wszystkie pozycje</span>
                      <DiscountSelect value={sharedLineDiscount} theme={theme} label="Rabat każdej pozycji"
                        onChange={(discountPercent) => update((current) => ({ ...current, lines: current.lines.map((line) => ({ ...line, discountPercent })) }))} />
                    </label>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Rabat na całą ofertę</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {DISCOUNT_PRESETS.map((value) => (
                      <button key={value} type="button" onClick={() => { setCustomDiscount(''); update((current) => ({ ...current, discountPercent: value })); }}
                        className="h-11 min-w-[64px] rounded-full border px-4 text-[15px]"
                        style={draft.discountPercent === value && !customDiscount ? { borderColor: theme.accent, background: `${theme.accent}26`, color: theme.accent } : { borderColor: 'rgba(255,255,255,.15)' }}>
                        {value}%
                      </button>
                    ))}
                    <div className="relative">
                      <input inputMode="decimal" value={customDiscount} placeholder="Inny"
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^\d.,]/g, '').slice(0, 6);
                          setCustomDiscount(value);
                          update((current) => ({ ...current, discountPercent: showcaseOfferDiscount(value) }));
                        }}
                        className={`${pillInputClass} w-[110px] pl-4 pr-8`} aria-label="Rabat w procentach" />
                      <span className="pointer-events-none absolute right-4 top-2.5 text-[15px] text-[#e5e4e2]/50">%</span>
                    </div>
                  </div>
                  <p className="text-[14px] text-[#e5e4e2]/55">Liczy się od wartości pozycji po ich rabatach.</p>
                </div>
                {preview && preview.effectiveDiscountPercent > 0 && (
                  <p className="text-[15px]">Rabat łączny: <span style={accent}>{formatShowcasePercent(preview.effectiveDiscountPercent)}</span> · −{formatShowcaseAmount(preview.lineDiscountAmount + preview.discountAmount)} netto</p>
                )}
                <div className="space-y-2">
                  <div className="text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Rabat w PDF dla klienta</div>
                  <div role="tablist" aria-label="Rabat w PDF dla klienta" className="flex rounded-full p-1 ring-1 ring-white/15">
                    {SHOWCASE_OFFER_DISCOUNT_DISPLAYS.map((display) => {
                      const active = draft.discountDisplay === display.key;
                      return (
                        <button key={display.key} type="button" role="tab" aria-selected={active} title={display.hint} onClick={() => changeDiscountDisplay(display.key)}
                          className="h-11 flex-1 rounded-full px-3 text-[15px]" style={active ? { background: theme.accent, color: theme.surface, fontWeight: 600 } : undefined}>
                          {display.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[13px] text-[#e5e4e2]/45">{discountDisplayOption.hint} Wybór zapamiętujemy — także na Macu, iPadzie i telefonie.</p>
                </div>
                {hint && <p className="flex gap-2 text-[14px] text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{hint}</p>}
              </Section>

              <Section title="Notatka ze spotkania" icon={<FileText className="h-5 w-5" />}>
                <textarea value={draft.note} maxLength={SHOWCASE_OFFER_LIMITS.note} rows={3} placeholder="Co ustaliliście? (zostaje w CRM, nie trafia do PDF)"
                  onChange={(event) => update((current) => ({ ...current, note: event.target.value }))} className={`${inputClass} h-auto py-3 leading-relaxed`} />
              </Section>
            </div>

            <footer className="shrink-0 space-y-3 border-t border-white/10 px-6 py-4" style={{ background: theme.surface }}>
              {preview && (
                <div className="space-y-1 text-[15px]">
                  {(preview.discountAmount > 0 || preview.lineDiscountAmount > 0) && (
                    <>
                      <div className="flex justify-between text-[#e5e4e2]/60"><span>Wartość pozycji netto</span><span className="tabular-nums">{formatShowcaseAmount(preview.listNet + preview.lineDiscountAmount)}</span></div>
                      {preview.lineDiscountAmount > 0 && (
                        <div className="flex justify-between text-[#e5e4e2]/60"><span>Rabaty pozycji</span><span className="tabular-nums">−{formatShowcaseAmount(preview.lineDiscountAmount)}</span></div>
                      )}
                      {preview.discountAmount > 0 && (
                        <div className="flex justify-between text-[#e5e4e2]/60"><span>Rabat na ofertę {formatShowcasePercent(preview.discountPercent)}</span><span className="tabular-nums">−{formatShowcaseAmount(preview.discountAmount)}</span></div>
                      )}
                      {preview.lineDiscountAmount > 0 && preview.discountAmount > 0 && (
                        <div className="flex justify-between text-[#e5e4e2]/60"><span>Rabat łączny {formatShowcasePercent(preview.effectiveDiscountPercent)}</span><span className="tabular-nums">−{formatShowcaseAmount(preview.lineDiscountAmount + preview.discountAmount)}</span></div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between"><span>Netto · VAT {preview.taxPercent}% {formatShowcaseAmount(preview.tax)}</span><span className="tabular-nums">{formatShowcaseAmount(preview.net)}</span></div>
                  <div className="flex items-baseline justify-between text-[22px] font-semibold" style={accent}><span>Brutto</span><span className="tabular-nums">{formatShowcaseAmount(preview.gross)}</span></div>
                </div>
              )}
              {problem && draft.lines.length > 0 && <p className="text-[14px] text-amber-200">{problem}</p>}
              <button type="button" onClick={create} disabled={!canCreate}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[18px] font-medium disabled:opacity-40" style={primary}>
                <FileText className="h-5 w-5" />Utwórz ofertę i PDF
              </button>
              <p className="text-center text-[13px] text-[#e5e4e2]/45">Oferta ważna {setup?.validDays ?? SHOWCASE_OFFER_LIMITS.validDays} dni · szkic zapisuje się na tym urządzeniu</p>
            </footer>
          </>
        )}

        {busy && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60" role="status" aria-live="polite">
            <div className="flex max-w-[420px] items-center gap-4 rounded-3xl px-7 py-6 shadow-2xl ring-1 ring-white/10" style={{ background: theme.surface }}>
              <Loader2 className="h-7 w-7 shrink-0 animate-spin" style={accent} />
              <span className="text-[17px]">{busy}</span>
            </div>
          </div>
        )}
        {addingLine && (
          <AddLineDialog theme={theme} onClose={() => setAddingLine(false)}
            onAdd={(product, choice) => {
              const outcome = offer.add(product, choice, null);
              if (outcome.result === 'added') onNotice(`Dodano do oferty: ${outcome.label}`);
              else if (outcome.result === 'exists') onNotice(`${outcome.label} jest już w ofercie.`);
              else if (outcome.result === 'full') onNotice(`Oferta ma już ${SHOWCASE_OFFER_LIMITS.lines} pozycji.`, 'error');
              else onNotice(product.configurable ? `${product.name}: produkt z konfiguratorem — dodasz go w edytorze oferty po jej utworzeniu.` : `${product.name} jest wycofany z katalogu.`, 'error');
              return outcome.result === 'added';
            }} />
        )}
      </aside>
    </div>
  );
}

/** Miejsce wydarzenia: podpowiedzi z bazy lokalizacji (CRM → Lokalizacje) albo własny tekst. */
function LocationField({ value, locationId, theme, onChange }: {
  value: string; locationId: string | null; theme: Theme; onChange: (location: string, locationId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<ShowcaseOfferLocation[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await showcaseGet<{ locations: ShowcaseOfferLocation[] }>('offerLocations', { q: value.trim() });
        if (active) setHits(data.locations);
      } catch {
        if (active) setHits([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, value]);
  const typed = value.trim();
  const exact = hits.some((hit) => hit.label.toLocaleLowerCase('pl') === typed.toLocaleLowerCase('pl'));
  return (
    <div className="relative">
      <Field label="Miejsce" hint={locationId ? 'Z bazy lokalizacji — zapytanie i oferta będą powiązane z obiektem.' : typed ? 'Własne miejsce — zapisze się jako tekst.' : 'Zacznij pisać — podpowiemy obiekty z bazy lokalizacji.'}>
        <span className="relative block">
          <MapPin className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-[#e5e4e2]/40" />
          <input value={value} role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off"
            onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onChange={(event) => { onChange(event.target.value, null); setOpen(true); }}
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
            placeholder="np. Hotel Omega, Olsztyn" className={`${inputClass} pl-11`} />
          {locationId && <CheckCircle2 className="pointer-events-none absolute right-4 top-3.5 h-5 w-5" style={{ color: theme.accent }} />}
        </span>
      </Field>
      {open && (hits.length > 0 || loading || (typed && !exact)) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl p-1.5 shadow-2xl ring-1 ring-white/10" style={{ background: theme.surface }} role="listbox">
          {loading && !hits.length && <div className="flex items-center gap-2 px-3 py-3 text-[14px] text-[#e5e4e2]/60"><Loader2 className="h-4 w-4 animate-spin" />Szukam w bazie lokalizacji…</div>}
          {hits.map((hit) => (
            <button key={hit.id} type="button" role="option" aria-selected={hit.id === locationId}
              onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(hit.label, hit.id); setOpen(false); }}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: theme.accent }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">{hit.label}</span>
                {hit.address && <span className="block truncate text-[13px] text-[#e5e4e2]/50">{hit.address}</span>}
              </span>
            </button>
          ))}
          {typed && !exact && (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(typed, null); setOpen(false); }}
              className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] text-[#e5e4e2]/75 hover:bg-white/5">
              <Plus className="h-4 w-4 shrink-0" />Użyj wpisanego: „{typed}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** „Dodaj pozycję”: produkt z katalogu (wyszukiwanie), potem wariant, pakiet albo sam produkt — jak „Do oferty” na kartach. */
function AddLineDialog({ theme, onClose, onAdd }: {
  theme: Theme;
  onClose: () => void;
  onAdd: (product: ShowcaseProductView, choice: Choice) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ShowcaseProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const [product, setProduct] = useState<{ view: ShowcaseProductView; urls: ShowcaseUrls } | null>(null);
  useEffect(() => {
    if (product) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await showcaseGet<{ products: ShowcaseProductOption[] }>('products', { q: query.trim() });
        if (active) { setOptions(data.products); setProblem(data.products.length ? '' : 'Brak produktów pasujących do wyszukiwania.'); }
      } catch (cause) {
        if (active) { setOptions([]); setProblem(errorMessage(cause, 'Nie udało się pobrać katalogu.')); }
      } finally {
        if (active) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, product]);
  const open = async (id: string) => {
    setLoading(true);
    try {
      const data = await showcaseGet<{ product: ShowcaseProductView; urls: ShowcaseUrls }>('offerProduct', { id });
      const view = data.product;
      // Bez wariantów i pakietów — od razu sam produkt.
      if (!view.variants.length && !view.packages.length) { if (onAdd(view, { kind: 'product' })) onClose(); return; }
      setProduct({ view, urls: data.urls });
    } catch (cause) {
      setProblem(errorMessage(cause, 'Nie udało się pobrać produktu.'));
    } finally {
      setLoading(false);
    }
  };
  const thumb = (media: ShowcaseProductView['image']) => (media && product ? product.urls[`${media.source}:${media.path}`]?.thumb || null : null);
  const choose = (choice: Choice) => { if (product && onAdd(product.view, choice)) onClose(); };
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black/70" role="dialog" aria-modal="true" aria-label="Dodaj pozycję">
      <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10" style={{ background: theme.surface, color: TEXT }}>
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          {product && <button type="button" onClick={() => setProduct(null)} aria-label="Wróć do katalogu" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30"><ChevronLeft className="h-5 w-5" /></button>}
          <h3 className="min-w-0 flex-1 truncate text-[19px]">{product ? product.view.name : 'Dodaj pozycję z katalogu'}</h3>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!product ? (
            <div className="space-y-3">
              <span className="relative block">
                <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-[#e5e4e2]/40" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj produktu w katalogu" className={`${inputClass} pl-11`} />
              </span>
              {options.map((option) => (
                <button key={option.id} type="button" onClick={() => void open(option.id)}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-black/20 p-2.5 text-left ring-1 ring-white/10 hover:bg-black/30">
                  {option.thumbnailUrl ? <img src={option.thumbnailUrl} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                    : <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-black/30"><Package className="h-5 w-5 opacity-50" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px]">{option.name}</span>
                    <span className="block truncate text-[13px] text-[#e5e4e2]/50">{[option.category, option.priceNet != null ? `${formatShowcaseAmount(option.priceNet)} netto${option.unit ? ` / ${option.unit}` : ''}` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {product.view.configurable && <p className="rounded-2xl bg-black/25 p-4 text-[15px] text-amber-200">Produkt z konfiguratorem — dodasz go w edytorze oferty po jej utworzeniu.</p>}
              {product.view.packages.length > 0 && <p className="text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Pakiety</p>}
              {product.view.packages.map((pack) => (
                <button key={pack.id} type="button" disabled={product.view.configurable} onClick={() => choose({ kind: 'package', optionId: pack.id })}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-black/20 p-2.5 text-left ring-1 ring-white/10 hover:bg-black/30 disabled:opacity-40">
                  {thumb(pack.image) ? <img src={thumb(pack.image) || ''} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" /> : <span className="h-12 w-16 shrink-0 rounded-lg bg-black/30" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-[16px]">{pack.name}</span>
                    {pack.scope && <span className="block truncate text-[13px] text-[#e5e4e2]/50">{pack.scope}</span>}</span>
                  <span className="shrink-0 text-[15px] tabular-nums" style={{ color: theme.accent }}>{pack.priceOnRequest ? 'wycena indywidualna' : pack.priceNet != null ? formatShowcaseAmount(pack.priceNet) : ''}</span>
                </button>
              ))}
              {product.view.variants.length > 0 && <p className="text-[13px] uppercase tracking-wide text-[#e5e4e2]/50">Warianty</p>}
              {product.view.variants.map((variant) => (
                <button key={variant.id} type="button" disabled={product.view.configurable} onClick={() => choose({ kind: 'variant', optionId: variant.id })}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-black/20 p-2.5 text-left ring-1 ring-white/10 hover:bg-black/30 disabled:opacity-40">
                  {thumb(variant.image) ? <img src={thumb(variant.image) || ''} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" /> : <span className="h-12 w-16 shrink-0 rounded-lg bg-black/30" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-[16px]">{variant.name}{variant.recommended ? ' · polecany' : ''}</span>
                    {variant.shortDescription && <span className="block truncate text-[13px] text-[#e5e4e2]/50">{variant.shortDescription}</span>}</span>
                  <span className="shrink-0 text-[15px] tabular-nums" style={{ color: theme.accent }}>{variant.priceNet != null ? formatShowcaseAmount(variant.priceNet) : ''}</span>
                </button>
              ))}
            </div>
          )}
          {(loading || problem) && <p className="mt-4 flex items-center gap-2 text-[14px] text-[#e5e4e2]/60">{loading ? <><Loader2 className="h-4 w-4 animate-spin" />Wczytuję…</> : problem}</p>}
        </div>
      </div>
    </div>
  );
}

function InquiryOption({ active, title, detail, theme, onClick }: { active: boolean; title: string; detail: string; theme: Theme; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-4 py-2 text-left ring-1"
      style={active ? { background: `${theme.accent}1f`, boxShadow: `inset 0 0 0 2px ${theme.accent}`, color: TEXT } : { background: 'rgba(0,0,0,.2)', color: TEXT, ['--tw-ring-color' as string]: 'rgba(255,255,255,.1)' }}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: active ? theme.accent : 'rgba(255,255,255,.3)' }}>
        {active && <span className="h-2.5 w-2.5 rounded-full" style={{ background: theme.accent }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px]">{title}</span>
        {detail && <span className="block truncate text-[13px] text-[#e5e4e2]/55">{detail}</span>}
      </span>
    </button>
  );
}
