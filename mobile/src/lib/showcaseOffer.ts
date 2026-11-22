import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { showcaseOfferDiscountMode, showcaseOfferSetup } from './showcaseApi';
import {
  addShowcaseOfferLine, emptyShowcaseOfferDraft, normalizeShowcaseOfferDraft, showcaseOfferLineFor, switchShowcaseOfferDiscountMode,
  type ShowcaseOfferAddResult, type ShowcaseOfferDiscountMode, type ShowcaseOfferDraft, type ShowcaseOfferKind, type ShowcaseOfferLine,
  type ShowcaseOfferSetup, type ShowcaseProductView,
} from './showcaseShared';

/*
 * Szkic „Oferty ze spotkania” w aplikacji (koszyk z pokazu i formularz) — wspólny dla karty prezentacji i ekranu oferty,
 * zapisany w pamięci urządzenia osobno dla każdego konta (jak w CRM i na Macu). Ceny, rabat i akceptację liczy serwer.
 * Tryb rabatu (cała oferta / każda pozycja) — zapamiętany w ustawieniach sprzedawcy (`setup.discountMode`): obowiązuje w nowym
 * szkicu i w szkicu bez rabatów; zmiana trybu w ofercie przelicza rabat i zapamiętuje wybór na serwerze.
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

const hasDiscounts = (draft: ShowcaseOfferDraft) => draft.discountPercent > 0 || draft.lines.some((line) => line.discountPercent > 0);

/** Tryb rabatu sprzedawcy w szkicu bez rabatów (zmiana trybu niczego tu nie przelicza). */
function applyPreferredMode(value: ShowcaseOfferSetup) {
  if (current.discountMode === value.discountMode || hasDiscounts(current)) return;
  replace({ ...current, discountMode: value.discountMode }, Boolean(current.updatedAt));
}

/** Szkic zalogowanego pracownika (po zmianie konta — szkic tego konta, nie poprzedniego). */
async function ensureOwner(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user?.id || null;
  const key = user ? `${PREFIX}${user}` : null;
  if (key === owner) return user;
  owner = key;
  setup = null;
  setupOwner = null;
  replace(emptyShowcaseOfferDraft(), false);
  if (key) {
    try {
      const saved = await AsyncStorage.getItem(key);
      if (saved && owner === key) replace(normalizeShowcaseOfferDraft(JSON.parse(saved)), false);
    } catch { /* pusty szkic */ }
  }
  return user;
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
      if (setup && setupOwner === user) { applyPreferredMode(setup); setOfferSetup(setup); return; }
      try {
        const value = await showcaseOfferSetup();
        // Serwer sprzed trybu rabatu (bez `discountMode`) — rabat na całą ofertę.
        const normalized: ShowcaseOfferSetup = { ...value, discountMode: value.discountMode === 'lines' ? 'lines' : 'offer' };
        setup = normalized;
        setupOwner = user;
        applyPreferredMode(normalized);
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

  const reset = useCallback(() => replace(emptyShowcaseOfferDraft(setup?.discountMode)), []);

  /**
   * Zmiana trybu rabatu: przeliczenie szkicu (`switchShowcaseOfferDiscountMode`, `effectivePercent` — rabat łączny z podglądu
   * cen) i zapamiętanie wyboru sprzedawcy na serwerze. Wynik: `false` — wyboru nie udało się zapamiętać (szkic jest zmieniony).
   */
  const setDiscountMode = useCallback(async (mode: ShowcaseOfferDiscountMode, effectivePercent: number | null): Promise<boolean> => {
    replace({ ...switchShowcaseOfferDiscountMode(current, mode, effectivePercent), updatedAt: new Date().toISOString() });
    if (setup) {
      setup = { ...setup, discountMode: mode };
      setOfferSetup(setup);
    }
    try {
      await showcaseOfferDiscountMode(mode);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { draft, setup: offerSetup, canOffer: Boolean(offerSetup?.canOffer), update, add, addLine, replaceLine, has, reset, setDiscountMode };
}
