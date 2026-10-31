'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { mapOfferCustomerCopy } from '../../supabase/functions/_shared/productTranslation';

type Translation = { ready: boolean; signature: string; memory: Record<string,string>; packages: any[]; requirements: any[] };
export async function requestOfferEnglish(offerId: string, action: 'read' | 'generate', signal?: AbortSignal): Promise<Translation> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('Przekroczono czas oczekiwania na EN. Serwer może nadal kończyć tłumaczenie. Ponów za chwilę — zapisane teksty zostaną wykorzystane.')); controller.abort(); }, action === 'read' ? 45_000 : 180_000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const { data, error } = await supabase.functions.invoke('translate-offer', { body: { offerId, action }, signal: controller.signal });
      let message = data?.error;
      if (error && !message) { try { message = (await error.context?.json())?.error; } catch { /* fallback */ } }
      if (error || message) throw new Error(message || 'Nie udało się przygotować angielskiej treści oferty.');
      if (!data || typeof data.ready !== 'boolean' || !data.memory || !Array.isArray(data.packages) || !Array.isArray(data.requirements)) throw new Error('Nieprawidłowa odpowiedź usługi tłumaczenia.');
      return data;
    })()]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
export function useOfferLanguage(offer: any, enabled: boolean) {
  const [language, setLanguage] = useState<'pl' | 'en'>('pl');
  const [saved, setSaved] = useState<{ key: string; data: Translation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([offer?.id, offer?.content_revision, offer?.updated_at, (offer?.offer_items || []).map((item: any) => [item.product_id, item.product?.english_version, item.product?.translation_revision])]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled || !offer?.id || offer.sales_channel === 'seller_portal') return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError('');
    void (async () => {
      try {
        let data = await requestOfferEnglish(offer.id, 'read', request.signal);
        if (request.signal.aborted) return;
        if (!data.ready) data = await requestOfferEnglish(offer.id, 'generate', request.signal);
        if (!request.signal.aborted) setSaved({ key, data });
      } catch (error) { if (!request.signal.aborted) setError((error as Error).message); }
      finally { if (!request.signal.aborted) setBusy(false); }
    })();
    return () => request.abort();
  }, [key, enabled, attempt]);
  const ready = saved?.key === key && saved.data.ready;
  const effectiveLanguage = language === 'en' && ready ? 'en' : 'pl';
  const switchLanguage = useCallback((value: 'pl' | 'en') => { if (value === 'pl' || ready) setLanguage(value); }, [ready]);
  const displayOffer = useMemo(() => effectiveLanguage === 'en' && saved
    ? mapOfferCustomerCopy({ ...offer, packages: saved.data.packages, resolved_requirements: saved.data.requirements }, text => saved.data.memory[text] || text)
    : offer, [offer, saved, effectiveLanguage]);
  return { language: effectiveLanguage, switchLanguage, ready, busy, error, offer: displayOffer,
    signature: ready ? saved?.data.signature : undefined, prepare: () => setAttempt(value => value + 1) };
}
