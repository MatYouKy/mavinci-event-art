import { can, nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { employeeDetail, employeeSchedule, invalidateTeam, teamAccess, teamItems, teamState } from '@/lib/native/team';
import { resetEmployeePassword } from '@/lib/employees/resetEmployeePassword.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Zespół dla aplikacji na Maca — lista jak `/crm/employees`, karta jak `/crm/employees/[id]` (zapis profilu, nieobecności,
 * zmiana hasła, trwałe usuwanie, dodanie pracownika przez funkcję `create-employee`). Tokenem pracownika — RLS jak w CRM.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400, fieldErrors?: Record<string, string>) =>
  nativeJson({ error: message, ...(fieldErrors ? { fieldErrors } : {}) }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pola karty „Przegląd” (Informacje podstawowe, Adres, Notatki) — własny profil albo `employees_manage`. */
const BASE_KEYS = ['name', 'surname', 'nickname', 'email', 'phone_number', 'occupation', 'address_street', 'address_postal_code',
  'address_city', 'region', 'notes'];
/** Pola tylko dla administratora (e-mail prywatny, powiadomienia, rola firmowa, widoczność na stronie). */
const ADMIN_KEYS = ['personal_email', 'notification_email_preference', 'access_level_id', 'show_on_website', 'order_index', 'website_bio',
  'linkedin_url', 'instagram_url', 'facebook_url'];
const ABSENCE_TYPES = ['vacation', 'sick_leave', 'unpaid_leave', 'training', 'remote_work', 'other'];

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = teamAccess(ctx);
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const id = url.searchParams.get('id') || '';
  try {
    if (op === 'state') {
      if (!access.canView) return failure('Nie masz uprawnień do przeglądania pracowników', 403);
      return nativeJson({ ...(await teamState(ctx, url.searchParams.get('hash') || undefined)), access });
    }
    if (op === 'detail') {
      if (!uuid.test(id)) return failure('Nieprawidłowy pracownik.');
      if (!access.canView && id !== ctx.employee.id) return failure('Nie masz uprawnień do przeglądania pracowników', 403);
      return nativeJson(await employeeDetail(ctx, id));
    }
    if (op === 'schedule') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter((value) => uuid.test(value)).slice(0, 300);
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      if (!ids.length || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return failure('Nieprawidłowy zakres planu.');
      if (!access.canView && (ids.length !== 1 || ids[0] !== ctx.employee.id)) return failure('Nie masz uprawnień do planu pracowników', 403);
      return nativeJson(await employeeSchedule(ctx, ids, from, to));
    }
    if (op === 'createOptions') {
      if (!access.canCreate) return failure('Nie masz uprawnień do dodawania pracowników', 403);
      const [levels, companies] = await Promise.all([
        ctx.supabase.from('access_levels').select('id,name,description').eq('is_company_role', true).order('order_index'),
        ctx.supabase.from('my_companies').select('id,name').order('name'),
      ]);
      if (levels.error) throw levels.error;
      if (companies.error) throw companies.error;
      return nativeJson({ accessLevels: levels.data || [], companies: companies.data || [] });
    }
    return failure('Nieznana operacja.');
  } catch (error) {
    console.error('[native-employees]', op, error);
    return failure(errorText(error, 'Nie udało się pobrać danych zespołu.'), 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = teamAccess(ctx);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  const me = ctx.employee.id;
  try {
    switch (op) {
      case 'items':
        if (!access.canView) return failure('Nie masz uprawnień do przeglądania pracowników', 403);
        return nativeJson(await teamItems(ctx, Array.isArray(body.buckets) ? body.buckets : []));

      case 'update': {
        if (!uuid.test(id)) return failure('Nieprawidłowy pracownik.');
        if (id !== me && !access.canManage) return failure('Nie masz uprawnień do edycji tego pracownika.', 403);
        const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
        const keys = [...BASE_KEYS, ...(access.isAdmin ? ADMIN_KEYS : [])].filter((key) => key in data);
        const update: Record<string, unknown> = {};
        for (const key of keys) {
          const value = data[key];
          update[key] = typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
        }
        const errors: Record<string, string> = {};
        if ('name' in update && !update.name) errors.name = 'Imię jest wymagane.';
        if ('surname' in update && !update.surname) errors.surname = 'Nazwisko jest wymagane.';
        if ('email' in update && (typeof update.email !== 'string' || !email.test(update.email))) errors.email = 'Wpisz poprawny adres e-mail.';
        if (typeof update.personal_email === 'string' && !email.test(update.personal_email)) errors.personal_email = 'Wpisz poprawny adres e-mail.';
        if ('notification_email_preference' in update && !['work', 'personal', 'both', 'none'].includes(String(update.notification_email_preference))) {
          errors.notification_email_preference = 'Wybierz adres powiadomień z listy.';
        }
        if ('access_level_id' in update && update.access_level_id !== null && !uuid.test(String(update.access_level_id))) errors.access_level_id = 'Wybierz rolę z listy.';
        if ('order_index' in update) {
          const order = Number(update.order_index);
          if (!Number.isInteger(order) || order < 0) errors.order_index = 'Kolejność musi być liczbą całkowitą ≥ 0.';
          else update.order_index = order;
        }
        if ('show_on_website' in update) update.show_on_website = update.show_on_website === true;
        if (Object.keys(errors).length) return failure('Popraw wymagane pola formularza', 400, errors);
        if (!Object.keys(update).length) return nativeJson({ ok: true });
        const { data: saved, error } = await ctx.supabase.from('employees').update(update).eq('id', id).eq('is_active', true).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas zapisywania zmian'));
        if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego profilu.', 403);
        invalidateTeam();
        return nativeJson({ ok: true });
      }

      case 'delete': {
        if (!uuid.test(id)) return failure('Nieprawidłowy pracownik.');
        if (!access.isAdmin) return failure('Nie masz uprawnień do trwałego usuwania pracowników.', 403);
        if (id === me) return failure('Nie możesz usunąć własnego konta.', 403);
        const { error } = await ctx.supabase.rpc('delete_employee_completely', { p_employee_id: id });
        if (error) return failure(errorText(error, 'Nie udało się trwale usunąć pracownika.'));
        invalidateTeam();
        return nativeJson({ ok: true });
      }

      case 'resetPassword': {
        if (!uuid.test(id) || typeof body.password !== 'string') return failure('Brak wymaganych parametrów');
        const result = await resetEmployeePassword({ isAdmin: access.isAdmin, canManage: can(ctx.employee, 'employees_manage') }, id, body.password);
        if (!result.ok) return failure(result.error, result.status);
        return nativeJson({ ok: true });
      }

      case 'create': {
        if (!access.canCreate) return failure('Nie masz uprawnień do dodawania pracowników', 403);
        const form = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
        const value = (key: string) => (typeof form[key] === 'string' ? (form[key] as string).trim() : '');
        const payload = {
          email: value('email'), password: typeof form.password === 'string' ? form.password.trim() : '', name: value('name'), surname: value('surname'),
          nickname: value('nickname'), phone_number: value('phone_number'), role: 'unassigned', access_level_id: value('access_level_id'),
          company_access_mode: form.company_access_mode === 'all' ? 'all' : 'selected',
          my_company_ids: Array.isArray(form.my_company_ids) ? form.my_company_ids.map(String).filter((entry) => uuid.test(entry)) : [],
          occupation: value('occupation'),
        };
        if (!payload.email || !payload.password || !payload.name || !payload.surname) return failure('Wypełnij wszystkie wymagane pola');
        if (!payload.access_level_id) return failure('Wybierz rolę firmową');
        if (payload.company_access_mode === 'selected' && !payload.my_company_ids.length) return failure('Wybierz przynajmniej jedną markę albo dostęp do wszystkich marek');
        // Ta sama funkcja co formularz w CRM (`AddEmployeeModal`), z tokenem zalogowanego pracownika.
        const authorization = request.headers.get('authorization') || '';
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-employee`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return failure(String(result?.error || 'Nie udało się utworzyć pracownika'), response.status >= 500 ? 502 : 400);
        invalidateTeam();
        return nativeJson({ ok: true, id: result?.employee?.id || result?.id || null });
      }

      case 'absence': {
        const employeeId = String(body.employeeId || '');
        if (!uuid.test(employeeId)) return failure('Nieprawidłowy pracownik.');
        if (employeeId !== me && !access.canManage) return failure('Nie możesz dodać nieobecności temu pracownikowi.', 403);
        const type = String(body.type || '');
        const start = String(body.start || '');
        const end = String(body.end || '');
        if (!ABSENCE_TYPES.includes(type)) return failure('Wybierz typ nieobecności.');
        if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return failure('Podaj daty rozpoczęcia i zakończenia.');
        if (Date.parse(end) < Date.parse(start)) return failure('Koniec nie może być przed początkiem.');
        const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
        const { error } = await ctx.supabase.from('employee_absences').insert({
          employee_id: employeeId, absence_type: type, start_date: start, end_date: end, all_day: body.allDay !== false, notes,
          approval_status: 'pending',
        });
        if (error) return failure(errorText(error, 'Błąd podczas zapisywania'));
        return nativeJson({ ok: true });
      }

      case 'absenceDecision': {
        if (!uuid.test(id)) return failure('Nieprawidłowa nieobecność.');
        if (!access.canApproveAbsences) return failure('Nie masz uprawnień do rozpatrywania wniosków.', 403);
        const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
        const approve = body.decision === 'approve';
        const { data, error } = approve
          ? await ctx.supabase.rpc('approve_absence', { p_absence_id: id, p_approver_id: me, p_notes: note })
          : await ctx.supabase.rpc('reject_absence', { p_absence_id: id, p_rejector_id: me, p_reason: note || '' });
        if (error) return failure(errorText(error, approve ? 'Błąd podczas zatwierdzania' : 'Błąd podczas odrzucania'));
        const result = (data || {}) as { success?: boolean; error?: string };
        if (result.success === false) return failure(result.error || (approve ? 'Błąd podczas zatwierdzania' : 'Błąd podczas odrzucania'));
        return nativeJson({ ok: true });
      }

      case 'absenceDelete': {
        if (!uuid.test(id)) return failure('Nieprawidłowa nieobecność.');
        const { data: absence, error: readError } = await ctx.supabase.from('employee_absences').select('id,employee_id,approval_status').eq('id', id).maybeSingle();
        if (readError) throw readError;
        if (!absence) return failure('Nie znaleziono nieobecności.', 404);
        if (!access.canApproveAbsences && !(absence.employee_id === me && absence.approval_status === 'pending')) {
          return failure('Możesz usunąć tylko własny, jeszcze nierozpatrzony wniosek.', 403);
        }
        const { data: removed, error } = await ctx.supabase.from('employee_absences').delete().eq('id', id).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas usuwania'));
        if (!removed?.length) return failure('Nie masz uprawnień do usunięcia tej nieobecności.', 403);
        return nativeJson({ ok: true });
      }

      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-employees]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
