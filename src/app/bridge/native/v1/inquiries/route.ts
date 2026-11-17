import { nativeContext, nativeJson, nativeUnauthorized, readJson, can, type NativeContext } from '@/lib/native/auth';
import { inquiriesItems, inquiriesState, inquiryAccess, invalidateInquiries } from '@/lib/native/inquiries';
import { LOST_REASON_CATEGORIES, STAGES } from '@/lib/CRM/inquiries/pipeline';
import {
  acceptInquiryOffer,
  addInquiryNote,
  changeInquiryStage,
  createInquiryCalculation,
  createInquiryOffer,
  duplicateInquiryOffer,
  handOffInquiry,
  inquiryHandoffCandidates,
  inquiryWorkspace,
  markInquiryContacted,
  reopenInquiryNegotiation,
  saveInquiryBrief,
  saveInquiryTitle,
} from '@/lib/native/inquiryWorkspace';
import {
  approveInquirySummary,
  askInquiryAssistant,
  convertInquiry,
  createInquiryTask,
  improveInquiryEmail,
  inquiryAnalysis,
  inquiryClientSetup,
  inquiryConvertSetup,
  inquiryCorrespondence,
  inquiryEmailPreview,
  inquiryEmailSetup,
  inquiryEmailThread,
  inquiryTasks,
  inquiryTeam,
  linkInquiryClient,
  linkInquiryEmail,
  readInquiryGuests,
  searchInquiryClients,
  searchInquiryEmails,
  sendInquiryEmail,
  setInquiryTeamMember,
} from '@/lib/native/inquiryWorkspaceTools';
import { inquiryCalculationAction, inquiryCalculationQuery, sendInquiryCalculationEmail } from '@/lib/native/eventCalculations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/*
 * Lejek zapytań dla aplikacji na Maca — te same operacje co strona `/crm/inquiries` (`InquiriesPageClient`): zmiana etapu
 * i obsługa zapytania (`tasks`), przejęcie (`claim_inquiry`), kontakt wykonany (`complete_inquiry_followup`), odłożenie
 * (`snooze_inquiry_followup`), usunięcie lub archiwizacja (`remove_inquiry`). Tokenem pracownika — RLS jak w przeglądarce.
 * Karta zapytania (`/crm/inquiries/[id]`, `src/lib/native/inquiryWorkspace.ts`): GET op=workspace | handoffCandidates;
 * POST op=workspaceTitle | workspaceBrief | workspaceContacted | workspaceStage | workspaceReopen | workspaceNote |
 * workspaceHandoff | workspaceOffer | workspaceCalculation | workspaceAccept | workspaceDuplicate.
 * Część 2 (`src/lib/native/inquiryWorkspaceTools.ts`): GET op=correspondence | emailSearch | emailThread | emailSetup |
 * analysis | clientSetup | clientSearch | team | tasks | convertSetup; POST op=workspaceLinkEmail | workspaceEmailPreview |
 * workspaceEmailSend | workspaceEmailImprove | workspaceAsk | workspaceGuests | workspaceApprove | workspaceClient |
 * workspaceTeam | workspaceTask | workspaceConvert. Wysyłka e-maili i asystent AI tokenem pracownika (jak przeglądarka).
 * Kalkulacje zapytania (`src/lib/native/eventCalculations.ts`, edytor jak w wydarzeniu): GET op=calcQuery&id&query=…;
 * POST op=calcAction {id, action, targetId?, …} | calcEmail {id, calculationId, …}.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const allowed = (ctx: NativeContext) => can(ctx.employee, 'inquiries_view') || can(ctx.employee, 'inquiries_manage')
  || ['inquiries_view_pool', 'inquiries_view_team', 'inquiries_view_all', 'inquiries_manage_own', 'inquiries_manage_team', 'inquiries_manage_all']
    .some((scope) => ctx.employee.permissions.includes(scope));
const stageIds = STAGES.map((stage) => stage.id as string);
const lostCategories = LOST_REASON_CATEGORIES.map(([value]) => value as string);
const bearer = (request: Request) => /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
const workspaceRead = new Set(['workspace', 'handoffCandidates', 'correspondence', 'emailSearch', 'emailThread', 'emailSetup', 'analysis', 'clientSetup', 'clientSearch', 'team', 'tasks', 'convertSetup', 'calcQuery']);
const isoOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do zapytań.', 403);
  const url = new URL(request.url);
  const q = (key: string) => url.searchParams.get(key) || '';
  try {
    switch (q('op')) {
      case 'state': {
        const [state, access] = await Promise.all([inquiriesState(ctx, q('hash') || undefined), inquiryAccess(ctx)]);
        return nativeJson({ ...state, access });
      }
      case 'employees': {
        // Lista „Osoba odpowiedzialna” jak w CRM: wszyscy (zarządzanie wszystkimi), zespół albo tylko Ty.
        const access = await inquiryAccess(ctx);
        const { data, error } = await ctx.supabase.from('employees')
          .select('id,name,surname,sales_team_id').eq('is_active', true).order('surname');
        if (error) throw error;
        const everyone = access.isAdmin || access.manageAll || ctx.employee.permissions.includes('inquiries_view_all');
        const list = (data || []).filter((e) => everyone || (access.salesTeamId ? e.sales_team_id === access.salesTeamId : e.id === access.employeeId));
        return nativeJson({ employees: list.map((e) => ({ id: e.id, name: `${e.name ?? ''} ${e.surname ?? ''}`.trim() })) });
      }
      case 'workspace':
        return nativeJson(await inquiryWorkspace(ctx, q('id')));
      case 'handoffCandidates':
        return nativeJson(await inquiryHandoffCandidates(ctx, q('id')));
      case 'correspondence':
        return nativeJson(await inquiryCorrespondence(ctx, q('id')));
      case 'emailSearch':
        return nativeJson(await searchInquiryEmails(ctx, q('id'), q('query')));
      case 'emailThread':
        return nativeJson(await inquiryEmailThread(ctx, q('id'), q('type'), q('messageId')));
      case 'emailSetup':
        return nativeJson(await inquiryEmailSetup(ctx, q('id')));
      case 'analysis':
        return nativeJson(await inquiryAnalysis(ctx, q('id')));
      case 'clientSetup':
        return nativeJson(await inquiryClientSetup(ctx, q('id')));
      case 'clientSearch':
        return nativeJson(await searchInquiryClients(ctx, q('id'), q('kind'), q('query')));
      case 'team':
        return nativeJson(await inquiryTeam(ctx, q('id')));
      case 'tasks':
        return nativeJson(await inquiryTasks(ctx, q('id')));
      case 'convertSetup':
        return nativeJson(await inquiryConvertSetup(ctx, q('id')));
      case 'calcQuery':
        return nativeJson(await inquiryCalculationQuery(ctx, q('id'), q('query'), url.searchParams));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-inquiries]', error);
    return failure(errorText(error, 'Nie udało się pobrać zapytań.'), workspaceRead.has(q('op')) ? 400 : 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do zapytań.', 403);
  let body: Record<string, any>;
  try {
    // Wiadomość do klienta może mieć załączniki (do 25 MB, base64) — jak wysyłka w module Wiadomości.
    body = await readJson(request, 36 * 1024 * 1024);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  if (op !== 'items' && !uuid.test(id)) return failure('Nieprawidłowe zapytanie.');
  const done = (payload: Record<string, unknown> = {}) => { invalidateInquiries(); return nativeJson({ ok: true, ...payload }); };
  const rpcFailure = (error: { message?: string; code?: string }, fallback: string) =>
    failure(errorText(error, fallback), error.code === '42501' ? 403 : 400);
  try {
    switch (op) {
      case 'items':
        return nativeJson(await inquiriesItems(ctx, Array.isArray(body.buckets) ? body.buckets : []));
      case 'move': {
        const stage = String(body.stage || '');
        if (!stageIds.includes(stage) || stage === 'lost') return failure('Nieprawidłowy etap.');
        const probability = STAGES.find((item) => item.id === stage)?.defaultProbability ?? 0;
        const { data, error } = await ctx.supabase.from('tasks')
          .update({ inquiry_stage: stage, win_probability: probability, lost_reason: null, lost_reason_category: null })
          .eq('id', id).eq('is_inquiry', true).select('id');
        if (error) return rpcFailure(error, 'Nie udało się przenieść zapytania.');
        if (!data?.length) return failure('Najpierw przejmij zapytanie lub poproś menedżera o przypisanie.', 403);
        return done({ probability });
      }
      case 'update': {
        const data = body.data && typeof body.data === 'object' ? body.data : {};
        const title = String(data.title || '').trim();
        const stage = String(data.stage || '');
        if (!title) return failure('Wpisz tytuł zapytania.');
        if (!stageIds.includes(stage)) return failure('Nieprawidłowy etap.');
        const closed = stage === 'won' || stage === 'lost';
        const lostReason = String(data.lostReason || '').trim();
        const lostCategory = String(data.lostReasonCategory || '');
        if (stage === 'lost' && (!lostCategories.includes(lostCategory) || !lostReason)) {
          return failure('Wybierz kategorię i opisz powód przegrania zapytania.');
        }
        const next = isoOrNull(data.nextActionAt);
        const last = isoOrNull(data.lastContactAt);
        if (next === undefined || last === undefined) return failure('Nieprawidłowa data.');
        const value = data.estimatedValue === null || data.estimatedValue === undefined || data.estimatedValue === '' ? null : Number(data.estimatedValue);
        if (value !== null && (!Number.isFinite(value) || value < 0)) return failure('Nieprawidłowa wartość.');
        const update: Record<string, unknown> = {
          title,
          inquiry_stage: stage,
          next_action_at: closed ? null : next,
          last_contact_at: last,
          estimated_value: value,
          win_probability: Math.max(0, Math.min(100, Math.round(Number(data.probability) || 0))),
          lost_reason: stage === 'lost' ? lostReason : null,
          lost_reason_category: stage === 'lost' ? lostCategory : null,
        };
        if ('ownerId' in data) {
          const access = await inquiryAccess(ctx);
          const owner = data.ownerId ? String(data.ownerId) : null;
          if (owner && !uuid.test(owner)) return failure('Nieprawidłowy opiekun.');
          if (access.canAssign) update.inquiry_owner_id = owner;
        }
        const { data: saved, error } = await ctx.supabase.from('tasks').update(update).eq('id', id).eq('is_inquiry', true).select('id');
        if (error) return rpcFailure(error, 'Nie udało się zapisać zapytania.');
        if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego zapytania.', 403);
        return done();
      }
      case 'claim': {
        const { error } = await ctx.supabase.rpc('claim_inquiry', { p_inquiry_id: id });
        if (error) return rpcFailure(error, 'Nie udało się przejąć zapytania.');
        return done();
      }
      case 'contact': {
        const next = isoOrNull(body.nextActionAt);
        if (next === undefined) return failure('Nieprawidłowa data kolejnego działania.');
        const { error } = await ctx.supabase.rpc('complete_inquiry_followup', { p_inquiry_id: id, p_next_action_at: next });
        if (error) return rpcFailure(error, 'Nie udało się potwierdzić kontaktu.');
        return done();
      }
      case 'snooze': {
        const minutes = Math.max(5, Math.min(10080, Math.round(Number(body.minutes) || 60)));
        const { error } = await ctx.supabase.rpc('snooze_inquiry_followup', { p_inquiry_id: id, p_minutes: minutes });
        if (error) return rpcFailure(error, 'Nie udało się odłożyć przypomnienia.');
        return done();
      }
      case 'remove': {
        // Bez trybu: baza sprawdza powiązania i zwraca „deleted” albo „archived” (jak `confirmAndRemoveInquiry`).
        const mode = body.mode === 'deleted' || body.mode === 'archived' ? body.mode : null;
        if (!mode) {
          const { data, error } = await ctx.supabase.rpc('remove_inquiry', { p_inquiry: id });
          if (error) return rpcFailure(error, 'Nie udało się sprawdzić powiązań zapytania.');
          if (data !== 'deleted' && data !== 'archived') return failure('Nie udało się sprawdzić powiązań zapytania.');
          return nativeJson({ mode: data });
        }
        const reason = String(body.reason || '').trim();
        if (mode === 'archived' && !reason) return failure('Podaj powód archiwizacji.');
        const { error } = await ctx.supabase.rpc('remove_inquiry', { p_inquiry: id, p_mode: mode, p_reason: reason || null });
        if (error) {
          return failure(error.code === '23503'
            ? 'Nie udało się usunąć zapytania. Jego historia została zachowana.'
            : errorText(error, 'Nie udało się usunąć zapytania.'), 400);
        }
        return done({ mode });
      }
      case 'workspaceTitle': return done(await saveInquiryTitle(ctx, body));
      case 'workspaceBrief': return done(await saveInquiryBrief(ctx, body));
      case 'workspaceContacted': return done(await markInquiryContacted(ctx, body));
      case 'workspaceStage': return done(await changeInquiryStage(ctx, body));
      case 'workspaceReopen': return done(await reopenInquiryNegotiation(ctx, body));
      case 'workspaceNote': return done(await addInquiryNote(ctx, body));
      case 'workspaceHandoff': return done(await handOffInquiry(ctx, body));
      case 'workspaceOffer': return done(await createInquiryOffer(ctx, body));
      case 'workspaceCalculation': return done(await createInquiryCalculation(ctx, body));
      case 'workspaceAccept': return done(await acceptInquiryOffer(ctx, body));
      case 'workspaceDuplicate': return done(await duplicateInquiryOffer(ctx, body));
      case 'workspaceLinkEmail': return done(await linkInquiryEmail(ctx, body));
      case 'workspaceEmailPreview': return nativeJson(await inquiryEmailPreview(ctx, body));
      case 'workspaceEmailSend': return done(await sendInquiryEmail(ctx, bearer(request), body));
      case 'workspaceEmailImprove': return nativeJson(await improveInquiryEmail(ctx, bearer(request), body));
      case 'workspaceAsk': return nativeJson(await askInquiryAssistant(ctx, bearer(request), body));
      case 'workspaceGuests': return nativeJson(await readInquiryGuests(ctx, bearer(request), body));
      case 'workspaceApprove': return done(await approveInquirySummary(ctx, body));
      case 'workspaceClient': {
        const result = await linkInquiryClient(ctx, body);
        return 'duplicate' in result ? nativeJson(result) : done(result);
      }
      case 'workspaceTeam': return done(await setInquiryTeamMember(ctx, body));
      case 'workspaceTask': return done(await createInquiryTask(ctx, body));
      case 'workspaceConvert': return done(await convertInquiry(ctx, body));
      // `id` to zapytanie; identyfikator kalkulacji czynności (usuń, duplikuj, wybierz) przychodzi w `targetId`.
      case 'calcAction': return done((await inquiryCalculationAction(ctx, id, String(body.action || ''), { ...body, id: body.targetId ?? null })) as Record<string, unknown>);
      case 'calcEmail': return nativeJson(await sendInquiryCalculationEmail(ctx, bearer(request), id, body));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-inquiries]', op, error);
    if (op.startsWith('workspace') || op.startsWith('calc')) return failure(errorText(error, 'Serwer nie wykonał operacji.'), 400);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
