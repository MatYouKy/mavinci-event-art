import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Wartości finansowe wydarzenia (budżet, przychód, płatnicy, harmonogram płatności) — ta sama reguła co CRM
 * i baza: public.can_view_event_commercials(p_event_id). Widzi je administrator, osoba z poziomem co najmniej
 * „Podgląd faktur” w działalności wydarzenia, osoba z finances_view / finances_manage przy widocznym wydarzeniu
 * w dostępnej działalności oraz sprzedawca, który utworzył lub sprzedał wydarzenie i ma w tej działalności
 * co najmniej „Własną sprzedaż”. Aplikacja nigdy nie pokazuje więcej niż CRM, więc decyzję podejmuje baza.
 */
export async function fetchEventCommercialsAccess(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_view_event_commercials', { p_event_id: eventId });
  return !error && data === true;
}

/** false do czasu odpowiedzi bazy (także po zmianie wydarzenia lub osoby). */
export function useEventCommercialsAccess(eventId: string | null | undefined, employeeId: string | null | undefined): boolean {
  const key = eventId && employeeId ? `${employeeId}:${eventId}` : '';
  const [state, setState] = useState<{ key: string; allowed: boolean } | null>(null);

  useEffect(() => {
    if (!key || !eventId) return undefined;
    let active = true;
    void fetchEventCommercialsAccess(eventId).then((allowed) => {
      if (active) setState({ key, allowed });
    });
    return () => {
      active = false;
    };
  }, [key, eventId]);

  return Boolean(key && state?.key === key && state.allowed);
}
