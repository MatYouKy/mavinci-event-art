import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchPublicHolidays, indexHolidays, type HolidayIndex, type PublicHoliday } from '../lib/publicHolidays';

// Jedno zapytanie na rok na uruchomienie aplikacji (jak w CRM: src/hooks/usePublicHolidays.ts).
const cache = new Map<number, Promise<PublicHoliday[]>>();

function loadHolidayYear(year: number): Promise<PublicHoliday[]> {
  if (!cache.has(year)) {
    const request = fetchPublicHolidays(supabase, `${year}-01-01`, `${year}-12-31`).catch((error) => {
      cache.delete(year);
      throw error;
    });
    cache.set(year, request);
  }
  return cache.get(year)!;
}

/** Dni ustawowo wolne dla lat obejmujących podane daty (RRRR-MM-DD), z rokiem przed i po. */
export function usePublicHolidays(...dates: Array<string | null | undefined>): HolidayIndex {
  const key = dates.map((d) => (d ? d.slice(0, 4) : '')).join('|');
  const years = useMemo(() => {
    const set = new Set<number>();
    dates.forEach((value) => {
      const year = value ? Number(value.slice(0, 4)) : NaN;
      if (Number.isFinite(year) && year > 1900) { set.add(year - 1); set.add(year); set.add(year + 1); }
    });
    if (set.size === 0) { const now = new Date().getFullYear(); set.add(now); set.add(now + 1); }
    return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [list, setList] = useState<PublicHoliday[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all(years.map(loadHolidayYear))
      .then((chunks) => { if (active) setList(chunks.flat()); })
      .catch(() => { if (active) setList([]); });
    return () => { active = false; };
  }, [years]);

  return useMemo(() => indexHolidays(list), [list]);
}
