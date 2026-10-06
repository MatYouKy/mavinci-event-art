import 'server-only';
import { createHash } from 'node:crypto';
import type { OpenAiAmount, OpenAiTokenTotals, OpenAiUsageReport } from './openAiUsage';

// Configure on the Next.js server, never with a NEXT_PUBLIC_ prefix.
// OPENAI_ADMIN_KEY must belong to the organization used by the CRM's API keys,
// including the keys stored separately in Supabase Edge Function secrets.
// OPENAI_USAGE_PROJECT_IDS optionally restricts BOTH usage and costs (comma-separated).
// Without it, this report explicitly covers the entire OpenAI organization.
export class OpenAiUsageError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type JsonRecord = Record<string, unknown>;
type Bucket = { start: number; results: JsonRecord[] };
type Period = { month: string; start: number; end: number };
const cache = new Map<string, { expiresAt: number; report: Promise<OpenAiUsageReport> }>();
const emptyTokens = (): OpenAiTokenTotals => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 });
const record = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const invalidData = () => new OpenAiUsageError('OpenAI zwróciło niekompletne dane. Spróbuj odświeżyć statystyki później.', 502);

function number(value: unknown, optional = false): number {
  if (value == null && optional) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalidData();
  return value;
}

function periodFor(month: string | null): Period {
  const now = new Date();
  const value = month || now.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new OpenAiUsageError('Wybierz prawidłowy miesiąc.', 400);
  const [year, monthNumber] = value.split('-').map(Number);
  const offset = (now.getUTCFullYear() - year) * 12 + now.getUTCMonth() - (monthNumber - 1);
  if (offset < 0 || offset > 23) throw new OpenAiUsageError('Wybierz jeden z ostatnich 24 miesięcy.', 400);
  const start = Date.UTC(year, monthNumber - 1, 1) / 1000;
  return { month: value, start, end: Math.max(start + 1, Math.min(Date.UTC(year, monthNumber, 1) / 1000, Math.floor(now.getTime() / 1000))) };
}

async function readBuckets(path: 'usage/completions' | 'costs', period: Period, apiKey: string, projectIds: string[]): Promise<Bucket[]> {
  const params = new URLSearchParams({ start_time: String(period.start), end_time: String(period.end), bucket_width: '1d', limit: '31' });
  projectIds.forEach((id) => params.append('project_ids', id));
  if (path === 'usage/completions') params.append('group_by', 'model');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const buckets: Bucket[] = [];
  const cursors = new Set<string>();
  try {
    for (let page = 0; page < 10; page++) {
      const response = await fetch(`https://api.openai.com/v1/organization/${path}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        cache: 'no-store', signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        // Do not forward the upstream body: it can contain organization/key details.
        const message = response.status === 401
          ? 'OpenAI odrzuciło klucz statystyk. Sprawdź serwerowy OPENAI_ADMIN_KEY; zwykły klucz do AI nie wystarczy.'
          : response.status === 403
            ? 'Klucz OpenAI nie ma dostępu do tych statystyk. Sprawdź organizację i uprawnienia klucza administracyjnego.'
            : response.status === 429
              ? 'OpenAI ograniczyło liczbę odczytów statystyk. Spróbuj ponownie za chwilę.'
              : response.status === 400
                ? 'OpenAI nie przyjęło parametrów raportu. Sprawdź konfigurację projektów OPENAI_USAGE_PROJECT_IDS.'
                : 'Statystyki OpenAI są chwilowo niedostępne. Spróbuj ponownie później.';
        throw new OpenAiUsageError(message, 502);
      }
      const payload = record(await response.json());
      if (!Array.isArray(payload.data) || typeof payload.has_more !== 'boolean') throw invalidData();
      for (const value of payload.data) {
        const bucket = record(value);
        if (!Array.isArray(bucket.results)) throw invalidData();
        const start = number(bucket.start_time);
        if (start >= period.start && start < period.end) buckets.push({ start, results: bucket.results.map(record) });
      }
      if (!payload.has_more) return buckets;
      if (typeof payload.next_page !== 'string' || !payload.next_page || cursors.has(payload.next_page)) throw invalidData();
      cursors.add(payload.next_page);
      params.set('page', payload.next_page);
    }
    throw new OpenAiUsageError('Raport OpenAI przekroczył limit stron. Dane częściowe nie zostały pokazane jako pełna suma.', 502);
  } catch (error) {
    if (error instanceof OpenAiUsageError) throw error;
    throw new OpenAiUsageError(controller.signal.aborted
      ? 'Odczyt statystyk OpenAI trwał zbyt długo. Spróbuj ponownie.'
      : 'Nie udało się połączyć ze statystykami OpenAI. Spróbuj ponownie.', 502);
  } finally { clearTimeout(timer); }
}

function addTokens(target: OpenAiTokenTotals, source: OpenAiTokenTotals) {
  for (const key of Object.keys(target) as Array<keyof OpenAiTokenTotals>) target[key] += source[key];
}

function summarizeUsage(buckets: Bucket[]) {
  const totals = emptyTokens();
  const models = new Map<string, OpenAiTokenTotals>();
  const days = new Map<string, OpenAiTokenTotals>();
  for (const bucket of buckets) {
    const date = new Date(bucket.start * 1000).toISOString().slice(0, 10);
    const daily = days.get(date) || emptyTokens();
    for (const row of bucket.results) {
      const inputTokens = number(row.input_tokens), outputTokens = number(row.output_tokens);
      const tokens = { inputTokens, outputTokens, cachedInputTokens: number(row.input_cached_tokens, true), totalTokens: inputTokens + outputTokens, requests: number(row.num_model_requests) };
      // Cached input is already included in input_tokens; do not count it twice.
      const model = typeof row.model === 'string' && row.model ? row.model : 'Model nieokreślony';
      const grouped = models.get(model) || emptyTokens();
      addTokens(totals, tokens); addTokens(daily, tokens); addTokens(grouped, tokens);
      models.set(model, grouped);
    }
    days.set(date, daily);
  }
  return { totals, models: Array.from(models, ([model, values]) => ({ model, ...values })).sort((a, b) => b.totalTokens - a.totalTokens), days };
}

function amounts(values: Map<string, number>): OpenAiAmount[] {
  return Array.from(values, ([currency, value]) => ({ currency, value })).sort((a, b) => a.currency.localeCompare(b.currency));
}

function summarizeCosts(buckets: Bucket[]) {
  const totals = new Map<string, number>();
  const days = new Map<string, OpenAiAmount[]>();
  for (const bucket of buckets) {
    const date = new Date(bucket.start * 1000).toISOString().slice(0, 10);
    const daily = new Map((days.get(date) || []).map((amount) => [amount.currency, amount.value]));
    for (const row of bucket.results) {
      const amount = record(row.amount);
      // Costs may include negative adjustments. Never add different currencies together.
      if (typeof amount.value !== 'number' || !Number.isFinite(amount.value) || typeof amount.currency !== 'string' || !/^[a-z]{3}$/i.test(amount.currency)) throw invalidData();
      const currency = amount.currency.toUpperCase();
      totals.set(currency, (totals.get(currency) || 0) + amount.value);
      daily.set(currency, (daily.get(currency) || 0) + amount.value);
    }
    days.set(date, amounts(daily));
  }
  return { totals: amounts(totals), days };
}

async function fetchReport(base: OpenAiUsageReport, period: Period, apiKey: string): Promise<OpenAiUsageReport> {
  const [usage, costs] = await Promise.allSettled([
    readBuckets('usage/completions', period, apiKey, base.scope.projectIds).then(summarizeUsage),
    readBuckets('costs', period, apiKey, base.scope.projectIds).then(summarizeCosts),
  ]);
  const report = { ...base, fetchedAt: new Date().toISOString() };
  report.status = usage.status === 'fulfilled' && costs.status === 'fulfilled' ? 'ready'
    : usage.status === 'fulfilled' || costs.status === 'fulfilled' ? 'partial' : 'unavailable';
  if (usage.status === 'fulfilled') report.usage = { totals: usage.value.totals, models: usage.value.models };
  else report.warnings.push(`Zużycie tokenów: ${usage.reason instanceof OpenAiUsageError ? usage.reason.message : 'Nie udało się odczytać danych.'}`);
  if (costs.status === 'fulfilled') report.costs = { totals: costs.value.totals };
  else report.warnings.push(`Koszty: ${costs.reason instanceof OpenAiUsageError ? costs.reason.message : 'Nie udało się odczytać danych.'}`);
  const dates = new Set([
    ...(usage.status === 'fulfilled' ? Array.from(usage.value.days.keys()) : []),
    ...(costs.status === 'fulfilled' ? Array.from(costs.value.days.keys()) : []),
  ]);
  report.days = Array.from(dates).sort().reverse().map((date) => ({ date,
    usage: usage.status === 'fulfilled' ? usage.value.days.get(date) || emptyTokens() : null,
    costs: costs.status === 'fulfilled' ? costs.value.days.get(date) || [] : null,
  }));
  return report;
}

// The caller must authenticate and authorize the administrator before every call,
// even when an aggregate report is cached in this server process.
export async function getOpenAiUsageReport(month: string | null): Promise<OpenAiUsageReport> {
  const period = periodFor(month);
  const apiKey = process.env.OPENAI_ADMIN_KEY?.trim();
  const projectIds = [...new Set((process.env.OPENAI_USAGE_PROJECT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean))].sort();
  if (projectIds.length > 20 || projectIds.some((id) => !/^proj_[a-zA-Z0-9_-]+$/.test(id))) throw new OpenAiUsageError('Nieprawidłowa konfiguracja OPENAI_USAGE_PROJECT_IDS na serwerze.', 503);
  const base: OpenAiUsageReport = {
    status: 'not_configured', month: period.month,
    period: { start: new Date(period.start * 1000).toISOString(), end: new Date(period.end * 1000).toISOString() },
    scope: { type: projectIds.length ? 'projects' : 'organization', projectIds },
    fetchedAt: null, usage: null, costs: null, days: [], warnings: [],
  };
  if (!apiKey) return base;
  const cacheKey = createHash('sha256').update(JSON.stringify([apiKey, projectIds, period.month])).digest('hex');
  const entry = cache.get(cacheKey);
  if (entry && entry.expiresAt > Date.now()) return entry.report;
  const report = fetchReport(base, period, apiKey);
  cache.set(cacheKey, { expiresAt: Date.now() + 60_000, report });
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  try {
    const result = await report;
    if (result.status !== 'ready' && cache.get(cacheKey)?.report === report) cache.delete(cacheKey);
    return result;
  } catch (error) {
    if (cache.get(cacheKey)?.report === report) cache.delete(cacheKey);
    throw error;
  }
}
