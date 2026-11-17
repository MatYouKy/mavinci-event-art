import 'server-only';
import type { NativeContext } from './auth';
import { imageCrop } from './team';
import { allRows } from './page';
import { fetchPublicHolidays, holidayDateLabel, indexHolidays, workingTimeNorm, workingTimeNormSentence } from '@/lib/CRM/calendar/publicHolidays';
import { workAmounts, type PersonnelWork } from '@/lib/personnel/workspace';

/*
 * Czas pracy na Macu (`/crm/time-tracking`): moje wpisy z licznikiem (start, stop, edycja z kontrolą wersji, usuwanie), wymiar
 * czasu pracy miesiąca, raport zespołu dla administratora (`AdminDashboard`), strona pracownika (`/crm/time-tracking/[id]`:
 * zadania, wpisy, historia zmian), rozmowy o wpisach (`*_time_entry_discussion`), rozliczenie czasu pracy
 * (`*_employee_time_settlement*`) i wynagrodzenie z umów (`personnel_*`, `assign_personnel_time`). Tokenem pracownika — RLS
 * i funkcje bazy rozstrzygają dostęp jak w przeglądarce.
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const num = (value: unknown) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const person = (value: Row | null | undefined) => [value?.name, value?.surname].filter(Boolean).join(' ');

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const check = (error: { message?: string } | null | undefined, message: string) => {
  if (error) fail(error.message || message);
};
const requireId = (value: unknown, message: string) => {
  const id = text(value);
  if (!UUID.test(id)) fail(message);
  return id;
};
const iso = (value: unknown, message: string) => {
  const date = new Date(text(value));
  if (!text(value) || Number.isNaN(date.getTime())) fail(message);
  return date.toISOString();
};

// MARK: Czas polski — granice dni i miesięcy jak w przeglądarce w Polsce

const WARSAW = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
/** Przesunięcie czasu polskiego względem UTC (ms) w danej chwili. */
function offsetAt(ms: number) {
  const p = Object.fromEntries(WARSAW.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** Północ dnia `RRRR-MM-DD` w Polsce jako chwila ISO (UTC). */
function warsawMidnight(day: string) {
  const t0 = Date.parse(`${day}T00:00:00Z`);
  return new Date(t0 - offsetAt(t0 - offsetAt(t0))).toISOString();
}
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' });
/** Dzień `RRRR-MM-DD` chwili w czasie polskim. */
const warsawDay = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? '' : DAY.format(date);
};

const ENTRY_SELECT = '*, tasks(title, event_id, events(name)), events(name)';

/** Wpis czasu w kształcie dla aplikacji (zadanie, wydarzenie, stawka z warunków umowy). */
function entryItem(row: Row) {
  const task = one(row.tasks) as Row | null;
  const event = one(row.events) as Row | null;
  const taskEvent = one(task?.events) as Row | null;
  const snapshot = (row.personnel_rate_snapshot || {}) as Row;
  const employee = one(row.employees) as Row | null;
  return {
    id: String(row.id), employeeId: text(row.employee_id), employeeName: person(employee),
    taskId: row.task_id || null, taskTitle: text(task?.title), eventId: row.event_id || task?.event_id || null,
    eventName: text(taskEvent?.name) || text(event?.name), title: text(row.title), description: text(row.description),
    start: text(row.start_time), end: row.end_time || null, minutes: num(row.duration_minutes), billable: row.is_billable === true,
    rate: num(row.hourly_rate), currency: text(snapshot.currency) || 'PLN',
    rateBasis: snapshot.rate_basis === 'gross' ? 'brutto' : snapshot.rate_basis === 'net' ? 'netto' : '',
    contractId: row.personnel_contract_id || null, edits: Number(row.edit_count) || 0, updatedAt: row.updated_at || null,
  };
}

const minutesOf = (entries: ReturnType<typeof entryItem>[]) => entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0);

/** Wymiar czasu pracy pełnego etatu w bieżącym miesiącu (`MonthNormLine`). */
async function monthNorm(ctx: NativeContext) {
  const today = warsawDay(new Date().toISOString());
  const [year, month] = today.split('-').map(Number);
  const first = `${today.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  try {
    const norm = workingTimeNorm(year, month, indexHolidays(await fetchPublicHolidays(ctx.supabase, first, last)));
    return {
      month: new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('pl-PL', { month: 'long', timeZone: 'UTC' }),
      sentence: workingTimeNormSentence(norm),
      holidays: norm.holidays.map((h) => holidayDateLabel(h)).join(', '),
    };
  } catch {
    return null;
  }
}

async function discussions(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.rpc('list_time_entry_discussions');
  if (error) return { threads: [], error: 'Nie udało się pobrać rozmów. Sprawdź, czy migracja wątków została zastosowana.' };
  return {
    threads: ((Array.isArray(data) ? data : []) as Row[]).map((t) => ({
      id: String(t.id), entryId: String(t.time_entry_id), resolved: t.resolved === true, title: text(t.title) || 'Praca',
      description: text(t.description), start: t.start_time || null, minutes: num(t.duration_minutes), employeeName: text(t.employee_name),
      messages: ((Array.isArray(t.messages) ? t.messages : []) as Row[]).map((m) => ({
        id: String(m.id), author: text(m.author_name), body: text(m.body), at: m.created_at || null,
      })),
    })),
    error: '',
  };
}

export async function timeDiscussions(ctx: NativeContext) {
  return discussions(ctx);
}

/** Ekran „Czas pracy”: mój licznik, moje wpisy (ostatnie 100 + aktywne), zadania do licznika, wymiar miesiąca, rozmowy. */
export async function timeHome(ctx: NativeContext) {
  const s = ctx.supabase;
  const me = ctx.employee.id;
  const [activeRes, entriesRes, tasksRes, norm, threads] = await Promise.all([
    s.from('time_entries').select(ENTRY_SELECT).eq('employee_id', me).is('end_time', null),
    s.from('time_entries').select(ENTRY_SELECT).eq('employee_id', me).order('start_time', { ascending: false }).limit(100),
    s.from('tasks').select('id,title,event_id,events(name)').order('created_at', { ascending: false }).limit(50),
    monthNorm(ctx),
    discussions(ctx),
  ]);
  check(activeRes.error, 'Błąd podczas ładowania wpisów czasu');
  check(entriesRes.error, 'Błąd podczas ładowania wpisów czasu');
  const active = ((activeRes.data ?? []) as Row[]).map(entryItem);
  const ids = new Set(active.map((e) => e.id));
  const entries = [...active, ...((entriesRes.data ?? []) as Row[]).map(entryItem).filter((e) => !ids.has(e.id))];
  return {
    me: { id: me, isAdmin: ctx.employee.isAdmin },
    norm,
    active: active[0] ?? null,
    entries,
    tasks: ((tasksRes.error ? [] : tasksRes.data ?? []) as Row[]).map((t) => ({
      id: String(t.id), title: text(t.title), eventId: t.event_id || null, eventName: text((one(t.events) as Row | null)?.name),
    })),
    discussions: threads,
  };
}

const dayRange = (from: unknown, to: unknown) => {
  const a = text(from), b = text(to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) fail('Nieprawidłowy okres.');
  return { from: a, to: b, start: warsawMidnight(a), end: warsawMidnight(nextDay(b)) };
};

/** Raport zespołu (`AdminDashboard`): aktywne liczniki, wpisy z okresu (dni w czasie polskim), statystyki pracowników i dni. */
export async function timeDashboard(ctx: NativeContext, from: string, to: string, employee: string | null) {
  if (!ctx.employee.isAdmin) fail('Raport czasu pracy zespołu jest dostępny dla administratora.', 403);
  const range = dayRange(from, to);
  const s = ctx.supabase;
  const select = '*, employees!time_entries_employee_id_fkey(id, name, surname, avatar_url, avatar_metadata), tasks(title, event_id, events(name)), events(name)';
  let active = s.from('time_entries').select(select).is('end_time', null);
  if (employee) active = active.eq('employee_id', employee);
  const [activeRes, periodRows, employeesRes] = await Promise.all([
    active,
    allRows<Row>((c) => {
      let q = c.from('time_entries').select(select).gte('start_time', range.start).lt('start_time', range.end)
        .order('start_time', { ascending: false }).order('id');
      if (employee) q = q.eq('employee_id', employee);
      return q;
    }, s, 50_000),
    s.from('employees').select('id, name, surname').eq('is_active', true).order('name'),
  ]);
  check(activeRes.error, 'Błąd podczas pobierania danych');
  check(employeesRes.error, 'Błąd podczas pobierania danych');
  const activeRows = (activeRes.data ?? []) as Row[];
  const ids = new Set(activeRows.map((r) => String(r.id)));
  const rows = [...activeRows, ...periodRows.filter((r) => !ids.has(String(r.id)))];
  const stats = new Map<string, Row>();
  const daily = new Map<string, { date: string; minutes: number; entries: number; employees: Set<string> }>();
  const activeBy = new Map<string, Row>();
  for (const row of rows) {
    if (!row.end_time) { activeBy.set(String(row.employee_id), row); continue; }
    const id = String(row.employee_id);
    const who = one(row.employees) as Row | null;
    const minutes = Number(row.duration_minutes) || 0;
    const revenue = !row.personnel_contract_id && row.hourly_rate ? minutes / 60 * Number(row.hourly_rate) : 0;
    const entry = stats.get(id) ?? {
      id, name: person(who) || 'Nieznany', avatarUrl: who?.avatar_url || null, avatar: imageCrop(who?.avatar_metadata),
      minutes: 0, billableMinutes: 0, revenue: 0, entries: 0, days: new Set<string>(),
    };
    entry.minutes += minutes;
    entry.entries += 1;
    entry.revenue += revenue;
    if (row.is_billable) entry.billableMinutes += minutes;
    const day = warsawDay(row.start_time);
    entry.days.add(day);
    stats.set(id, entry);
    const dayEntry = daily.get(day) ?? { date: day, minutes: 0, entries: 0, employees: new Set<string>() };
    dayEntry.minutes += minutes;
    dayEntry.entries += 1;
    dayEntry.employees.add(id);
    daily.set(day, dayEntry);
  }
  const people = [...stats.values()].map((e) => ({
    id: e.id, name: e.name, avatarUrl: e.avatarUrl, avatar: e.avatar, minutes: e.minutes, billableMinutes: e.billableMinutes,
    revenue: Math.round(e.revenue * 100) / 100, entries: e.entries, days: e.days.size,
    active: activeBy.has(e.id) ? entryItem(activeBy.get(e.id)!) : null,
  })).sort((a, b) => b.minutes - a.minutes);
  return {
    range: { from: range.from, to: range.to },
    employees: ((employeesRes.data ?? []) as Row[]).map((e) => ({ id: String(e.id), name: person(e) })),
    people,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
      date: d.date, minutes: d.minutes, entries: d.entries, employees: d.employees.size,
    })),
    totals: {
      minutes: people.reduce((sum, p) => sum + p.minutes, 0),
      billableMinutes: people.reduce((sum, p) => sum + p.billableMinutes, 0),
      revenue: Math.round(people.reduce((sum, p) => sum + p.revenue, 0) * 100) / 100,
      employees: people.length,
    },
  };
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Tytuł', description: 'Opis', start_time: 'Czas rozpoczęcia', end_time: 'Czas zakończenia', duration_minutes: 'Czas trwania (minuty)',
  is_billable: 'Płatne', hourly_rate: 'Stawka godzinowa', tags: 'Tagi', task_id: 'Zadanie', event_id: 'Wydarzenie', employee_id: 'Pracownik',
  personnel_contract_id: 'Umowa pracownika', personnel_rate_snapshot: 'Warunki rozliczenia', compensation_snapshot: 'Warunki wynagrodzenia',
  created_at: 'Data utworzenia',
};
const historyValue = (field: string, value: unknown) => {
  if (value === null || value === undefined || value === '') return '(puste)';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (field.includes('time') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
function historyItem(row: Row) {
  const fields = Array.isArray(row.changed_fields) ? row.changed_fields.map(text) : [];
  return {
    id: String(row.id), entryId: text(row.time_entry_id), action: text(row.action), at: row.changed_at || null,
    actor: [row.actor_name, row.actor_surname].filter(Boolean).join(' '), actorId: row.changed_by || null,
    title: text(row.entry_title),
    changes: row.action === 'updated' ? fields.map((field) => ({
      field, label: FIELD_LABELS[field] ?? field, before: historyValue(field, row.old_values?.[field]), after: historyValue(field, row.new_values?.[field]),
    })) : [],
  };
}

export async function entryHistory(ctx: NativeContext, entryId: string) {
  const { data, error } = await ctx.supabase.from('admin_time_entries_history_view').select('*').eq('time_entry_id', entryId).order('changed_at', { ascending: false });
  check(error, 'Nie udało się pobrać historii zmian.');
  return { history: ((data ?? []) as Row[]).map(historyItem) };
}

/** Strona pracownika (`/crm/time-tracking/[employeeId]`): wpisy z okresu, czas według zadań, historia zmian i usunięć. */
export async function timeEmployee(ctx: NativeContext, employeeId: string, from: string, to: string) {
  const range = dayRange(from, to);
  const s = ctx.supabase;
  const [employeeRes, entriesRes, historyRes] = await Promise.all([
    s.from('employees').select('id,name,surname,email,phone_number,avatar_url,avatar_metadata').eq('id', employeeId).maybeSingle(),
    allRows<Row>((c) => c.from('time_entries').select(ENTRY_SELECT).eq('employee_id', employeeId).gte('start_time', range.start)
      .lt('start_time', range.end).order('start_time', { ascending: false }).order('id'), s, 50_000),
    s.from('admin_time_entries_history_view').select('*').eq('employee_id', employeeId).gte('changed_at', range.start)
      .lt('changed_at', range.end).order('changed_at', { ascending: false }).limit(1000),
  ]);
  check(employeeRes.error, 'Błąd podczas ładowania danych');
  const who = employeeRes.data as Row | null;
  if (!who) fail('Nie znaleziono pracownika', 404);
  const entries = entriesRes.map(entryItem);
  const tasks = new Map<string, Row>();
  for (const entry of entries) {
    if (!entry.end) continue;
    const key = entry.taskId ?? 'no-task';
    const stat = tasks.get(key) ?? { taskId: entry.taskId, title: entry.taskTitle || entry.title || 'Praca bez zadania', eventName: entry.eventName, minutes: 0, entries: 0, last: entry.start };
    stat.minutes += entry.minutes ?? 0;
    stat.entries += 1;
    if (new Date(entry.start) > new Date(stat.last)) stat.last = entry.start;
    tasks.set(key, stat);
  }
  return {
    me: { id: ctx.employee.id, isAdmin: ctx.employee.isAdmin },
    range: { from: range.from, to: range.to },
    employee: {
      id: String(who.id), name: person(who), email: text(who.email), phone: text(who.phone_number), avatarUrl: who.avatar_url || null,
      avatar: imageCrop(who.avatar_metadata),
    },
    active: entries.find((e) => !e.end) ?? null,
    entries,
    tasks: [...tasks.values()].sort((a, b) => b.minutes - a.minutes),
    history: historyRes.error ? [] : ((historyRes.data ?? []) as Row[]).map(historyItem),
    totals: {
      minutes: minutesOf(entries),
      billableMinutes: minutesOf(entries.filter((e) => e.billable)),
      revenue: Math.round(entries.filter((e) => !e.contractId && e.rate && e.minutes).reduce((sum, e) => sum + (e.minutes ?? 0) / 60 * (e.rate ?? 0), 0) * 100) / 100,
      entries: entries.length,
    },
    discussions: await discussions(ctx),
  };
}

// MARK: Rozliczenie czasu pracy i wynagrodzenie z umów

export async function settlementPreview(ctx: NativeContext, employeeId: string, until: string) {
  const { data, error } = await ctx.supabase.rpc('get_employee_time_settlement_preview', { p_employee: employeeId, p_until: iso(until, 'Podaj poprawną datę i godzinę.') });
  check(error, 'Nie udało się pobrać rozliczeń.');
  const preview = (data || {}) as Row;
  const settlement = (row: Row | null) => row ? {
    id: String(row.id), until: text(row.settled_until), hours: Number(row.hours) || 0, rate: Number(row.hourly_rate) || 0, amount: Number(row.amount) || 0,
    reportMinutes: Number(row.report_minutes) || 0, createdAt: row.created_at || null, notes: text(row.notes),
    voidedAt: row.voided_at || null, voidReason: text(row.void_reason),
  } : null;
  return {
    canManage: preview.can_manage === true, latest: settlement(preview.latest || null), latestChanged: preview.latest_changed === true,
    history: ((Array.isArray(preview.history) ? preview.history : []) as Row[]).map((row) => settlement(row)!),
    minutes: Number(preview.minutes) || 0, entryCount: Number(preview.entry_count) || 0, crossingCount: Number(preview.crossing_count) || 0,
    signature: text(preview.signature),
  };
}

/** `save_employee_time_settlement` — identyfikator zapisu nadaje aplikacja (ponowienie nie dubluje rozliczenia). */
export async function saveSettlement(ctx: NativeContext, body: Row) {
  const id = requireId(body.requestId, 'Nieprawidłowe rozliczenie.');
  const { error } = await ctx.supabase.rpc('save_employee_time_settlement', {
    p_id: id, p_employee: requireId(body.employeeId, 'Nieprawidłowy pracownik.'), p_until: iso(body.until, 'Podaj poprawną datę i godzinę.'),
    p_hours: Number(body.hours), p_rate: Number(body.rate), p_previous: body.previous && UUID.test(text(body.previous)) ? body.previous : null,
    p_signature: text(body.signature), p_notes: text(body.notes).trim() || null, p_accept_adjustment: body.accept === true,
  });
  check(error, 'Nie udało się zapisać rozliczenia.');
  return { ok: true };
}

export async function voidSettlement(ctx: NativeContext, id: string, reason: unknown) {
  const why = text(reason).trim();
  if (!why) fail('Podaj powód cofnięcia ostatniego rozliczenia.');
  const { error } = await ctx.supabase.rpc('void_employee_time_settlement', { p_id: id, p_reason: why });
  check(error, 'Nie udało się cofnąć rozliczenia.');
  return { ok: true, message: 'Cofnięto oznaczenie ostatniego rozliczenia.' };
}

/** Umowy pracownika do rozliczenia czasu (bez szkiców) — jak `employeeContracts`. */
async function employeeContracts(ctx: NativeContext, employeeId: string) {
  const s = ctx.supabase;
  const { data: personRow, error: personError } = await s.from('personnel_people').select('id').eq('employee_id', employeeId).maybeSingle();
  check(personError, 'Nie udało się pobrać umów.');
  let query = s.from('personnel_contracts').select('id,contract_number,start_date,end_date').neq('status', 'draft').order('start_date', { ascending: false });
  query = personRow ? query.or(`employee_id.eq.${employeeId},person_id.eq.${(personRow as Row).id}`) : query.eq('employee_id', employeeId);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać umów.');
  return ((data ?? []) as Row[]).map((c) => ({ id: String(c.id), number: text(c.contract_number), start: text(c.start_date), end: text(c.end_date) }));
}

export async function timeContracts(ctx: NativeContext, employeeId: string) {
  return { contracts: await employeeContracts(ctx, employeeId) };
}

/** Wynagrodzenie z umów (`PersonnelEarnings`): naliczenia miesiąca, salda rozliczeń, wpisy bez umowy. */
export async function timeEarnings(ctx: NativeContext, employeeId: string, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) fail('Nieprawidłowy miesiąc.');
  const s = ctx.supabase;
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const contracts = await employeeContracts(ctx, employeeId);
  const items: PersonnelWork[] = [];
  let settlements: Row[] = [];
  if (contracts.length) {
    const ids = contracts.map((c) => c.id);
    for (let from = 0; ; from += 500) {
      const { data, error } = await s.from('personnel_work_items').select('*').in('contract_id', ids).gte('work_date', `${month}-01`).lt('work_date', next)
        .order('source').order('id').range(from, from + 499);
      check(error, 'Nie udało się pobrać wynagrodzenia.');
      items.push(...((data ?? []) as PersonnelWork[]));
      if ((data ?? []).length < 500) break;
    }
    const { data, error } = await s.from('personnel_settlement_balances').select('*').in('contract_id', ids).eq('period', `${month}-01`);
    check(error, 'Nie udało się pobrać wynagrodzenia.');
    settlements = (data ?? []) as Row[];
  }
  // Granice miesiąca w czasie polskim (jak przeglądarka w Polsce).
  const { data: unlinked, error } = await s.from('time_entries').select('id,title,start_time,duration_minutes').eq('employee_id', employeeId)
    .is('personnel_contract_id', null).not('end_time', 'is', null).gte('start_time', warsawMidnight(`${month}-01`)).lt('start_time', warsawMidnight(next))
    .order('start_time', { ascending: false }).limit(100);
  check(error, 'Nie udało się pobrać wynagrodzenia.');
  return {
    contracts,
    totals: Object.entries(workAmounts(items)).map(([key, value]) => {
      const [currency, basis] = key.split(':');
      return { currency, basis: basis === 'net' ? 'netto' : 'brutto', amount: Math.round(value * 100) / 100 };
    }),
    settlements: settlements.map((b) => ({
      id: String(b.id), contract: contracts.find((c) => c.id === b.contract_id)?.number ?? '', currency: text(b.currency) || 'PLN',
      net: Number(b.net_amount) || 0, paid: Number(b.paid_amount) || 0, remaining: Number(b.remaining_amount) || 0,
    })),
    unlinked: ((unlinked ?? []) as Row[]).map((e) => ({ id: String(e.id), title: text(e.title), start: text(e.start_time), minutes: Number(e.duration_minutes) || 0 })),
  };
}

export async function assignContract(ctx: NativeContext, entryId: string, contractId: string) {
  const { error } = await ctx.supabase.rpc('assign_personnel_time', { p_entry: entryId, p_contract: contractId });
  check(error, 'Nie udało się przypisać umowy.');
  return { ok: true, message: 'Wpis przypisany do umowy.' };
}

// MARK: Wpisy czasu

export async function startTimer(ctx: NativeContext, body: Row) {
  const s = ctx.supabase;
  const taskId = body.taskId && UUID.test(text(body.taskId)) ? text(body.taskId) : null;
  const title = text(body.title).trim();
  if (!taskId && !title) fail('Podaj tytuł zadania');
  const contractId = body.contractId && UUID.test(text(body.contractId)) ? text(body.contractId) : null;
  let eventId: string | null = null;
  if (taskId) {
    const { data: task } = await s.from('tasks').select('event_id').eq('id', taskId).maybeSingle();
    eventId = (task as Row | null)?.event_id ?? null;
  }
  const { data, error } = await s.from('time_entries').insert({
    employee_id: ctx.employee.id, personnel_contract_id: contractId, event_id: eventId, task_id: taskId,
    title: taskId ? null : title, description: text(body.description).trim() || null, start_time: new Date().toISOString(),
  }).select('id').single();
  check(error, 'Błąd podczas uruchamiania timera');
  return { ok: true, id: String((data as Row).id), message: 'Timer rozpoczęty!' };
}

export async function stopTimer(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('time_entries').update({ end_time: new Date().toISOString() })
    .eq('id', id).eq('employee_id', ctx.employee.id).is('end_time', null).select('id');
  check(error, 'Błąd podczas zatrzymywania timera');
  if (!data?.length) fail('Licznik został już zatrzymany albo nie należy do Ciebie. Odśwież widok.');
  return { ok: true, message: 'Timer zatrzymany!' };
}

/** Edycja zakończonego wpisu (`EditEntryModal`) — zapis tylko, gdy wpis nie zmienił się od otwarcia (`updated_at`). */
export async function updateEntry(ctx: NativeContext, body: Row) {
  const id = requireId(body.id, 'Nieprawidłowy wpis.');
  const title = text(body.title).trim();
  if (!title) fail('Podaj tytuł');
  const start = iso(body.start, 'Podaj datę i godzinę rozpoczęcia.');
  const end = body.end ? iso(body.end, 'Podaj datę i godzinę zakończenia.') : null;
  if (end && new Date(end) <= new Date(start)) fail('Koniec musi być późniejszy niż początek.');
  const contractId = body.contractId && UUID.test(text(body.contractId)) ? text(body.contractId) : null;
  const { data, error } = await ctx.supabase.from('time_entries').update({
    personnel_contract_id: contractId, title, description: text(body.description), start_time: start, end_time: end,
  }).eq('id', id).eq('employee_id', ctx.employee.id).eq('updated_at', text(body.updatedAt)).select('id');
  check(error, 'Błąd podczas aktualizacji');
  if (!data?.length) fail('Wpis zmienił się lub nie jest już dostępny. Zamknij edycję i odśwież listę.');
  return { ok: true, message: 'Wpis zaktualizowany' };
}

export async function deleteEntry(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('time_entries').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania wpisu');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tego wpisu.', 403);
  return { ok: true, message: 'Wpis usunięty' };
}

export async function postDiscussion(ctx: NativeContext, entryId: string, body: unknown) {
  const message = text(body).trim();
  if (!message) fail('Wpisz wiadomość.');
  if (message.length > 4000) fail('Wiadomość może mieć najwyżej 4000 znaków.');
  const { error } = await ctx.supabase.rpc('post_time_entry_discussion', { p_entry: entryId, p_body: message });
  check(error, 'Nie udało się zapisać wiadomości.');
  return { ok: true };
}

export async function resolveDiscussion(ctx: NativeContext, entryId: string, resolved: boolean) {
  const { error } = await ctx.supabase.rpc('resolve_time_entry_discussion', { p_entry: entryId, p_resolved: resolved });
  check(error, 'Nie udało się zapisać wiadomości.');
  return { ok: true, message: resolved ? 'Wątek oznaczono jako wyjaśniony.' : 'Wątek otwarty ponownie.' };
}

