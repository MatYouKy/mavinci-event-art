import 'server-only';
import type { NativeContext } from './auth';
import { DASHBOARD_WIDGETS, DEFAULT_DASHBOARD_RANGE, type DashboardRange } from '@/lib/CRM/dashboard/dashboardConfig';
import { OPERATIONAL_LABELS } from '@/lib/CRM/events/operationalStages';

/*
 * Uzupełnienia dashboardu dla Maca (trasa `/bridge/native/v1/dashboard`):
 * - dashboard magazynu i logistyki (`WarehouseDashboard`): uszkodzony sprzęt, wydarzenia do przygotowania z etapem operacyjnym,
 *   moje otwarte zadania — te same zapytania co strona CRM, tokenem pracownika (RLS);
 * - „Moja sprzedaż” sprzedawcy za wybrany rok (`SellerFinancialDashboard`) — funkcja bazy `get_my_sales_financial_report`
 *   sama rozstrzyga, czyje to wydarzenia (bez identyfikatora pracownika z aplikacji);
 * - „Dostosuj dashboard” (zakładka „Dashboard” w Ustawieniach CRM): zakres wykresów i widoczne sekcje w `employees.preferences.dashboard`.
 */

type Row = Record<string, any>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

export class DashboardExtrasError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new DashboardExtrasError(message, status);
}

/** Dashboard magazynu (`WarehouseDashboard`): każda sekcja z własnym błędem, jak „Odśwież stronę” w CRM. */
export async function warehouseDashboard(ctx: NativeContext) {
  const db = ctx.supabase;
  const [damaged, events, assignments] = await Promise.all([
    db.from('equipment_units').select('id,equipment_id,unit_serial_number,condition_notes,equipment:equipment_items(name)', { count: 'exact' })
      .eq('status', 'damaged').order('updated_at', { ascending: false }).limit(20),
    db.from('events').select('id,name,event_date,status').in('status', ['offer_accepted', 'in_preparation', 'ready_for_live'])
      .order('event_date', { ascending: true }).limit(20),
    db.from('task_assignees').select('task_id').eq('employee_id', ctx.employee.id),
  ]);
  const taskIds = [...new Set(rows(assignments.data).map((row) => str(row.task_id)).filter(Boolean))];
  const tasks = assignments.error ? { data: null, error: assignments.error } : taskIds.length
    ? await db.from('tasks').select('id,title,due_date,status').in('id', taskIds).or('is_inquiry.is.null,is_inquiry.eq.false')
      .in('status', ['todo', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false }).limit(20)
    : { data: [], error: null };
  const eventIds = rows(events.data).map((row) => str(row.id));
  const stages = eventIds.length ? await db.rpc('get_event_operational_states', { p_event_ids: eventIds }) : { data: [], error: null };
  const statusById = new Map<string, string>(rows(stages.data).map((row) => [str(row.event_id), str(row.status)]));
  return {
    damaged: damaged.error ? null : rows(damaged.data).map((unit) => {
      const equipment = Array.isArray(unit.equipment) ? unit.equipment[0] : unit.equipment;
      return {
        id: str(unit.id), equipmentId: str(unit.equipment_id), name: str(equipment?.name) || 'Sprzęt',
        serial: str(unit.unit_serial_number), notes: str(unit.condition_notes),
      };
    }),
    damagedCount: damaged.error ? null : damaged.count ?? null,
    events: events.error || stages.error ? null : rows(events.data).map((event) => ({
      id: str(event.id), name: str(event.name), date: str(event.event_date) || null,
      stage: OPERATIONAL_LABELS[statusById.get(str(event.id)) || str(event.status)] || 'Do potwierdzenia',
    })),
    tasks: tasks.error ? null : rows(tasks.data).map((task) => ({ id: str(task.id), title: str(task.title), dueDate: str(task.due_date) || null })),
  };
}

/** „Moja sprzedaż” za rok (`p_date_from`–`p_date_to` jak w CRM); raport tylko dla własnej sprzedaży (`scope: own_sales`). */
export async function mySalesReport(ctx: NativeContext, yearParam: unknown) {
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail('Nieprawidłowy rok.');
  const { data, error } = await ctx.supabase.rpc('get_my_sales_financial_report', {
    p_date_from: `${year}-01-01`, p_date_to: `${year}-12-31`, p_company_ids: null,
  });
  if (error || !data || (data as Row).scope !== 'own_sales') {
    fail('Nie udało się pobrać Twojego raportu sprzedaży. Dane całej firmy nie są udostępniane w tym widoku.', 502);
  }
  return { report: data };
}

async function preferencesRow(ctx: NativeContext): Promise<Row> {
  const { data, error } = await ctx.supabase.from('employees').select('preferences').eq('id', ctx.employee.id).maybeSingle();
  if (error) fail('Błąd podczas wczytywania preferencji', 500);
  const preferences = (data as Row | null)?.preferences;
  return preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? preferences as Row : {};
}

/** Ustawienia dashboardu: zakres i sekcje (z opisami jak w Ustawieniach CRM). */
export async function dashboardPreferences(ctx: NativeContext) {
  const dashboard = (await preferencesRow(ctx)).dashboard as Row | undefined;
  const widgets = dashboard?.widgets && typeof dashboard.widgets === 'object' ? dashboard.widgets as Row : {};
  return {
    range: dashboard?.range === '12m' ? '12m' : dashboard?.range === '6m' ? '6m' : DEFAULT_DASHBOARD_RANGE,
    widgets: DASHBOARD_WIDGETS.map((widget) => ({
      id: widget.id, label: widget.label, description: widget.description, enabled: widgets[widget.id] !== false,
    })),
  };
}

/** „Zapisz dashboard” — tylko część `dashboard` preferencji (pozostałe ustawienia pracownika bez zmian). */
export async function saveDashboardPreferences(ctx: NativeContext, body: Row) {
  const input = body.widgets && typeof body.widgets === 'object' ? body.widgets as Row : {};
  const range: DashboardRange = body.range === '12m' ? '12m' : '6m';
  const widgets = Object.fromEntries(DASHBOARD_WIDGETS.map((widget) => [widget.id, input[widget.id] !== false]));
  const current = await preferencesRow(ctx);
  const previous = current.dashboard && typeof current.dashboard === 'object' && !Array.isArray(current.dashboard) ? current.dashboard as Row : {};
  const preferences = { ...current, dashboard: { ...previous, range, widgets } };
  const { data, error } = await ctx.supabase.from('employees').update({ preferences }).eq('id', ctx.employee.id).select('id');
  if (error || !rows(data).length) fail('Błąd podczas zapisywania ustawień', error ? 400 : 403);
  return { ok: true, message: 'Ustawienia zostały zapisane' };
}
