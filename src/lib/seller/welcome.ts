'use client';

/** Per-browser state of the first-login checklist (a convenience, never authoritative). */
export type SellerWelcomeFlags = { dismissed?: boolean; manager?: boolean };
export const SELLER_WELCOME_CHANGED_EVENT = 'seller-welcome-changed';
const storageKey = (partnerId: string) => `mavinci-seller-welcome:${partnerId}`;

export function readSellerWelcome(partnerId: string): SellerWelcomeFlags {
  try { return JSON.parse(window.localStorage.getItem(storageKey(partnerId)) || '{}') as SellerWelcomeFlags; } catch { return {}; }
}

export function writeSellerWelcome(partnerId: string, patch: SellerWelcomeFlags): SellerWelcomeFlags {
  const next = { ...readSellerWelcome(partnerId), ...patch };
  try { window.localStorage.setItem(storageKey(partnerId), JSON.stringify(next)); } catch { /* Private mode or blocked storage. */ }
  window.dispatchEvent(new Event(SELLER_WELCOME_CHANGED_EVENT));
  return next;
}
