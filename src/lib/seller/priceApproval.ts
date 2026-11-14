'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

/**
 * Zgoda na cenę przed pokazaniem oferty klientowi (migracja 20261114230000_seller_price_approval_and_auto_review.sql).
 * Pozycja własna albo cena poniżej stawki → offers.partner_approval_status = 'required'. Kreator sam prosi opiekuna o zgodę;
 * do zgody link dla klienta i pobranie PDF dla klienta są wstrzymane. Zgoda trzyma się tych samych pozycji i cen.
 */

export type SellerPriceItem = {
  name: string;
  custom: boolean;
  unit: string;
  quantity: number;
  days: number;
  /** Cena z cennika MAVINCI; null dla pozycji własnej. */
  base_price: number | null;
  client_price: number;
};

export type SellerPriceRequestStatus = 'pending' | 'approved' | 'changes_requested' | 'superseded';

export type SellerPriceRequest = {
  id: string;
  status: SellerPriceRequestStatus;
  note: string;
  requested_at: string;
  response_note: string;
  decided_at: string | null;
  decided_by_name: string | null;
  /** Prośba dotyczy obecnych cen (sprzedawca nie zmienił ich od tamtej pory). */
  current: boolean;
};

export type SellerPriceApproval = {
  /** offers.partner_approval_status: not_required | required | approved | changes_requested | rejected. */
  status: string;
  price_key: string | null;
  can_decide: boolean;
  items: SellerPriceItem[];
  request: SellerPriceRequest | null;
};

export const PRICE_APPROVAL_MIGRATION = '20261114230000_seller_price_approval_and_auto_review.sql';

export function sellerPriceApprovalError(cause: unknown, fallback: string) {
  const error = cause as { code?: string; message?: string } | null;
  if (['PGRST202', '42883', '42P01'].includes(error?.code || '')) return `Zgoda na cenę wymaga migracji ${PRICE_APPROVAL_MIGRATION}.`;
  return error?.message || fallback;
}

/** Na osi: czy czeka na opiekuna, czy opiekun prosi o zmianę, czy trzeba dopiero poprosić. */
export function sellerPriceRequestStage(approval: Pick<SellerPriceApproval, 'status' | 'request'> | null | undefined): 'pending' | 'changes_requested' | 'missing' | null {
  if (!approval || approval.status !== 'required') return null;
  const request = approval.request;
  if (request?.status === 'pending') return 'pending';
  if (request?.status === 'changes_requested') return 'changes_requested';
  return 'missing';
}

export async function loadSellerPriceApproval(offerId: string): Promise<SellerPriceApproval> {
  const { data, error } = await supabase.rpc('get_seller_offer_price_approval', { p_offer: offerId });
  if (error) throw error;
  const raw = (data || {}) as Partial<SellerPriceApproval>;
  return {
    status: String(raw.status || 'not_required'),
    price_key: raw.price_key || null,
    can_decide: raw.can_decide === true,
    items: Array.isArray(raw.items) ? raw.items.map((item) => ({
      name: String(item.name || 'Pozycja'), custom: item.custom === true, unit: String(item.unit || 'szt.'),
      quantity: Number(item.quantity || 0), days: Number(item.days || 1),
      base_price: item.base_price == null ? null : Number(item.base_price), client_price: Number(item.client_price || 0),
    })) : [],
    request: raw.request ? { ...raw.request, note: raw.request.note || '', response_note: raw.request.response_note || '' } : null,
  };
}

/** Sprzedawca: prośba o zgodę (bez skutku, gdy zgoda nie jest potrzebna albo prośba o te same ceny już czeka). */
export async function requestSellerPriceApproval(offerId: string, note = '') {
  const { data, error } = await supabase.rpc('request_seller_offer_price_approval', { p_offer: offerId, p_note: note });
  if (error) throw error;
  return (data || {}) as { status: string; request_id?: string; request_status?: string; created?: boolean };
}

/** Opiekun: zgoda albo prośba o zmianę dla cen, które widział (expectedKey). */
export async function decideSellerPriceApproval(offerId: string, decision: 'approved' | 'changes_requested', note: string, expectedKey: string | null) {
  const { data, error } = await supabase.rpc('decide_seller_offer_price_approval', {
    p_offer: offerId, p_decision: decision, p_note: note, p_expected_key: expectedKey,
  });
  if (error) throw error;
  return (data || {}) as { status: string; request_id?: string; request_status?: string };
}

/** Stan zgody na cenę z odświeżaniem (po powrocie do karty i co minutę, gdy czeka na opiekuna). */
export function useSellerPriceApproval(offerId: string, enabled: boolean, refreshKey: unknown = 0) {
  const [approval, setApproval] = useState<SellerPriceApproval | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    const current = ++sequence.current;
    try {
      const next = await loadSellerPriceApproval(offerId);
      if (current === sequence.current) { setApproval(next); setError(''); }
      return next;
    } catch (cause) {
      if (current !== sequence.current) return null;
      // Pracownik bez roli opiekuna tego sprzedawcy: sekcja zgody po prostu się nie pokazuje.
      if ((cause as { code?: string } | null)?.code === '42501') { setApproval(null); setError(''); }
      else setError(sellerPriceApprovalError(cause, 'Nie udało się sprawdzić zgody na cenę.'));
      return null;
    }
  }, [enabled, offerId]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [enabled, reload]);
  return { approval, error, reload };
}
