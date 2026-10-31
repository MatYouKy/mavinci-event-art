'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { OfferAudience } from '@/lib/CRM/Offers/audiencePricing';

export const OFFER_AUDIENCE_SAVED = 'offer-audience-saved';
export function useOfferAudience(offerId?: string) {
  const [audience, setAudience] = useState<OfferAudience>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(offerId));
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!offerId) { setLoading(false); return; }
    setLoading(true); setError(null);
    void (async () => {
      try {
        const { data, error } = await supabase.from('offers').select('guest_count,guests_per_table,table_count').eq('id', offerId).single();
        if (error) throw error;
        if (active) setAudience(data);
      } catch {
        if (active) setError('Nie udało się wczytać liczby uczestników oferty. Spróbuj ponownie.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [offerId, attempt]);
  const saveAudience = async (next: OfferAudience) => {
    if (!offerId || loading || error || lock.current) throw new Error('Poczekaj na wczytanie danych uczestników.');
    const guests = next.guest_count;
    const capacity = next.guests_per_table ?? 10;
    const tables = next.table_count ?? null;
    if ((guests != null && (!Number.isInteger(guests) || guests < 1 || guests > 100000)) || !Number.isInteger(capacity) || capacity < 1 || capacity > 100 || (tables != null && (!Number.isInteger(tables) || tables < 1 || tables > 100000))) {
      throw new Error('Podaj całkowitą liczbę osób i stołów oraz od 1 do 100 osób przy stole.');
    }
    lock.current = true; setSaving(true);
    try {
      let query = supabase.from('offers').update({ guest_count: guests ?? null, guests_per_table: capacity, table_count: tables }).eq('id', offerId);
      // Protect against overwriting participant changes made in another open editor.
      query = audience.guest_count == null ? query.is('guest_count', null) : query.eq('guest_count', audience.guest_count);
      query = audience.table_count == null ? query.is('table_count', null) : query.eq('table_count', audience.table_count);
      query = query.eq('guests_per_table', audience.guests_per_table ?? 10);
      const { data, error: saveError } = await query.select('guest_count,guests_per_table,table_count').maybeSingle();
      if (saveError) throw new Error(saveError.message);
      if (!data) { setAttempt(value => value + 1); throw new Error('Dane uczestników zmieniły się w innym oknie. Wczytuję aktualne wartości; wpisz zmianę ponownie.'); }
      setAudience(data);
      window.dispatchEvent(new CustomEvent(OFFER_AUDIENCE_SAVED, { detail: { offerId, audience: data } }));
      return data;
    } finally { lock.current = false; setSaving(false); }
  };
  return { audience, error, loading, saving, saveAudience, reload: () => setAttempt(value => value + 1) };
}
