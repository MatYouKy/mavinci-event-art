'use client';

import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { SellerInboxItem } from './inbox';

export type SellerSidebarScope = 'mine' | 'all';
type BadgeSnapshot = {
  count: number;
  items: SellerInboxItem[];
  error: string | null;
  scope: SellerSidebarScope;
  employeeId: string | null;
  canChooseScope: boolean;
  loading: boolean;
};

const empty: BadgeSnapshot = { count: 0, items: [], error: null, scope: 'mine', employeeId: null, canChooseScope: false, loading: true };
let snapshot = empty;
let revision = 0;
let pending: Promise<void> | undefined;
let reloadAgain = false;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();
const publish = (next: BadgeSnapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

export function refreshSellerSidebarBadge(): Promise<void> {
  if (!listeners.size) return Promise.resolve();
  if (pending) { reloadAgain = true; return pending; }
  const current = revision;
  pending = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_seller_sidebar_badge');
      if (current !== revision) return;
      if (error || !Array.isArray(data?.items)) throw error || new Error('Missing unified inbox migration');
      const items = data.items as SellerInboxItem[];
      // Both consumers receive the same snapshot, not independently refreshed
      // counters. Never fall back to the directory's historical pending total.
      if (items.some((item) => !Number.isSafeInteger(Number(item.count)) || Number(item.count) < 0)) throw new Error('Invalid badge count');
      const count = items.reduce((sum, item) => sum + Number(item.count), 0);
      if (!Number.isSafeInteger(count) || count !== Number(data.count)) throw new Error('Inconsistent badge count');
      publish({ count, items, error: null, scope: data.scope === 'all' ? 'all' : 'mine', employeeId: data.employee_id || null,
        canChooseScope: data.can_choose_scope === true, loading: false });
    } catch {
      // Never fall back to the global inbox total or another user's cached count.
      if (current === revision) publish({ ...empty, loading: false,
        error: 'Nie udało się wczytać powiadomień sprzedawców. Odśwież widok; jeśli błąd się powtarza, sprawdź wdrożenie migracji wspólnego licznika.' });
    }
  })().finally(() => {
    pending = undefined;
    if (reloadAgain && listeners.size) { reloadAgain = false; void refreshSellerSidebarBadge(); }
  });
  return pending;
}

export function invalidateSellerSidebarBadge() {
  revision += 1;
  publish(empty);
  void refreshSellerSidebarBadge();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let active = true;
    let authUserId: string | null | undefined;
    const reload = () => { if (document.visibilityState === 'visible') void refreshSellerSidebarBadge(); };
    const timer = window.setInterval(reload, 30000);
    window.addEventListener('focus', reload);
    window.addEventListener('seller-workspace-changed', reload);
    document.addEventListener('visibilitychange', reload);
    const channel = supabase.channel('seller-sidebar-notification-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_recipients' }, reload)
      // Review changes arrive via notification_recipients; reviews themselves are private.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_review_reads' }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seller_messages' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_message_reads' }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employees' }, invalidateSellerSidebarBadge)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts' }, reload)
      .subscribe();
    const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
      if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
      const nextUserId = session?.user.id || null;
      if (authUserId === nextUserId && event !== 'USER_UPDATED') return;
      authUserId = nextUserId;
      revision += 1;
      publish(empty);
      // Supabase auth callbacks hold a lock; defer database requests.
      window.setTimeout(() => { if (active) reload(); }, 0);
    });
    reload();
    stop = () => {
      active = false;
      revision += 1;
      snapshot = empty;
      reloadAgain = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
      window.removeEventListener('seller-workspace-changed', reload);
      document.removeEventListener('visibilitychange', reload);
      void supabase.removeChannel(channel);
      auth.subscription.unsubscribe();
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = undefined; }
  };
}

const noSubscribe = () => () => {};
const getSnapshot = () => snapshot;
const getEmpty = () => empty;

export function useSellerSidebarBadge(enabled = true) {
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? getSnapshot : getEmpty, getEmpty);
}
