import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { PolishCityCases } from '../polishCityCases';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CityCaseRow = {
  city_key: string;
  nominative: string;
  genitive: string;
  locative: string;
  is_active: boolean;
  locative_preposition?: 'w' | 'we';
};

export async function loadCityCasesFromDb(): Promise<Record<string, PolishCityCases>> {
  const { data, error } = await supabase
    .from('polish_city_cases')
    .select('city_key, nominative, genitive, locative, locative_preposition, is_active')
    .eq('is_active', true);

  if (error) {
    console.error('[loadCityCasesFromDb]', error);
    return {};
  }

  const result: Record<string, PolishCityCases> = {};

  for (const row of (data || []) as CityCaseRow[]) {
    result[row.city_key] = {
      nominative: row.nominative,
      genitive: row.genitive,
      locative: row.locative,
      locative_preposition: row.locative_preposition,
    };
  }

  return result;
}