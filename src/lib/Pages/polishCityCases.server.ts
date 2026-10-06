import 'server-only';
import { cache } from 'react';
import { publicSupabase } from '@/lib/SEO/publicData';
import type { PolishCityCases } from '../polishCityCases';

export const loadCityCasesFromDb = cache(async (): Promise<Record<string, PolishCityCases>> => {
  const { data, error } = await publicSupabase().from('polish_city_cases')
    .select('id, city_key, nominative, genitive, locative, locative_preposition').eq('is_active', true);
  if (error) throw new Error('Nie udało się pobrać odmiany nazw miejscowości.');
  const result: Record<string, PolishCityCases> = {};
  for (const row of data || []) {
    const value: PolishCityCases = { ...row, locative_preposition: row.locative_preposition === 'we' ? 'we' : 'w' };
    result[row.city_key.toLowerCase()] = value;
    result[row.nominative.toLowerCase()] = value;
  }
  return result;
});
