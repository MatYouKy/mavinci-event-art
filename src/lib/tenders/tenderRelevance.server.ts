import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Ocena trafności przetargów (0–100) według aktywnej konfiguracji filtrów — „Przelicz przetargi” w CRM, na Macu i telefonie
 * (`/bridge/native/v1/tenders` op=recalculate oraz `/bridge/tenders/recalculate`). Algorytm bez zmian względem dotychczasowego
 * przeliczenia w CRM. Przeliczenie czyta wszystkie przetargi stronami po 1000 (wcześniej PostgREST oddawał najwyżej 1000
 * wierszy) i zapisuje tylko przetargi, których ocena albo dopasowanie się zmieniły — bez tysięcy zbędnych zapisów i bez
 * ponownej synchronizacji całej listy w aplikacjach. Wywołujący sprawdza uprawnienia (administrator) i podaje klienta serwisowego.
 */

export type TenderRelevanceRecord = {
  id: string;
  title: string | null;
  description: string | null;
  contracting_authority: string | null;
  cpv_codes: string[] | null;
  submission_deadline: string | null;
};

export type TenderRelevanceConfig = {
  positive_keywords: string[] | null;
  negative_keywords: string[] | null;
  cpv_codes: string[] | null;
  min_relevance_score: number;
};

export function calculateTenderRelevance(tender: TenderRelevanceRecord, config: TenderRelevanceConfig, now = new Date()): number {
  let score = 0;

  const textToSearch = `
    ${tender.title || ''}
    ${tender.description || ''}
    ${tender.contracting_authority || ''}
  `.toLowerCase();

  const cpvCodes = tender.cpv_codes || [];

  const hardNegativeCpvPrefixes = ['45'];
  const hasHardNegativeCpv = cpvCodes.some((cpv) =>
    hardNegativeCpvPrefixes.some((prefix) => cpv.replace('-', '').startsWith(prefix)),
  );
  if (hasHardNegativeCpv) score -= 50;

  for (const keyword of config.positive_keywords || []) {
    if (textToSearch.includes(keyword.toLowerCase())) score += 15;
  }

  for (const keyword of config.negative_keywords || []) {
    if (textToSearch.includes(keyword.toLowerCase())) score -= 25;
  }

  for (const cpv of cpvCodes) {
    const cpvBase = cpv.split('-')[0];
    for (const targetCpv of config.cpv_codes || []) {
      const targetBase = targetCpv.split('-')[0];
      if (cpvBase === targetBase) score += 35;
      else if (cpvBase.substring(0, 4) === targetBase.substring(0, 4)) score += 15;
    }
  }

  if (tender.submission_deadline) {
    const deadline = new Date(tender.submission_deadline);
    const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) score -= 100;
    if (daysLeft >= 0 && daysLeft <= 7) score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

export type TenderRecalculation =
  | { ok: true; checked: number; updated: number; configName: string }
  | { ok: false; status: number; error: string };

const PAGE = 1000;
const PARALLEL = 8;

type StoredTender = TenderRelevanceRecord & { relevance_score: number | null; is_matched: boolean | null };

/** Przelicza ocenę i dopasowanie wszystkich przetargów według aktywnej konfiguracji (najpóźniej zmienionej, gdy jest ich kilka). */
export async function recalculateTenderRelevance(admin: SupabaseClient): Promise<TenderRecalculation> {
  const { data: config, error: configError } = await admin
    .from('tender_filter_config')
    .select('name, positive_keywords, negative_keywords, cpv_codes, min_relevance_score')
    .eq('is_active', true)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (configError) return { ok: false, status: 500, error: 'Nie udało się wczytać konfiguracji filtrów.' };
  if (!config) return { ok: false, status: 400, error: 'Brak aktywnej konfiguracji — zaznacz „Konfiguracja aktywna” i zapisz konfigurację.' };

  const rules = config as TenderRelevanceConfig & { name: string | null };
  const tenders: StoredTender[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('tenders')
      .select('id, title, description, contracting_authority, cpv_codes, submission_deadline, relevance_score, is_matched')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, status: 500, error: 'Nie udało się wczytać przetargów.' };
    tenders.push(...((data || []) as StoredTender[]));
    if (!data || data.length < PAGE) break;
  }

  const now = new Date();
  const stamp = now.toISOString();
  const changes = tenders.flatMap((tender) => {
    const score = calculateTenderRelevance(tender, rules, now);
    const matched = score >= Number(rules.min_relevance_score ?? 0);
    const unchanged = tender.relevance_score !== null && Number(tender.relevance_score) === score && Boolean(tender.is_matched) === matched;
    return unchanged ? [] : [{ id: tender.id, score, matched }];
  });

  const progress = { next: 0, failure: null as string | null };
  const worker = async () => {
    while (!progress.failure && progress.next < changes.length) {
      const change = changes[progress.next];
      progress.next += 1;
      const { error } = await admin
        .from('tenders')
        .update({ relevance_score: change.score, is_matched: change.matched, updated_at: stamp })
        .eq('id', change.id);
      if (error) progress.failure = error.message;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, changes.length) }, worker));
  if (progress.failure) {
    console.error('[tender-recalculate]', progress.failure);
    return { ok: false, status: 500, error: 'Nie udało się zapisać części ocen. Spróbuj przeliczyć ponownie.' };
  }

  return { ok: true, checked: tenders.length, updated: changes.length, configName: String(rules.name || '') };
}
