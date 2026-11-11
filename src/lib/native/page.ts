import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Wszystkie wiersze zapytania stronami po 1000 (limit PostgREST); `build` tworzy zapytanie od nowa dla każdej strony. */
export async function allRows<T = Record<string, unknown>>(build: (client: SupabaseClient) => any, client: SupabaseClient, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(client).range(from, from + 999);
    if (error) throw new Error(`${error.code || 'db'}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) return out;
  }
  throw new Error('too_many_rows');
}
