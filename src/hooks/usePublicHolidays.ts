'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {
  fetchPublicHolidays,
  indexHolidays,
  type HolidayIndex,
  type PublicHoliday,
} from '@/lib/CRM/calendar/publicHolidays';

// Jedno zapytanie na rok na sesję przeglądarki.
const cache = new Map<number, Promise<PublicHoliday[]>>();

export function loadHolidayYear(year: number): Promise<PublicHoliday[]> {
  if (!cache.has(year)) {
    const request = fetchPublicHolidays(supabase, `${year}-01-01`, `${year}-12-31`).catch((error) => {
      cache.delete(year);
      throw error;
    });
    cache.set(year, request);
  }
  return cache.get(year)!;
}

export function invalidateHolidayCache() {
  cache.clear();
}

/** Dni ustawowo wolne dla lat obejmujących podane daty (z rokiem przed i po — długie weekendy na przełomie lat). */
export function usePublicHolidays(...dates: Array<string | Date | null | undefined>): { holidays: HolidayIndex; loading: boolean } {
  const years = useMemo(() => {
    const set = new Set<number>();
    dates.forEach((value) => {
      if (!value) return;
      const year = typeof value === 'string' ? Number(value.slice(0, 4)) : value.getFullYear();
      if (Number.isFinite(year) && year > 1900) { set.add(year - 1); set.add(year); set.add(year + 1); }
    });
    if (set.size === 0) { const now = new Date().getFullYear(); set.add(now); set.add(now + 1); }
    return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.map((d) => (d ? String(d instanceof Date ? d.getFullYear() : d.slice(0, 4)) : '')).join('|')]);

  const [list, setList] = useState<PublicHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const key = years.join(',');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all(years.map(loadHolidayYear))
      .then((chunks) => { if (active) setList(chunks.flat()); })
      .catch(() => { if (active) setList([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { holidays: useMemo(() => indexHolidays(list), [list]), loading };
}
