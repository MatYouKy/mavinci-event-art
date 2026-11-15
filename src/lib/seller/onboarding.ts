'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { readSellerWelcome, SELLER_WELCOME_CHANGED_EVENT, writeSellerWelcome } from '@/lib/seller/welcome';

/**
 * Przewodnik „Witaj w portalu MAVINCI” — postęp zapisany w bazie (migracja 20261115190000_seller_onboarding_and_demo_join.sql),
 * więc przewodnik nie wraca na innym komputerze, a opiekun widzi w CRM, czy sprzedawca go przeszedł.
 * Bez migracji działa jak dotąd: postęp tylko w tej przeglądarce.
 */

export const SELLER_ONBOARDING_STEPS = ['hotel_checked', 'branding_seen', 'manager_met', 'journey_seen', 'first_step'] as const;
export type SellerOnboardingStep = typeof SELLER_ONBOARDING_STEPS[number];
export type SellerOnboardingFlags = Partial<Record<SellerOnboardingStep | 'completed' | 'dismissed', boolean>> & {
  completed_at?: string;
  dismissed_at?: string;
};
export type SellerOnboardingPatch = Partial<Record<SellerOnboardingStep | 'completed' | 'dismissed', boolean>>;

const missingMigration = (error: { code?: string } | null | undefined) => ['PGRST202', '42883', '42P01'].includes(error?.code || '');

/** Lokalna kopia (starsza lista „Pierwsze kroki” zapisywała tylko dismissed i manager). */
const fromLocal = (partnerId: string): SellerOnboardingFlags => {
  const local = readSellerWelcome(partnerId);
  return { ...(local.onboarding as SellerOnboardingFlags | undefined), ...(local.dismissed ? { dismissed: true } : {}), ...(local.manager ? { manager_met: true } : {}) };
};
const toLocal = (partnerId: string, flags: SellerOnboardingFlags) =>
  writeSellerWelcome(partnerId, { onboarding: flags as Record<string, boolean | string>, dismissed: flags.dismissed === true, manager: flags.manager_met === true });

export async function loadSellerOnboarding(partnerId: string): Promise<{ flags: SellerOnboardingFlags; stored: 'database' | 'browser' }> {
  const { data, error } = await supabase.rpc('get_seller_onboarding');
  if (error) {
    if (missingMigration(error)) return { flags: fromLocal(partnerId), stored: 'browser' };
    throw error;
  }
  const flags = (data && typeof data === 'object' ? data : {}) as SellerOnboardingFlags;
  // Pierwsze wejście po migracji: przenieś to, co sprzedawca odhaczył wcześniej w tej przeglądarce.
  const local = fromLocal(partnerId);
  const carry: SellerOnboardingPatch = {};
  (Object.keys(local) as (keyof SellerOnboardingPatch)[]).forEach((key) => {
    if (local[key] === true && flags[key] !== true && (SELLER_ONBOARDING_STEPS as readonly string[]).concat(['completed', 'dismissed']).includes(key)) carry[key] = true;
  });
  if (Object.keys(carry).length) {
    const merged = await supabase.rpc('update_seller_onboarding', { p_patch: carry });
    if (!merged.error && merged.data) return { flags: merged.data as SellerOnboardingFlags, stored: 'database' };
  }
  return { flags, stored: 'database' };
}

export async function saveSellerOnboarding(partnerId: string, patch: SellerOnboardingPatch, stored: 'database' | 'browser'): Promise<SellerOnboardingFlags> {
  if (stored === 'database') {
    const { data, error } = await supabase.rpc('update_seller_onboarding', { p_patch: patch });
    if (!error) {
      const flags = (data || {}) as SellerOnboardingFlags;
      toLocal(partnerId, flags);
      return flags;
    }
    if (!missingMigration(error)) throw error;
  }
  const next = { ...fromLocal(partnerId), ...patch };
  toLocal(partnerId, next);
  return next;
}

/** Wspólny stan przewodnika i listy „Pierwsze kroki” na pulpicie (synchronizowany zdarzeniem w oknie). */
export function useSellerOnboarding(partnerId: string | null | undefined) {
  const [flags, setFlags] = useState<SellerOnboardingFlags | null>(null);
  const [stored, setStored] = useState<'database' | 'browser'>('database');
  useEffect(() => {
    if (!partnerId) return;
    let active = true;
    loadSellerOnboarding(partnerId)
      .then((result) => { if (active) { setFlags(result.flags); setStored(result.stored); } })
      .catch(() => { if (active) { setFlags(fromLocal(partnerId)); setStored('browser'); } });
    const sync = () => { if (active) setFlags((current) => ({ ...(current || {}), ...fromLocal(partnerId) })); };
    window.addEventListener(SELLER_WELCOME_CHANGED_EVENT, sync);
    return () => { active = false; window.removeEventListener(SELLER_WELCOME_CHANGED_EVENT, sync); };
  }, [partnerId]);
  const update = useCallback(async (patch: SellerOnboardingPatch) => {
    if (!partnerId) return null;
    // Od razu w interfejsie; zapis w tle (błąd zapisu nie blokuje pracy w portalu).
    setFlags((current) => ({ ...(current || {}), ...patch }));
    try {
      const next = await saveSellerOnboarding(partnerId, patch, stored);
      setFlags(next);
      return next;
    } catch {
      toLocal(partnerId, { ...fromLocal(partnerId), ...patch });
      return null;
    }
  }, [partnerId, stored]);
  return { flags, update, ready: flags !== null };
}

/** Odhaczenie kroku poza przewodnikiem (np. kontakt z opiekunem z karty „Twój opiekun” albo wejście w Wiadomości). */
export function markSellerOnboarding(partnerId: string, patch: SellerOnboardingPatch) {
  const local = fromLocal(partnerId);
  if ((Object.keys(patch) as (keyof SellerOnboardingPatch)[]).every((key) => local[key] === patch[key])) return Promise.resolve(local);
  return saveSellerOnboarding(partnerId, patch, 'database').catch((): SellerOnboardingFlags => {
    const next = { ...local, ...patch };
    toLocal(partnerId, next);
    return next;
  });
}

/** Kiedy przewodnik otwiera się sam: dopiero raz w sesji przeglądarki i tylko gdy nie został ukończony ani odłożony na zawsze. */
export const SELLER_GUIDE_SESSION_KEY = 'mavinci-seller-guide-shown';
export const SELLER_GUIDE_OPEN_EVENT = 'seller-guide-open';
export const openSellerGuide = () => window.dispatchEvent(new Event(SELLER_GUIDE_OPEN_EVENT));
