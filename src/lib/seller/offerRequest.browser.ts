'use client';

import { supabase } from '@/lib/supabase/browser';

export async function sellerOfferRequest(offerId: string, payload?: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  const response = await fetch(`/bridge/seller/offers/${offerId}`, {
    method: payload ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(payload?.action === 'document' ? 210000 : 45000),
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Nie udało się wykonać operacji. Spróbuj ponownie.');
  }
  return payload?.action === 'document' ? response.blob() : response.json();
}
