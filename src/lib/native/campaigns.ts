import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { allRows } from './page';

/*
 * Kampanie e-mail na Macu (`/crm/campaigns`, `CampaignsPageClient` + `CampaignDemoReport`): lista kampanii, edycja wersji
 * roboczej, segmenty i reguły odbiorców, przeliczenie i podgląd kwalifikacji, wysyłka testowa, przekazanie do zatwierdzenia,
 * zatwierdzenie, zaplanowanie kontrolowanej kolejki, wstrzymanie, wznowienie i anulowanie oraz statystyki demo kampanii
 * z broszury. Tokenem pracownika — RLS (`can_view_marketing_campaigns`, `can_manage_marketing_campaigns`), funkcje bazy
 * i wyzwalacz `prepare_mailing_campaign_write` (dozwolone zmiany statusu, blokada treści po zatwierdzeniu) jak w przeglądarce.
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const ENTITY_TYPES = ['contact', 'organization'] as const;
const INTERVALS = [60, 120, 300, 600];
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => text(item).trim()).filter(Boolean) : []);

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
/** Komunikaty funkcji bazy (RAISE EXCEPTION) przekazujemy jak CRM (snackbar z `error.message`); brak uprawnień — po polsku. */
function check(error: { message?: string; code?: string } | null | undefined, message: string) {
  if (!error) return;
  if (error.code === '42501') fail('Nie masz uprawnień do tej operacji w Centrum Kampanii.', 403);
  fail(error.message || message);
}

/** Uprawnienia jak w `CampaignsPageClient` (`canView`, `canManage`, `canApprove`). */
export function campaignsAccess(ctx: NativeContext) {
  const { employee } = ctx;
  return {
    canView: employee.isAdmin || ['marketing_campaigns_view', 'marketing_campaigns_manage', 'marketing_campaigns_approve']
      .some((scope) => employee.permissions.includes(scope)),
    canManage: can(employee, 'marketing_campaigns_manage'),
    canApprove: can(employee, 'marketing_campaigns_approve'),
  };
}
function requireView(ctx: NativeContext) {
  if (!campaignsAccess(ctx).canView) fail('Nie masz uprawnień do Centrum Kampanii.', 403);
}
function requireManage(ctx: NativeContext) {
  if (!campaignsAccess(ctx).canManage) fail('Nie masz uprawnień do zarządzania kampaniami.', 403);
}

function campaignItem(row: Row) {
  const rules = isObject(row.audience_rules) ? row.audience_rules : {};
  return {
    id: text(row.id), name: text(row.name), subject: text(row.subject), content: text(row.content), previewText: text(row.preview_text),
    status: text(row.status) || 'draft', emailAccountId: text(row.email_account_id), templateId: text(row.template_id),
    segmentIds: list(row.segment_ids),
    audience: {
      entityTypes: list(rules.entity_types).filter((item) => (ENTITY_TYPES as readonly string[]).includes(item)),
      eventTypes: list(rules.event_types),
      regions: list(rules.regions),
      budgetMin: Number(rules.budget_min) > 0 ? Number(rules.budget_min) : null,
      budgetMax: Number(rules.budget_max) > 0 ? Number(rules.budget_max) : null,
    },
    eligibleCount: count(row.eligible_count), excludedCount: count(row.excluded_count), sentCount: count(row.sent_count),
    failedCount: count(row.failed_count), openedCount: count(row.opened_count), clickedCount: count(row.clicked_count),
    unsubscribedCount: count(row.unsubscribed_count),
    testSentAt: text(row.test_sent_at), testSentTo: text(row.test_sent_to), submittedAt: text(row.submitted_at),
    approvedAt: text(row.approved_at), scheduledAt: text(row.scheduled_at), startedAt: text(row.started_at),
    completedAt: text(row.completed_at), pausedAt: text(row.paused_at),
    batchSize: count(row.batch_size) || 10, sendIntervalSeconds: count(row.send_interval_seconds) || 60,
    trackOpens: row.track_opens === true, trackClicks: row.track_clicks === true,
    updatedAt: text(row.updated_at), brochureGenerationId: text(row.brochure_generation_id),
  };
}

async function campaignRow(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('mailing_campaigns').select('*').eq('id', id).maybeSingle();
  check(error, 'Nie udało się wczytać kampanii.');
  if (!data) fail('Nie znaleziono kampanii.', 404);
  return data as Row;
}

/** Centrum Kampanii: kampanie (najnowsze zmiany na górze), aktywne segmenty, konta nadawcze i szablony — jak `loadBaseData`. */
export async function campaignsHome(ctx: NativeContext) {
  requireView(ctx);
  const [campaigns, segments, accounts, templates] = await Promise.all([
    allRows((client) => client.from('mailing_campaigns').select('*').order('updated_at', { ascending: false }).order('id'), ctx.supabase, 5000),
    ctx.supabase.from('marketing_segments').select('id, name, color, description').eq('is_active', true).order('name'),
    ctx.supabase.from('employee_email_accounts').select('id, email_address, from_name').eq('is_active', true).order('is_default', { ascending: false }),
    ctx.supabase.from('email_templates').select('id, name, subject_template, body_template').order('name'),
  ]);
  check(segments.error || accounts.error || templates.error, 'Nie udało się załadować Centrum Kampanii');
  return {
    access: campaignsAccess(ctx),
    campaigns: (campaigns as Row[]).map(campaignItem),
    segments: ((segments.data ?? []) as Row[]).map((row) => ({
      id: text(row.id), name: text(row.name), color: text(row.color), description: text(row.description),
    })),
    accounts: ((accounts.data ?? []) as Row[]).map((row) => ({ id: text(row.id), email: text(row.email_address), fromName: text(row.from_name) })),
    templates: ((templates.data ?? []) as Row[]).map((row) => ({
      id: text(row.id), name: text(row.name), subject: text(row.subject_template), body: text(row.body_template),
    })),
  };
}

/** „Podgląd kwalifikacji” — pełna lista odbiorców kampanii (CRM czyta jedną stronę do 1000 wierszy; tu wszystkie). */
export async function campaignRecipients(ctx: NativeContext, id: string) {
  requireView(ctx);
  const rows = await allRows((client) => client.from('mailing_recipients')
    .select('id, email, display_name, legal_basis, status, exclusion_reason, sent_at, opened_at, clicked_at, failed_at, attempt_count, error_message')
    .eq('campaign_id', id).order('status').order('display_name').order('id'), ctx.supabase, 50_000);
  return {
    recipients: (rows as Row[]).map((row) => ({
      id: text(row.id), email: text(row.email), name: text(row.display_name), legalBasis: text(row.legal_basis), status: text(row.status),
      exclusionReason: text(row.exclusion_reason), sentAt: text(row.sent_at), openedAt: text(row.opened_at), clickedAt: text(row.clicked_at),
      failedAt: text(row.failed_at), attempts: count(row.attempt_count), error: text(row.error_message),
    })),
  };
}

/** „Demo strefy sprzedawcy — skuteczność kampanii” (`CampaignDemoReport`): liczniki, broszura i PDF przypisany do kampanii. */
export async function campaignDemo(ctx: NativeContext, id: string) {
  requireView(ctx);
  const { data: report, error } = await ctx.supabase.rpc('get_seller_demo_campaign_report', { p_campaign: id });
  if (error) fail('Nie udało się wczytać danych demonstracji kampanii.');
  const campaign = await campaignRow(ctx, id);
  if (!campaign.brochure_generation_id) fail('Kampania nie jest powiązana z broszurą PDF.', 404);
  const { data: generation, error: generationError } = await ctx.supabase.from('sales_brochure_generations')
    .select('brochure_id,pdf_path,snapshot').eq('id', campaign.brochure_generation_id).single();
  if (generationError || !generation) fail('Nie udało się wczytać danych demonstracji kampanii.');
  const snapshot = isObject(generation!.snapshot) ? generation!.snapshot : {};
  const tagged = isObject(snapshot.demoAttribution) && text(snapshot.demoAttribution.campaignId) === id;
  let url = '';
  if (tagged && generation!.pdf_path) {
    const { data: signed } = await ctx.supabase.storage.from('generated-brochures').createSignedUrl(text(generation!.pdf_path), 3600);
    url = signed?.signedUrl || '';
  }
  const value = isObject(report) ? report : {};
  return {
    report: { visits: count(value.visits), sessions: count(value.sessions), pdfs: count(value.pdfs), downloads: count(value.downloads) },
    brochureId: text(generation!.brochure_id), tagged, url,
  };
}

/** „Nowa kampania” — bezpieczna wersja robocza. */
export async function createCampaign(ctx: NativeContext) {
  requireManage(ctx);
  const { data, error } = await ctx.supabase.from('mailing_campaigns').insert({
    name: 'Nowa kampania', subject: '', content: '', status: 'draft', created_by: ctx.employee.id,
  }).select('*').single();
  check(error, 'Nie udało się utworzyć kampanii.');
  return { campaign: campaignItem(data as Row), message: 'Utworzono bezpieczną wersję roboczą kampanii' };
}

/**
 * „Zapisz wersję” (tylko wersja robocza): pola jak `saveCampaign`, reguły odbiorców scalane z zapisanymi (np. `business_types`
 * zostają), puste reguły usuwane. Zapis tylko, gdy kampania nie zmieniła się od wczytania (`updatedAt`) — bez nadpisania
 * zmian z przeglądarki.
 */
export async function saveCampaign(ctx: NativeContext, id: string, body: Row) {
  requireManage(ctx);
  const current = await campaignRow(ctx, id);
  if (current.status !== 'draft') fail('Zatwierdzonej lub wysłanej kampanii nie można zmieniać');
  if (text(body.updatedAt) && text(body.updatedAt) !== text(current.updated_at)) {
    fail('Kampania została zmieniona w międzyczasie (np. w przeglądarce). Odśwież i wprowadź zmiany ponownie.', 409);
  }
  const audience = isObject(body.audience) ? body.audience : {};
  const rules: Row = { ...(isObject(current.audience_rules) ? current.audience_rules : {}) };
  const entityTypes = list(audience.entityTypes).filter((item) => (ENTITY_TYPES as readonly string[]).includes(item));
  const eventTypes = list(audience.eventTypes);
  const regions = list(audience.regions);
  const budgetMin = Number(audience.budgetMin) > 0 ? Number(audience.budgetMin) : 0;
  const budgetMax = Number(audience.budgetMax) > 0 ? Number(audience.budgetMax) : 0;
  if (entityTypes.length) rules.entity_types = entityTypes; else delete rules.entity_types;
  if (eventTypes.length) rules.event_types = eventTypes; else delete rules.event_types;
  if (regions.length) rules.regions = regions; else delete rules.regions;
  if (budgetMin) rules.budget_min = budgetMin; else delete rules.budget_min;
  if (budgetMax) rules.budget_max = budgetMax; else delete rules.budget_max;
  const segmentIds = list(body.segmentIds).filter((item) => UUID.test(item));
  const accountId = text(body.emailAccountId);
  const templateId = text(body.templateId);
  const { data, error } = await ctx.supabase.from('mailing_campaigns').update({
    name: text(body.name).trim(),
    subject: text(body.subject).trim(),
    content: text(body.content),
    preview_text: text(body.previewText).trim() || null,
    email_account_id: UUID.test(accountId) ? accountId : null,
    template_id: UUID.test(templateId) ? templateId : null,
    segment_ids: [...new Set(segmentIds)],
    audience_rules: rules,
    track_opens: body.trackOpens === true,
    track_clicks: body.trackClicks === true,
  }).eq('id', id).eq('updated_at', current.updated_at).select('*');
  check(error, 'Nie udało się zapisać kampanii.');
  const saved = (data ?? []) as Row[];
  if (!saved.length) fail('Kampania została zmieniona w międzyczasie (np. w przeglądarce). Odśwież i wprowadź zmiany ponownie.', 409);
  return { campaign: campaignItem(saved[0]), message: 'Zapisano kampanię. Po zmianach ponownie przelicz odbiorców i wyślij test.' };
}

/** „Przelicz” — kwalifikacja odbiorców w bazie (zgody, sprzeciwy, wykluczenia). */
export async function refreshAudience(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { data, error } = await ctx.supabase.rpc('refresh_mailing_campaign_audience', { p_campaign_id: id });
  check(error, 'Nie udało się przeliczyć odbiorców.');
  const result = isObject(data) ? data : {};
  return { message: `Przeliczono odbiorców: ${count(result.eligible)} dopuszczonych, ${count(result.excluded)} wykluczonych` };
}

/** Funkcja brzegowa jak `supabase.functions.invoke` w CRM; komunikat błędu z odpowiedzi funkcji. */
async function invoke(ctx: NativeContext, name: string, body: Row, fallback: string) {
  const { data, error } = await ctx.supabase.functions.invoke(name, { body });
  let message = isObject(data) ? (data.error as string | undefined) : undefined;
  if (error && !message) {
    try { message = (await (error as any).context?.json())?.error; } catch { /* komunikat zastępczy */ }
  }
  if (error || message) fail(text(message) || fallback);
  return data;
}

/** „Test” — wiadomość testowa na wskazany adres. */
export async function sendTest(ctx: NativeContext, id: string, email: unknown) {
  requireManage(ctx);
  const testEmail = text(email).trim();
  if (!testEmail) fail('Podaj adres odbiorcy testowego.');
  await invoke(ctx, 'send-marketing-campaign-test', { campaignId: id, testEmail }, 'Nie udało się wysłać wiadomości testowej.');
  return { message: `Test wysłano na ${testEmail.toLowerCase()}` };
}

/** „Przekaż do zatwierdzenia” — zablokowane dla szkicu z broszurą PDF (jak przycisk w CRM). */
export async function submitCampaign(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const current = await campaignRow(ctx, id);
  if (current.brochure_generation_id) {
    fail('To szkic powiązany z wersją PDF broszury — zatwierdzenie i masowa wysyłka są zablokowane do czasu aktywacji kontrolowanej dystrybucji linku.');
  }
  const { error } = await ctx.supabase.rpc('submit_mailing_campaign_for_approval', { p_campaign_id: id });
  check(error, 'Nie udało się przekazać kampanii do zatwierdzenia.');
  return { message: 'Kampania czeka na zatwierdzenie' };
}

export async function approveCampaign(ctx: NativeContext, id: string) {
  if (!campaignsAccess(ctx).canApprove) fail('Nie masz uprawnień do zatwierdzania kampanii.', 403);
  const { error } = await ctx.supabase.rpc('approve_mailing_campaign', { p_campaign_id: id, p_note: null });
  check(error, 'Nie udało się zatwierdzić kampanii.');
  return { message: 'Kampania zatwierdzona. Możesz teraz bezpiecznie zaplanować wysyłkę.' };
}

/**
 * Uruchomienie kolejki od razu (`process-marketing-campaigns`, jak `invokeWorker`). Kampania jest już zapisana, a kolejkę i tak
 * przetwarza co minutę zadanie w bazie — błąd natychmiastowego uruchomienia nie cofa operacji, tylko zmienia komunikat.
 */
async function kickWorker(ctx: NativeContext) {
  try {
    await invoke(ctx, 'process-marketing-campaigns', { source: 'crm' }, 'worker');
    return true;
  } catch (error) {
    console.error('[native-campaigns] worker', error);
    return false;
  }
}

/** „Uruchom bezpieczną kolejkę” — termin, wielkość partii (1–20) i odstęp między partiami. */
export async function scheduleCampaign(ctx: NativeContext, id: string, body: Row) {
  requireManage(ctx);
  const date = new Date(text(body.scheduledAt));
  if (Number.isNaN(date.getTime())) fail('Podaj poprawny termin wysyłki');
  const batchSize = Math.trunc(Number(body.batchSize));
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 20) fail('Partia może mieć od 1 do 20 wiadomości.');
  const interval = Math.trunc(Number(body.sendIntervalSeconds));
  if (!INTERVALS.includes(interval)) fail('Wybierz odstęp między partiami.');
  const { error } = await ctx.supabase.rpc('schedule_mailing_campaign', {
    p_campaign_id: id, p_scheduled_at: date.toISOString(), p_batch_size: batchSize, p_send_interval_seconds: interval,
  });
  check(error, 'Nie udało się zaplanować kampanii.');
  const started = date.getTime() <= Date.now() + 10_000 ? await kickWorker(ctx) : true;
  return {
    message: started
      ? 'Kampania została zaplanowana i przekazana do bezpiecznej kolejki'
      : 'Kampania została zaplanowana. Kolejka ruszy przy najbliższym automatycznym przebiegu (w ciągu minuty).',
  };
}

export async function pauseCampaign(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { error } = await ctx.supabase.rpc('pause_mailing_campaign', { p_campaign_id: id });
  check(error, 'Nie udało się wstrzymać kampanii.');
  return { message: 'Kampania została wstrzymana' };
}

export async function resumeCampaign(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { error } = await ctx.supabase.rpc('resume_mailing_campaign', { p_campaign_id: id });
  check(error, 'Nie udało się wznowić kampanii.');
  const started = await kickWorker(ctx);
  return {
    message: started ? 'Kampania została wznowiona' : 'Kampania została wznowiona. Kolejka ruszy przy najbliższym automatycznym przebiegu (w ciągu minuty).',
  };
}

/** „Anuluj” — niewysłane wiadomości trafiają trwale poza kolejkę (potwierdzenie w aplikacji). */
export async function cancelCampaign(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { error } = await ctx.supabase.rpc('cancel_mailing_campaign', { p_campaign_id: id });
  check(error, 'Nie udało się anulować kampanii.');
  return { message: 'Kampania została anulowana' };
}

export const isCampaignId = (value: unknown) => UUID.test(text(value));
