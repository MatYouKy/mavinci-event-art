import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { showcaseOfferDiscountDisplay, showcaseOfferSetup } from './showcaseApi';
import {
  addShowcaseOfferLine, emptyShowcaseOfferDraft, isShowcaseOfferDiscountDisplay, normalizeShowcaseOfferDraft, showcaseOfferLineFor,
  type ShowcaseOfferAddResult, type ShowcaseOfferDiscountDisplay, type ShowcaseOfferDraft, type ShowcaseOfferKind, type ShowcaseOfferLine,
  type ShowcaseOfferSetup, type ShowcaseProductView,
} from './showcaseShared';

/*
 * Szkic „Oferty ze spotkania” w aplikacji (koszyk z pokazu i formularz) — wspólny dla karty prezentacji i ekranu oferty,
 * zapisany w pamięci urządzenia osobno dla każdego konta (jak w CRM i na Macu). Ceny, rabat i akceptację liczy serwer.
 * Rabat pozycji i rabat całej oferty działają razem; jak klient widzi rabat w PDF — zapamiętane w ustawieniach sprzedawcy
 * (`setup.discountDisplay`): obowiązuje w nowym szkicu, a zmiana w ofercie zapamiętuje wybór na serwerze.
 */

export type ShowcaseOfferChoice = { kind: ShowcaseOfferKind; optionId?: string | null } | null;
type Listener = (draft: ShowcaseOfferDraft) => void;

const PREFIX = 'mavinci.showcase.offer.';
let current: ShowcaseOfferDraft = emptyShowcaseOfferDraft();
let owner: string | null = null;
let setup: ShowcaseOfferSetup | null = null;
let setupOwner: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener(current));
}

function persist() {
  if (timer) clearTimeout(timer);
  const key = owner;
  if (!key) return;
  const snapshot = JSON.stringify(current);
  timer = setTimeout(() => { void AsyncStorage.setItem(key, snapshot).catch(() => undefined); }, 300);
}

function replace(next: ShowcaseOfferDraft, save = true) {
  current = next;
  emit();
  if (save) persist();
}

/** Sposób pokazania rabatu z ustawień sprzedawcy — w szkicu jeszcze nieruszanym. */
function applyPreferredDisplay(value: ShowcaseOfferSetup) {
  if (current.updatedAt || current.discountDisplay === value.discountDisplay) return;
  replace({ ...current, discountDisplay: value.discountDisplay }, false);
}

/** Wczytywanie zapisanego szkicu konta — kolejne wywołania czekają na jego koniec (bez nadpisania świeżych zmian). */
let ownerLoad: Promise<void> | null = null;

/** Szkic zalogowanego pracownika (po zmianie konta — szkic tego konta, nie poprzedniego). */
async function ensureOwner(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user?.id || null;
  const key = user ? `${PREFIX}${user}` : null;
  if (key === owner) {
    if (ownerLoad) await ownerLoad;
    return user;
  }
  owner = key;
  setup = null;
  setupOwner = null;
  replace(emptyShowcaseOfferDraft(), false);
  const load = (async () => {
    if (!key) return;
    try {
      const saved = await AsyncStorage.getItem(key);
      if (saved && owner === key) replace(normalizeShowcaseOfferDraft(JSON.parse(saved)), false);
    } catch { /* pusty szkic */ }
  })();
  ownerLoad = load;
  await load;
  if (ownerLoad === load) ownerLoad = null;
  return user;
}

/**
 * Oferta do zapytania z karty zapytania (tablet): klient i zapytanie w szkicu — dopiero po wczytaniu szkicu tego konta, żeby
 * zapisany szkic nie nadpisał wyboru. Pozycje, rabaty i sposób pokazania rabatu zostają.
 */
export async function presetShowcaseOfferDraft(change: (draft: ShowcaseOfferDraft) => ShowcaseOfferDraft) {
  await ensureOwner();
  replace({ ...change(current), updatedAt: new Date().toISOString() });
}

export function useShowcaseOffer() {
  const [draft, setDraft] = useState<ShowcaseOfferDraft>(current);
  const [offerSetup, setOfferSetup] = useState<ShowcaseOfferSetup | null>(setup);

  useEffect(() => {
    let active = true;
    const listener: Listener = (next) => { if (active) setDraft(next); };
    listeners.add(listener);
    void ensureOwner().then(async (user) => {
      if (!active) return;
      setDraft(current);
      if (!user) return;
      if (setup && setupOwner === user) { applyPreferredDisplay(setup); setOfferSetup(setup); return; }
      try {
        const value = await showcaseOfferSetup();
        // Serwer bez tego ustawienia — rabat przy pozycjach.
        const normalized: ShowcaseOfferSetup = { ...value, discountDisplay: isShowcaseOfferDiscountDisplay(value.discountDisplay) ? value.discountDisplay : 'lines' };
        setup = normalized;
        setupOwner = user;
        applyPreferredDisplay(normalized);
        if (active) setOfferSetup(normalized);
      } catch { /* bez ofert z pokazu (brak migracji albo uprawnień) */ }
    });
    return () => { active = false; listeners.delete(listener); };
  }, []);

  const update = useCallback((change: (draft: ShowcaseOfferDraft) => ShowcaseOfferDraft) => {
    replace({ ...change(current), updatedAt: new Date().toISOString() });
  }, []);

  const add = useCallback((product: ShowcaseProductView, choice: ShowcaseOfferChoice, item: { id: string; title: string } | null):
    { result: ShowcaseOfferAddResult['result'] | 'unavailable'; label: string } => {
    const line = showcaseOfferLineFor(product, choice, item);
    if (!line) return { result: 'unavailable', label: product.name };
    const outcome = addShowcaseOfferLine(current, line, new Date().toISOString());
    if (outcome.result === 'added') replace(outcome.draft);
    return { result: outcome.result, label: line.label };
  }, []);

  /** Gotowa pozycja (np. z konfiguratora sceny i ekranu LED). */
  const addLine = useCallback((line: ShowcaseOfferLine): ShowcaseOfferAddResult['result'] => {
    const outcome = addShowcaseOfferLine(current, line, new Date().toISOString());
    if (outcome.result === 'added') replace(outcome.draft);
    return outcome.result;
  }, []);

  /**
   * Edycja pozycji: inny wariant, pakiet albo konfiguracja — w tym samym miejscu listy, z dotychczasową ilością, dniami i rabatem.
   * `exists` — taka pozycja jest już w ofercie (np. ten sam wariant), `missing` — pozycji nie ma (usunięta w międzyczasie).
   */
  const replaceLine = useCallback((key: string, line: ShowcaseOfferLine): 'replaced' | 'exists' | 'missing' => {
    const index = current.lines.findIndex((entry) => entry.key === key);
    if (index < 0) return 'missing';
    if (line.key !== key && current.lines.some((entry) => entry.key === line.key)) return 'exists';
    const previous = current.lines[index];
    const lines = [...current.lines];
    lines[index] = {
      ...line, quantity: previous.quantity, days: previous.days, discountPercent: previous.discountPercent,
      itemId: line.itemId || previous.itemId, itemTitle: line.itemTitle || previous.itemTitle,
    };
    replace({ ...current, lines, updatedAt: new Date().toISOString() });
    return 'replaced';
  }, []);

  const has = useCallback((product: ShowcaseProductView, choice: ShowcaseOfferChoice) => {
    const line = showcaseOfferLineFor(product, choice, null);
    return Boolean(line && draft.lines.some((entry) => entry.key === line.key));
  }, [draft.lines]);

  const reset = useCallback(() => replace(emptyShowcaseOfferDraft(setup?.discountDisplay)), []);

  /**
   * Jak klient widzi rabat w PDF: zmiana w szkicu i zapamiętanie wyboru sprzedawcy na serwerze (kolejne oferty).
   * Wynik: `false` — wyboru nie udało się zapamiętać (szkic jest zmieniony).
   */
  const setDiscountDisplay = useCallback(async (display: ShowcaseOfferDiscountDisplay): Promise<boolean> => {
    replace({ ...current, discountDisplay: display, updatedAt: new Date().toISOString() });
    if (setup) {
      setup = { ...setup, discountDisplay: display };
      setOfferSetup(setup);
    }
    try {
      await showcaseOfferDiscountDisplay(display);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { draft, setup: offerSetup, canOffer: Boolean(offerSetup?.canOffer), update, add, addLine, replaceLine, has, reset, setDiscountDisplay };
}
