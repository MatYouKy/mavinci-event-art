import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { showcaseOfferSetup } from './showcaseApi';
import {
  addShowcaseOfferLine, emptyShowcaseOfferDraft, normalizeShowcaseOfferDraft, showcaseOfferLineFor,
  type ShowcaseOfferAddResult, type ShowcaseOfferDraft, type ShowcaseOfferKind, type ShowcaseOfferSetup, type ShowcaseProductView,
} from './showcaseShared';

/*
 * Szkic „Oferty ze spotkania” w aplikacji (koszyk z pokazu i formularz) — wspólny dla karty prezentacji i ekranu oferty,
 * zapisany w pamięci urządzenia osobno dla każdego konta (jak w CRM i na Macu). Ceny, rabat i akceptację liczy serwer.
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
      if (setup && setupOwner === user) { setOfferSetup(setup); return; }
      try {
        const value = await showcaseOfferSetup();
        setup = value;
        setupOwner = user;
        if (active) setOfferSetup(value);
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

  const has = useCallback((product: ShowcaseProductView, choice: ShowcaseOfferChoice) => {
    const line = showcaseOfferLineFor(product, choice, null);
    return Boolean(line && draft.lines.some((entry) => entry.key === line.key));
  }, [draft.lines]);

  const reset = useCallback(() => replace(emptyShowcaseOfferDraft()), []);

  return { draft, setup: offerSetup, canOffer: Boolean(offerSetup?.canOffer), update, add, has, reset };
}
