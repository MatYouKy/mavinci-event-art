import { PolishCityCases } from '../polishCityCases';
import { supabase } from '../supabase';

export async function loadCityCasesMap() {
  const { data, error } = await supabase
    .from('polish_city_cases')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error(error);
    return {};
  }

  const map: Record<string, PolishCityCases> = {};

  data.forEach((row) => {
    map[row.slug] = {
      id: row.id,
      city_key: row.city_key,
      nominative: row.nominative,
      genitive: row.genitive,
      locative: row.locative,
      locative_preposition: row.locative_preposition,
    };
  });

  return map;
}