import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';
import { hasAnyFinanceCompanyLevel } from '@/lib/financeCompanyAccess';
import { usesOperationalStages, operationalFallback, OPERATIONAL_LABELS } from '@/lib/CRM/events/operationalStages';
import { fetchEventFinancialsMap } from '@/lib/CRM/events/eventFinancials';
import { fetchSalesColleagueEvents, salesColleagueSellerLabel } from '@/lib/CRM/events/salesColleagueEvents';
import { eventListState } from '@/lib/CRM/events/eventListState';

/*
 * Wydarzenia na Macu (`/crm/events`): ta sama lista co `fetchEventsPageSnapshot` (wiersze `events` widoczne przez RLS,
 * moje realizacje, budżety z faktur, płatności, kwoty z `event_financials`, etapy operacyjne, wydarzenia innych sprzedawców),
 * tokenem pracownika. Lista jest zbiorem synchronizowanym przyrostowo na dysk Maca (`events-list`).
 */

export const EVENTS_SET = 'events-list';

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const num = (value: unknown) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value));

/** Uprawnienia jak `canViewEventWorkspace` na Macu i przyciski listy w CRM. */
export function eventsAccess(ctx: NativeContext) {
  const e = ctx.employee;
  const has = (scope: string) => can(e, scope);
  return {
    canView: e.isAdmin || ['events_view', 'events_manage', 'events_create', 'events_view_planning', 'events_view_operational', 'calendar_view',
      'calendar_manage', 'calendar_view_accepted_only', 'equipment_manage'].some(has),
    canManage: has('events_manage'),
    canCreate: has('events_manage') || has('events_create'),
  };
}

async function employeeProfile(ctx: NativeContext) {
  const { data } = await ctx.supabase.from('employees').select('role,access_level,permissions,finance_company_access').eq('id', ctx.employee.id).maybeSingle();
  return (data || { role: ctx.employee.role, access_level: ctx.employee.accessLevel, permissions: ctx.employee.permissions }) as Row;
}

async function loadEvents(ctx: NativeContext): Promise<Item[]> {
  const db = ctx.supabase;
  const profile = await employeeProfile(ctx);
  const [list, mine] = await Promise.all([
    db.from('events').select(`*,
      organizations:organizations!events_organization_id_fkey(name, alias),
      contacts(first_name, last_name),
      event_categories(name, color),
      locations(name, formatted_address, address, city, postal_code),
      my_companies(id, name, legal_name)`).order('event_date', { ascending: true }),
    db.rpc('get_my_realizations'),
  ]);
  if (list.error) throw list.error;
  if (mine.error) throw mine.error;
  const merged = new Map<string, Row>((list.data || []).map((e: Row) => [String(e.id), e]));
  for (const row of (mine.data || []) as Row[]) if (!merged.has(String(row.id))) merged.set(String(row.id), row);
  const events = Array.from(merged.values());
  const operational = usesOperationalStages(profile);
  const commercial = profile.role === 'admin' || profile.access_level === 'admin'
    || ['events_manage', 'finances_manage', 'finances_view', 'offers_manage', 'offers_view'].some((p) => (profile.permissions || []).includes(p))
    || hasAnyFinanceCompanyLevel(profile.finance_company_access, 'sales');
  const payments: Record<string, Row[]> = {};
  const operationalStates: Record<string, string> = {};
  for (let offset = 0; offset < events.length; offset += 100) {
    const chunk = events.slice(offset, offset + 100);
    const ids = chunk.map((e) => e.id);
    await Promise.all([
      (async () => {
        const result = await db.rpc('get_event_list_invoice_budgets', { p_event_ids: ids });
        if (result.error) throw result.error;
        const budgets = new Map((result.data || []).map((row: Row) => [row.event_id, row.amounts]));
        for (const event of chunk) { event.budget_visible = budgets.has(event.id); event.invoice_budget = budgets.get(event.id) || []; }
      })(),
      (async () => {
        if (!commercial) return;
        const [milestones, invoices] = await Promise.all([
          db.from('event_payment_milestones').select('event_id,invoice_id,amount,paid_amount,due_date,status,paid_at').in('event_id', ids),
          db.from('invoices').select('id,event_id,total_gross,payment_due_date,status,paid_date').in('event_id', ids),
        ]);
        if (milestones.error) throw milestones.error;
        if (invoices.error) throw invoices.error;
        const paid = new Set((invoices.data || []).filter((i: Row) => i.status === 'paid' || i.paid_date).map((i: Row) => i.id));
        for (const row of (milestones.data || []) as Row[]) {
          if (row.invoice_id && paid.has(row.invoice_id)) continue;
          (payments[row.event_id] ??= []).push(row);
        }
        for (const row of (invoices.data || []) as Row[]) {
          if (!['issued', 'sent', 'overdue'].includes(row.status) || row.paid_date || !row.event_id) continue;
          (payments[row.event_id] ??= []).push({ amount: row.total_gross, due_date: row.payment_due_date, status: row.status });
        }
      })(),
      (async () => {
        const financials = await fetchEventFinancialsMap(db as any, ids);
        for (const event of chunk) {
          const row = financials.get(event.id);
          event.expected_revenue = row?.expected_revenue ?? event.expected_revenue ?? null;
          event.budget = row?.budget ?? event.budget ?? null;
        }
      })(),
      (async () => {
        if (!operational) return;
        const result = await db.rpc('get_event_operational_states', { p_event_ids: ids });
        if (result.error) throw result.error;
        for (const row of (result.data || []) as Row[]) operationalStates[row.event_id] = row.status;
      })(),
    ]);
  }
  if (operational) for (const row of (mine.data || []) as Row[]) operationalStates[row.id] = row.operational_status;
  const items: Item[] = events.map((event) => {
    const status = text(event.status) || 'inquiry';
    const display = operational ? operationalStates[event.id] || operationalFallback(status) : status;
    const state = operational
      ? { state: display === 'settled' ? 'settled' : display === 'in_progress' ? 'live' : display === 'cancelled' ? 'cancelled' : 'scheduled', label: OPERATIONAL_LABELS[display] || 'Nowe wydarzenie', days: 0 }
      : eventListState(event, payments[event.id] || []);
    const budgets = Array.isArray(event.invoice_budget) ? event.invoice_budget : [];
    const loc = event.locations as Row | null;
    return {
      id: String(event.id),
      item: {
        id: String(event.id), name: text(event.name), description: text(event.description),
        date: event.event_date || null, endDate: event.event_end_date || null, createdAt: event.created_at || null,
        status, displayStatus: display, operationalLabel: operational ? OPERATIONAL_LABELS[display] || '' : '',
        state: state.state, stateLabel: state.label, stateDays: state.days,
        categoryId: event.category_id || null, categoryName: text(event.event_categories?.name), categoryColor: text(event.event_categories?.color),
        organization: text(event.organizations?.name), organizationAlias: text(event.organizations?.alias),
        contact: [event.contacts?.first_name, event.contacts?.last_name].filter(Boolean).join(' '),
        location: text(event.location), locationName: text(loc?.name), locationAddress: text(loc?.formatted_address || loc?.address),
        locationCity: text(loc?.city), locationPostal: text(loc?.postal_code),
        myCompany: text(event.my_companies?.name || event.my_companies?.legal_name),
        budgetVisible: event.budget_visible === true,
        budgets: budgets.map((b: Row) => ({ currency: text(b.currency) || 'PLN', amount: num(b.amount) ?? 0 })),
        expectedRevenue: num(event.expected_revenue), budget: num(event.budget),
        salesColleague: false, salesColleagueSeller: '',
      },
    };
  });
  const colleagues = await fetchSalesColleagueEvents(db as any);
  for (const row of colleagues) {
    if (merged.has(row.id)) continue;
    items.push({
      id: row.id,
      item: {
        id: row.id, name: row.name, description: '', date: row.event_date, endDate: row.event_end_date, createdAt: null,
        status: row.status || 'inquiry', displayStatus: row.status || 'inquiry', operationalLabel: '', state: 'scheduled', stateLabel: '', stateDays: 0,
        categoryId: row.category?.id ?? null, categoryName: text(row.category?.name), categoryColor: text(row.category?.color),
        organization: text(row.client_name), organizationAlias: '', contact: '', location: text(row.location), locationName: '',
        locationAddress: '', locationCity: '', locationPostal: '', myCompany: '', budgetVisible: false, budgets: [], expectedRevenue: null,
        budget: null, salesColleague: true, salesColleagueSeller: salesColleagueSellerLabel(row) || '',
      },
    });
  }
  return items;
}

export const eventsState = (ctx: NativeContext, hash?: string) => collectionState(ctx, EVENTS_SET, loadEvents, hash);
export const eventsItems = (ctx: NativeContext, buckets: unknown[]) => collectionItems(ctx, EVENTS_SET, loadEvents, buckets);
export const invalidateEvents = () => invalidateNativeSync([EVENTS_SET]);

/** Kategorie wydarzeń (filtr listy) i ustawienia listy: etapy operacyjne zamiast statusów, widoczność kwot. */
export async function eventsMeta(ctx: NativeContext) {
  const [categories, profile] = await Promise.all([
    ctx.supabase.from('event_categories').select('id,name,color').order('name', { ascending: true }),
    employeeProfile(ctx),
  ]);
  return {
    categories: (categories.data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name), color: text(row.color) })),
    operational: usesOperationalStages(profile),
  };
}
