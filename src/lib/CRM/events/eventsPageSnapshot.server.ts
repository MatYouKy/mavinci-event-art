import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { fetchEventsInitialServer } from './eventsData.server';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { hasAnyFinanceCompanyLevel } from '@/lib/financeCompanyAccess';
import { usesOperationalStages } from './operationalStages';

export async function fetchEventsPageSnapshot() {
  const [initial, employee] = await Promise.all([fetchEventsInitialServer(), getCurrentEmployeeServerCached()]);
  const store = cookies();
  const db = createSupabaseServerClient({ getAll: () => store.getAll().map(c => ({ name: c.name, value: c.value })), set: (name, value, options) => store.set({ name, value, ...options }) });
  const payments: Record<string, any[]> = {};
  const operationalStates: Record<string, string> = {};
  if (!employee) return { ...initial, payments, operationalStates };
  const mine = await db.rpc('get_my_realizations');
  if (mine.error) throw mine.error;
  const merged = new Map<string, any>(initial.events.map(e => [e.id, e]));
  for (const row of mine.data || []) if (!merged.has(row.id)) merged.set(row.id, row);
  const events = Array.from(merged.values());
  const operational = usesOperationalStages(employee);
  const commercial = employee.role === 'admin' || employee.access_level === 'admin' ||
    ['events_manage', 'finances_manage', 'finances_view', 'offers_manage', 'offers_view'].some(p => employee.permissions?.includes(p))
    || hasAnyFinanceCompanyLevel((employee as { finance_company_access?: unknown }).finance_company_access, 'sales');
  for (let offset = 0; offset < events.length; offset += 100) {
    const ids = events.slice(offset, offset + 100).map(e => e.id);
    await Promise.all([
      (async () => {
        const result = await db.rpc('get_event_list_invoice_budgets', { p_event_ids: ids });
        if (result.error) throw result.error;
        const budgets = new Map((result.data || []).map((row: any) => [row.event_id, row.amounts]));
        for (const event of events.slice(offset, offset + 100)) {
          event.budget_visible = budgets.has(event.id);
          event.invoice_budget = budgets.get(event.id) || [];
        }
      })(),
      (async () => {
        if (!commercial) return;
        const [milestones, invoices] = await Promise.all([
          db.from('event_payment_milestones').select('event_id,invoice_id,amount,paid_amount,due_date,status,paid_at').in('event_id', ids),
          db.from('invoices').select('id,event_id,total_gross,payment_due_date,status,paid_date').in('event_id', ids),
        ]);
        if (milestones.error) throw milestones.error;
        if (invoices.error) throw invoices.error;
        const paid = new Set((invoices.data || []).filter(i => i.status === 'paid' || i.paid_date).map(i => i.id));
        for (const row of milestones.data || []) {
          if (row.invoice_id && paid.has(row.invoice_id)) continue;
          (payments[row.event_id] ??= []).push(row);
        }
        for (const row of invoices.data || []) {
          if (!['issued', 'sent', 'overdue'].includes(row.status) || row.paid_date || !row.event_id) continue;
          (payments[row.event_id] ??= []).push({ amount: row.total_gross, due_date: row.payment_due_date, status: row.status });
        }
      })(),
      (async () => {
        if (!operational) return;
        const result = await db.rpc('get_event_operational_states', { p_event_ids: ids });
        if (result.error) throw result.error;
        for (const row of result.data || []) operationalStates[row.event_id] = row.status;
      })(),
    ]);
  }
  if (operational) for (const row of mine.data || []) operationalStates[row.id] = row.operational_status;
  return { ...initial, events, payments, operationalStates };
}
export type EventsPageSnapshot = Awaited<ReturnType<typeof fetchEventsPageSnapshot>>;
