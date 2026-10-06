'use client';

import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { refreshSellerSidebarBadge } from './sidebarBadge';

export type SellerInboxItem = {
  id: string;
  kind: 'review' | 'message' | 'notification';
  sales_partner_id: string;
  title: string;
  count: number;
  created_at: string;
  action_url: string;
  recipient_id: string | null;
  conversation_id: string | null;
  offer_id: string | null;
  document_id?: string;
  read_token?: string;
};

type Snapshot = { items: SellerInboxItem[]; loading: boolean; error: string | null };
const empty: Snapshot = { items: [], loading: true, error: null };
let snapshot = empty;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
let revision = 0;
let pending: Promise<void> | undefined;
let reloadAgain = false;

const publish = (next: Snapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

export function refreshSellerInbox(): Promise<void> {
  if (pending) {
    reloadAgain = true;
    return pending;
  }
  const current = revision;
  pending = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_seller_inbox');
      if (current !== revision) return;
      if (error) throw error;
      publish({ items: data || [], loading: false, error: null });
    } catch {
      if (current === revision) publish({ ...snapshot, loading: false, error: 'Nie udało się wczytać spraw sprzedawców. Spróbuj odświeżyć.' });
    }
  })().finally(() => {
    pending = undefined;
    if (reloadAgain && listeners.size) {
      reloadAgain = false;
      void refreshSellerInbox();
    }
  });
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const reload = () => { if (document.visibilityState === 'visible') void refreshSellerInbox(); };
    const timer = window.setInterval(reload, 30000);
    window.addEventListener('seller-workspace-changed', reload);
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    const channel = supabase.channel('seller-inbox-shared')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_recipients' }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seller_messages' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_message_reads' }, reload)
      .subscribe();
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        revision += 1;
        publish(empty);
        // Do not make auth/RPC calls inside Supabase's auth callback lock.
        window.setTimeout(reload, 0);
      }
    });
    reload();
    stop = () => {
      revision += 1;
      snapshot = empty;
      reloadAgain = false;
      window.clearInterval(timer);
      window.removeEventListener('seller-workspace-changed', reload);
      window.removeEventListener('focus', reload);
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

export function useSellerInbox(enabled = true) {
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? getSnapshot : getEmpty, getEmpty);
}

export function sellerInboxCounts(items: SellerInboxItem[], partnerId?: string) {
  const rows = partnerId ? items.filter((item) => item.sales_partner_id === partnerId) : items;
  const count = (kind: SellerInboxItem['kind']) => rows.filter((item) => item.kind === kind).reduce((sum, item) => sum + Number(item.count), 0);
  const reviews = count('review'), messages = count('message'), notices = count('notification');
  const realizations = rows.filter(isSellerRealizationNotice).reduce((sum, item) => sum + Number(item.count), 0);
  return { reviews, messages, notices, realizations, total: reviews + messages + notices };
}

export function isSellerRealizationNotice(item: SellerInboxItem) {
  return item.kind === 'notification' && item.action_url?.startsWith('/seller/realizations/');
}

export async function readSellerNotice(item: SellerInboxItem, refreshShared = true) {
  if (item.kind === 'review' && item.offer_id && item.read_token) {
    const { error, data } = await supabase.rpc('mark_seller_review_read', {
      p_offer: item.offer_id, p_read_token: item.read_token,
    });
    if (error || data !== true) return false;
  } else if (item.recipient_id) {
    const { error } = await supabase.from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() }).eq('id', item.recipient_id);
    if (error) return false;
  } else {
    // Messages are read by the visible conversation, through the last displayed
    // message. Opening a seller profile must not clear an entire conversation.
    return false;
  }
  if (refreshShared) void refreshSellerInbox();
  await refreshSellerSidebarBadge();
  return true;
}
