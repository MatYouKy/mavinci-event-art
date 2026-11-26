import { can, nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { invalidateMeetings, meetingsItems, meetingsState } from '@/lib/native/meetings';
import { notifyMeetingContacts, parseMeetingBefore } from '@/lib/native/meetingMail';
import { parseMeetingChat } from '@/lib/meetings/meetingChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Spotkania dla aplikacji na Maca — te same dane i funkcje co strona `/crm/meetings`: lista z RLS, zapis przez `save_meeting`
 * (pełna lista uczestników), odpowiedzi przez `respond_to_meeting`, usuwanie przez `delete_meeting_occurrences`.
 * Widok „Pracownicy” i ostrzeżenia o zajętości: `people` (`get_schedule_people`) i `availability` (`get_team_availability`).
 * `notify` — e-mail do uczestników spoza firmy po zapisie / usunięciu (CRM, Mac i telefon; `src/lib/native/meetingMail.ts`).
 * `chat` / `chatOpen` — czat spotkania w Komunikatorze (`meeting_chat`, `docs/meeting-chat.md`): liczniki i pliki, otwarcie.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const allowed = (ctx: NativeContext) =>
  can(ctx.employee, 'calendar_view') || can(ctx.employee, 'calendar_manage');
const like = (value: string) => `%${value.replace(/[%_,()]/g, ' ').trim()}%`;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do spotkań.', 403);
  const url = new URL(request.url);
  const q = (key: string) => url.searchParams.get(key) || '';
  try {
    switch (q('op')) {
      case 'state':
        return nativeJson({
          ...(await meetingsState(ctx, q('hash') || undefined)),
          employeeId: ctx.employee.id,
          canManage: can(ctx.employee, 'calendar_manage'),
        });
      case 'employees': {
        const { data, error } = await ctx.supabase.from('employees')
          .select('id,name,surname,nickname').eq('is_active', true).order('name').order('surname');
        if (error) throw error;
        return nativeJson({
          employees: (data || []).map((e) => ({ id: e.id, name: `${e.name ?? ''} ${e.surname ?? ''}`.trim(), nickname: e.nickname ?? '' })),
        });
      }
      case 'contacts': {
        const query = q('query').trim();
        if (query.length < 2) return nativeJson({ contacts: [] });
        const { data, error } = await ctx.supabase.from('contacts')
          .select('id,full_name,first_name,last_name').ilike('full_name', like(query)).order('last_name').limit(20);
        if (error) throw error;
        return nativeJson({
          contacts: (data || []).map((c) => ({ id: c.id, name: c.full_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() })),
        });
      }
      case 'locations': {
        const query = q('query').trim();
        if (query.length < 2) return nativeJson({ locations: [] });
        const { data, error } = await ctx.supabase.from('locations')
          .select('id,name,address,city').ilike('name', like(query)).order('name').limit(15);
        if (error) throw error;
        return nativeJson({
          locations: (data || []).map((l) => ({ id: l.id, name: l.name, detail: [l.address, l.city].filter(Boolean).join(', ') })),
        });
      }
      case 'people': {
        // Osoby z zakresu planu (dział, przełożony) — widok „Pracownicy”.
        const { data, error } = await ctx.supabase.rpc('get_schedule_people');
        if (error) throw error;
        return nativeJson({
          people: ((data || []) as Array<Record<string, unknown>>).map((p) => ({
            id: p.id, name: p.name ?? '', surname: p.surname ?? '', nickname: p.nickname ?? '', avatarUrl: p.avatar_url ?? null,
            department: p.department || 'office', supervisorId: p.supervisor_id ?? null, occupation: p.occupation ?? '',
            isSelf: p.is_self === true, isSubordinate: p.is_subordinate === true,
          })),
        });
      }
      case 'availability': {
        // Zajętość wybranych osób (spotkania, eventy, fazy, nieobecności); szczegóły według zakresu planu.
        const ids = q('ids').split(',').filter((value) => uuid.test(value)).slice(0, 60);
        const from = q('from');
        const to = q('to');
        const exclude = q('exclude');
        if (!ids.length) return nativeJson({ blocks: [] });
        if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return failure('Podaj zakres czasu.');
        const { data, error } = await ctx.supabase.rpc('get_team_availability', {
          p_employee_ids: ids, p_from: from, p_to: to, p_exclude_meeting: uuid.test(exclude) ? exclude : null,
        });
        if (error) return failure(errorText(error, 'Nie udało się pobrać zajętości.'), error.code === '42501' ? 403 : 400);
        return nativeJson({
          blocks: ((data || []) as Array<Record<string, unknown>>).map((b) => ({
            employeeId: b.employee_id, kind: b.kind, itemId: b.item_id ?? null, title: b.title ?? null, subtitle: b.subtitle ?? null,
            start: b.starts_at, end: b.ends_at, allDay: b.all_day === true, tentative: b.tentative === true, detailed: b.detailed === true,
          })),
        });
      }
      case 'chat': {
        // Czat spotkania: rozmowa (jeśli już jest), wiadomości, nieprzeczytane i pliki — tylko uczestnik albo organizator.
        const id = q('id');
        if (!uuid.test(id)) return failure('Nieprawidłowe spotkanie.');
        const { data, error } = await ctx.supabase.rpc('meeting_chat', { p_meeting_id: id, p_create: false });
        if (error) return failure(errorText(error, 'Nie udało się pobrać czatu spotkania.'), error.code === '42501' ? 403 : 400);
        return nativeJson(parseMeetingChat(data));
      }
      case 'holidays': {
        // Dni ustawowo wolne w nagłówku osi czasu (jak w CRM — `fetchPublicHolidays`).
        const day = /^\d{4}-\d{2}-\d{2}$/;
        if (!day.test(q('from')) || !day.test(q('to'))) return failure('Podaj zakres dat.');
        const { data, error } = await ctx.supabase.from('public_holidays')
          .select('holiday_date,name').eq('country', 'PL').gte('holiday_date', q('from')).lte('holiday_date', q('to')).order('holiday_date');
        if (error) throw error;
        return nativeJson({ holidays: (data || []).map((h) => ({ date: String(h.holiday_date).slice(0, 10), name: h.name })) });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-meetings]', error);
    return failure(errorText(error, 'Nie udało się pobrać spotkań.'), 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do spotkań.', 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  try {
    switch (op) {
      case 'items':
        return nativeJson(await meetingsItems(ctx, Array.isArray(body.buckets) ? body.buckets : []));
      case 'save': {
        const id = body.id ? String(body.id) : null;
        if (id && !uuid.test(id)) return failure('Nieprawidłowe spotkanie.');
        const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
        if (!data) return failure('Brak danych spotkania.');
        const participants = (Array.isArray(body.participants) ? body.participants : [])
          .map((p: Record<string, unknown>) =>
            typeof p?.employee_id === 'string' && uuid.test(p.employee_id)
              ? { employee_id: p.employee_id }
              : typeof p?.contact_id === 'string' && uuid.test(p.contact_id)
                ? { contact_id: p.contact_id }
                : null,
          )
          .filter(Boolean);
        const { data: saved, error } = await ctx.supabase.rpc('save_meeting', {
          p_id: id,
          p_data: data,
          p_participants: participants,
          p_recurrence_days: Number(body.recurrenceDays) || 0,
          p_scope: body.scope === 'future' ? 'future' : 'single',
        });
        if (error) return failure(errorText(error, 'Nie udało się zapisać spotkania.'), error.code === '42501' ? 403 : 400);
        invalidateMeetings();
        return nativeJson({ ok: true, id: (saved as { id?: string } | null)?.id ?? id });
      }
      case 'respond': {
        const id = String(body.id || '');
        const response = String(body.response || '');
        if (!uuid.test(id) || !['accepted', 'tentative', 'declined'].includes(response)) return failure('Nieprawidłowa odpowiedź.');
        const { error } = await ctx.supabase.rpc('respond_to_meeting', { p_meeting_id: id, p_response: response });
        if (error) return failure(errorText(error, 'Nie udało się zapisać odpowiedzi.'), error.code === '42501' ? 403 : 400);
        invalidateMeetings();
        return nativeJson({ ok: true });
      }
      case 'notify': {
        // Po zapisie / usunięciu: zaproszenie, zmiana, odwołanie albo „nieaktualne” dla kontaktów (stan sprzed zmiany — `before`).
        const id = String(body.id || '');
        if (!uuid.test(id)) return failure('Nieprawidłowe spotkanie.');
        const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
        try {
          const result = await notifyMeetingContacts(ctx, token, id, parseMeetingBefore(body.before), body.scope === 'future' ? 'future' : 'single');
          return nativeJson({ ok: true, ...result });
        } catch (error) {
          const status = (error as { status?: number })?.status;
          return failure(errorText(error, 'Nie udało się wysłać wiadomości do osób spoza firmy.'), status === 403 ? 403 : 400);
        }
      }
      case 'chatOpen': {
        // „Otwórz czat”: rozmowa powstaje przy pierwszym otwarciu, skład = uczestnicy spotkania i organizator.
        const id = String(body.id || '');
        if (!uuid.test(id)) return failure('Nieprawidłowe spotkanie.');
        const { data, error } = await ctx.supabase.rpc('meeting_chat', { p_meeting_id: id, p_create: true });
        if (error) return failure(errorText(error, 'Nie udało się otworzyć czatu spotkania.'), error.code === '42501' ? 403 : 400);
        return nativeJson(parseMeetingChat(data));
      }
      case 'delete': {
        const id = String(body.id || '');
        if (!uuid.test(id)) return failure('Nieprawidłowe spotkanie.');
        const { error } = await ctx.supabase.rpc('delete_meeting_occurrences', {
          p_id: id,
          p_scope: body.scope === 'future' ? 'future' : 'single',
        });
        if (error) return failure(errorText(error, 'Nie udało się usunąć spotkania.'), error.code === '42501' ? 403 : 400);
        invalidateMeetings();
        return nativeJson({ ok: true });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-meetings]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
