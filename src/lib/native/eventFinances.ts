import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventTab } from './eventTabs';
import { timeEntryCompanyRate } from '@/lib/personnel/compensation';
import { getOfferTotals, roundMoney } from '@/lib/CRM/Offers/offerTotals';
import { AUTOMATIC_COMMISSION_HINT, isAutomaticCommission } from '@/lib/CRM/events/commissionSettlements';

/**
 * Zakładka „Finanse” (`EventFinancesTab` + `EventFinancialControls`): sposób rozliczenia i terminy płatności, zamknięcie
 * wydarzenia, informacje o kliencie, podsumowanie, rentowność (plan / wykonanie, jakość danych), prowizje i polecenia,
 * faktury, koszty i budżet gotówkowy. Wszystkie wyliczenia jak w CRM — aplikacja tylko wyświetla gotowe wartości.
 */

type Row = Record<string, any>;
const NO_ACCESS = { canViewCosts: false, canManageCosts: false, canApproveCosts: false, canPlanCommissions: false, canApproveCommissions: false };
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function fail(message: string): never {
  throw new Error(message);
}

/** `checkAdminPermissions`: `get_event_finance_access`, a w starszej bazie — administrator / `finances_manage`. */
async function financeAccess(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_event_finance_access', { p_event_id: eventId });
  if (!error && data && typeof data === 'object') return { ...NO_ACCESS, ...(data as Partial<typeof NO_ACCESS>) };
  const manage = ctx.employee.role === 'admin' || ctx.employee.permissions.includes('finances_manage');
  return { canViewCosts: manage, canManageCosts: manage, canApproveCosts: manage, canPlanCommissions: manage, canApproveCommissions: manage };
}

/** Zaakceptowana kwota brutto (kalkulacja albo oferta / pakiet) — jak `load` w `EventFinancialControls`. */
async function acceptedGross(ctx: NativeContext, eventId: string, source: string | null): Promise<number | null> {
  const s = ctx.supabase;
  if (source === 'calculation') {
    const result = await s.from('event_calculations').select('event_calculation_items(quantity,unit_price,days,vat_rate)').eq('event_id', eventId).eq('is_accepted', true).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    return roundMoney(((result.data as Row).event_calculation_items || []).reduce((sum: number, item: Row) =>
      sum + roundMoney(Number(item.quantity) * Number(item.unit_price) * Number(item.days ?? 1) * (1 + Number(item.vat_rate ?? 23) / 100)), 0));
  }
  const result = await s.from('offers').select('subtotal,discount_amount,tax_amount,tax_percent,total_amount,logistics_enabled,logistics_price_net,totals_include_logistics,accepted_package_id')
    .eq('event_id', eventId).eq('status', 'accepted').order('accepted_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  const offer = result.data as Row | null;
  if (!offer) return null;
  if (offer.accepted_package_id) {
    const pack = await s.from('offer_packages').select('price_net').eq('id', offer.accepted_package_id).single();
    if (pack.error) throw pack.error;
    return roundMoney((Number((pack.data as Row).price_net) + (offer.logistics_enabled ? Number(offer.logistics_price_net || 0) : 0)) * (1 + Number(offer.tax_percent ?? 23) / 100));
  }
  return getOfferTotals(offer as any).gross;
}

const warsawDay = (value: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

async function controls(ctx: NativeContext, eventId: string, canManage: boolean) {
  const s = ctx.supabase;
  if (canManage) {
    const refreshed = await s.rpc('refresh_event_payment_plan', { p_event_id: eventId });
    if (refreshed.error && !['42883', 'PGRST202'].includes(refreshed.error.code || '')) console.error('[native finances] refresh plan', refreshed.error.message);
  }
  const [milestones, closeout, event] = await Promise.all([
    s.from('event_payment_milestones').select('*').eq('event_id', eventId).order('due_date'),
    s.from('event_closeouts').select('*').eq('event_id', eventId).maybeSingle(),
    s.from('events').select('event_date,financial_source').eq('id', eventId).maybeSingle(),
  ]);
  if (milestones.error) return { available: !['42P01', 'PGRST205'].includes(milestones.error.code ?? ''), milestones: [], closeout: null, eventDay: '', eventFinished: false, acceptedTotal: null, budgetError: null };
  let total: number | null = null;
  let budgetError: string | null = null;
  try {
    if (event.error) throw event.error;
    total = await acceptedGross(ctx, eventId, (event.data as Row | null)?.financial_source ?? null);
  } catch {
    budgetError = 'Nie udało się odczytać zaakceptowanej kwoty. Odśwież dane przed ustaleniem rozliczenia.';
  }
  const eventDate = (event.data as Row | null)?.event_date ?? null;
  const c = closeout.data as Row | null;
  return {
    available: true,
    milestones: (milestones.data || []).map((m: Row) => ({
      id: m.id, label: m.label || '', type: m.milestone_type || 'other', amount: num(m.amount), dueDate: m.due_date ?? null,
      dueDays: m.payment_due_days ?? null, status: m.status || 'planned', invoiceId: m.invoice_id ?? null, paidAmount: num(m.paid_amount),
      paidAt: m.paid_at ?? null, notes: m.notes ?? null, planMode: m.payment_plan_mode ?? null,
    })),
    closeout: c ? {
      id: c.id, equipment_returned: !!c.equipment_returned, vehicles_returned: !!c.vehicles_returned, damages_resolved: !!c.damages_resolved,
      subcontractors_settled: !!c.subcontractors_settled, employee_time_approved: !!c.employee_time_approved, client_balance_settled: !!c.client_balance_settled,
      documents_archived: !!c.documents_archived, completedAt: c.completed_at ?? null,
    } : null,
    eventDay: eventDate ? warsawDay(eventDate) : '',
    eventFinished: eventDate ? new Date(eventDate).getTime() < Date.now() : false,
    acceptedTotal: total, budgetError,
  };
}

async function financesTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const access = await financeAccess(ctx, eventId);
  const isAdmin = Boolean(access.canApproveCosts);
  const [summaryRes, sharedRes, invoicesRes, costsRes, categoriesRes, clientRes, offerRes, subcontractorsRes, timeRes, commissionsRes, assignmentsRes, personnelRes, sourceRes, cashRes, panel] = await Promise.all([
    s.rpc('get_event_financial_summary', { p_event_id: eventId }),
    s.rpc('get_event_shared_invoice_summary', { p_event_id: eventId }),
    s.from('event_invoice_settlements').select('*').eq('event_id', eventId).order('issue_date', { ascending: false }),
    s.from('event_costs').select('*, category:event_cost_categories(name, color), subcontractor:subcontractors(company_name), creator:created_by(name, surname)')
      .eq('event_id', eventId).order('cost_date', { ascending: false }),
    s.from('event_cost_categories').select('id,name').eq('is_active', true).order('name'),
    s.rpc('get_event_client_info', { p_event_id: eventId }),
    s.from('offers').select('total_amount, subtotal, discount_percent, discount_amount, tax_percent, tax_amount, created_by').eq('event_id', eventId).eq('status', 'accepted')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    s.from('subcontractor_tasks').select('id, agreed_cost, total_cost, status, payment_status').eq('event_id', eventId).neq('status', 'cancelled'),
    s.from('time_entries').select('id, duration_minutes, hourly_rate, compensation_snapshot, personnel_contract_id').eq('event_id', eventId).not('end_time', 'is', null),
    s.from('event_commissions').select('id, beneficiary_type, beneficiary_name, calculation_type, rate, base_amount, amount, payment_method, dividend_tax_rate, company_cost_amount, status, automatic_source')
      .eq('event_id', eventId).neq('status', 'cancelled').order('created_at', { ascending: false }),
    s.from('employee_assignments').select('employee_id').eq('event_id', eventId),
    s.rpc('personnel_event_cost', { p_event: eventId }),
    s.from('events').select('financial_source, accepted_calculation_id').eq('id', eventId).maybeSingle(),
    s.from('event_cash_transactions').select('*').eq('event_id', eventId).order('transaction_date', { ascending: false }),
    controls(ctx, eventId, isAdmin),
  ]);

  let summary: Row | null = (summaryRes.data as Row[] | null)?.[0] ?? null;
  const shared = (sharedRes.data as Row[] | null)?.[0];
  if (summary && shared) {
    const actualRevenue = num(shared.actual_invoice_revenue);
    const totalRevenue = actualRevenue + num(summary.actual_cash_revenue);
    const actualProfit = totalRevenue - num(summary.actual_costs);
    summary = {
      ...summary, actual_revenue: actualRevenue, actual_profit: actualProfit, profit_margin_actual: totalRevenue > 0 ? (actualProfit / totalRevenue) * 100 : 0,
      invoices_count: num(shared.invoices_count), invoices_paid_count: num(shared.invoices_paid_count), invoices_total: num(shared.invoices_total), total_revenue: totalRevenue,
    };
  }
  const offer = offerRes.data as Row | null;
  const offerTotals = offer ? getOfferTotals(offer as any) : null;
  const costs = (costsRes.data || []) as Row[];
  const subcontractors = (subcontractorsRes.data || []) as Row[];
  const timeEntries = (timeRes.data || []) as Row[];
  const commissions = (commissionsRes.data || []) as Row[];
  const personnel = personnelRes.data as Row | null;

  let salesperson: string | null = null;
  if (offer?.created_by) {
    const { data } = await s.from('employees').select('name, surname').eq('id', offer.created_by).maybeSingle();
    salesperson = data ? `${(data as Row).name ?? ''} ${(data as Row).surname ?? ''}`.trim() : null;
  }
  const source = (sourceRes.data as Row | null)?.financial_source === 'calculation' ? 'calculation' : 'offer';
  let calcName: string | null = null;
  if (source === 'calculation' && (sourceRes.data as Row | null)?.accepted_calculation_id) {
    const { data } = await s.from('event_calculations').select('name').eq('id', (sourceRes.data as Row).accepted_calculation_id).maybeSingle();
    calcName = (data as Row | null)?.name ?? null;
  }

  // Rentowność — te same reguły co w CRM.
  const expectedRevenue = offerTotals ? offerTotals.gross : num(summary?.expected_revenue);
  const actualRevenue = num(summary?.actual_revenue);
  const employeeCost = (cost: Row) => /personel|pracown|wynagrodz|pensj/i.test(cost.category?.name || '');
  const sum = (rows: Row[], pick: (row: Row) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const registeredPlanned = sum(costs.filter((c) => c.status !== 'rejected' && !c.subcontractor && !employeeCost(c)), (c) => num(c.amount));
  const registeredActual = sum(costs.filter((c) => ['approved', 'paid'].includes(c.status) && !c.subcontractor && !employeeCost(c)), (c) => num(c.amount));
  const plannedEmployeeRegister = sum(costs.filter((c) => c.status !== 'rejected' && employeeCost(c)), (c) => num(c.amount));
  const actualEmployee = sum(timeEntries.filter((e) => !e.personnel_contract_id), (e) => (num(e.duration_minutes) / 60) * timeEntryCompanyRate(e as any))
    + num(personnel?.confirmed) + num(personnel?.estimated);
  const plannedEmployee = plannedEmployeeRegister || actualEmployee;
  const covered: string[] = Array.isArray(personnel?.covered_subcontractor_tasks) ? personnel!.covered_subcontractor_tasks : [];
  const uncovered = subcontractors.filter((t) => !covered.includes(t.id));
  const plannedSubcontractors = sum(uncovered, (t) => num(t.agreed_cost || t.total_cost));
  const actualSubcontractors = sum(uncovered.filter((t) => t.payment_status === 'paid' || t.status === 'completed'), (t) => num(t.agreed_cost || t.total_cost));
  const hasSalesCommission = commissions.some((c) => c.beneficiary_type === 'salesperson');
  const plannedCommissions = sum(commissions.filter((c) => c.status !== 'cancelled'), (c) => num(c.company_cost_amount ?? c.amount));
  const actualCommissions = sum(commissions.filter((c) => ['approved', 'paid'].includes(c.status)), (c) => num(c.company_cost_amount ?? c.amount));
  const plannedTotal = registeredPlanned + plannedEmployee + plannedSubcontractors + plannedCommissions;
  const actualTotal = registeredActual + actualEmployee + actualSubcontractors + actualCommissions;
  const plannedProfit = expectedRevenue - plannedTotal;
  const actualProfit = actualRevenue - actualTotal;
  const missingSubcontractorCosts = subcontractors.filter((t) => num(t.agreed_cost || t.total_cost) <= 0).length;
  const missingRates = timeEntries.filter((e) => !e.personnel_contract_id && num(e.hourly_rate) <= 0).length;
  const assigned = new Set(((assignmentsRes.data || []) as Row[]).map((a) => a.employee_id)).size;
  const pendingCosts = costs.filter((c) => c.status === 'pending').length;
  const issues = [
    personnelRes.error ? 'Nie udało się pobrać kosztów umów personelu — wynik jest niepełny' : null,
    num(personnel?.incomplete) > 0 ? 'Nie wszystkie godziny personelu mają określony koszt firmy' : null,
    num(personnel?.foreign_currency) > 0 ? 'Koszty personelu w walucie obcej wymagają przeliczenia — nie dodano ich do PLN' : null,
    num(personnel?.estimated) > 0 ? 'Część kosztów personelu jest szacunkiem przed zatwierdzeniem rozliczenia' : null,
    missingSubcontractorCosts > 0 ? `${missingSubcontractorCosts} zleceń podwykonawców bez kosztu` : null,
    missingRates > 0 ? `${missingRates} wpisów czasu bez stawki` : null,
    assigned > 0 && timeEntries.length === 0 ? `${assigned} przypisanych pracowników bez zarejestrowanego czasu` : null,
    offer && !offer.created_by ? 'Oferta nie ma przypisanego autora / sprzedawcy' : null,
    offer?.created_by && !hasSalesCommission ? 'Nie zarejestrowano prowizji sprzedawcy' : null,
    commissionsRes.error ? 'Uruchom migrację rejestru prowizji' : null,
    pendingCosts > 0 ? `${pendingCosts} kosztów czeka na zatwierdzenie` : null,
  ].filter(Boolean);
  const client = (clientRes.data as Row[] | null)?.[0] ?? null;

  return {
    access: { ...access, isAdmin },
    client: client ? { type: client.client_type || '', name: client.client_name || '', nip: client.client_nip ?? null, business: !!client.is_business, canInvoice: !!client.can_invoice } : null,
    summary: summary ? {
      expectedRevenue: num(summary.expected_revenue), actualRevenue: num(summary.actual_revenue), actualCosts: num(summary.actual_costs), actualProfit: num(summary.actual_profit),
      invoicesCount: num(summary.invoices_count), invoicesPaid: num(summary.invoices_paid_count), costsCount: num(summary.costs_count), costsPaid: num(summary.costs_paid_count),
    } : null,
    offer: offerTotals ? { gross: offerTotals.gross, net: offerTotals.net, tax: offerTotals.taxAmount, taxPercent: offer?.tax_percent ?? 23 } : null,
    source, calcName,
    result: {
      expectedRevenue, actualRevenue, plannedTotal, actualTotal, plannedProfit, actualProfit,
      plannedMargin: expectedRevenue > 0 ? (plannedProfit / expectedRevenue) * 100 : 0, actualMargin: actualRevenue > 0 ? (actualProfit / actualRevenue) * 100 : 0,
    },
    rows: [
      { label: 'Pozostałe koszty', planned: registeredPlanned, actual: registeredActual, color: 'ef4444' },
      { label: 'Pracownicy', planned: plannedEmployee, actual: actualEmployee, color: '3b82f6' },
      { label: 'Podwykonawcy', planned: plannedSubcontractors, actual: actualSubcontractors, color: 'f59e0b' },
      { label: 'Prowizje (koszt dla spółki)', planned: plannedCommissions, actual: actualCommissions, color: '8b5cf6' },
    ],
    issues,
    commissionsAvailable: !commissionsRes.error, salesperson, hasSalesCommission, automaticHint: AUTOMATIC_COMMISSION_HINT,
    commissions: commissions.map((c) => ({
      id: c.id, type: c.beneficiary_type || 'other', name: c.beneficiary_name || '', calculation: c.calculation_type || 'fixed', rate: num(c.rate),
      amount: num(c.amount), companyCost: num(c.company_cost_amount ?? c.amount), status: c.status || 'planned', automatic: isAutomaticCommission(c as any),
    })),
    invoices: ((invoicesRes.data || []) as Row[]).map((i) => ({
      id: i.id, number: i.invoice_number || '', type: i.invoice_type || '', status: i.status || 'pending', issueDate: i.issue_date ?? null, gross: num(i.total_gross),
      buyer: i.buyer_name || '', arrangement: i.billing_arrangement ?? null, allocated: num(i.allocated_gross), shared: num(i.shared_event_count || 1),
    })),
    costs: costs.map((c) => ({
      id: c.id, name: c.name || '', description: c.description ?? null, amount: num(c.amount), date: c.cost_date ?? null, status: c.status || 'pending',
      category: c.category?.name ?? null, color: c.category?.color ?? null, subcontractor: c.subcontractor?.company_name ?? null,
      createdBy: c.creator ? `${c.creator.name ?? ''} ${c.creator.surname ?? ''}`.trim() : 'System',
    })),
    categories: ((categoriesRes.data || []) as Row[]).map((c) => ({ id: c.id, name: c.name || '' })),
    cash: ((cashRes.data || []) as Row[]).map((t) => ({
      id: t.id, date: t.transaction_date ?? null, amount: num(t.amount), description: t.description || '', income: t.transaction_type === 'income',
      confirmed: !!t.confirmed, handledBy: t.handled_by_name ?? null, notes: t.notes ?? null,
    })),
    controls: panel,
  };
}

registerEventTab('finances', financesTab);

const COST_STATUSES = ['pending', 'approved', 'paid', 'rejected'];

async function addCost(ctx: NativeContext, eventId: string, body: Row) {
  const access = await financeAccess(ctx, eventId);
  const name = String(body.name || '').trim();
  const amount = num(body.amount);
  const category = String(body.categoryId || '');
  if (!name || !category || amount <= 0) fail('Wypełnij wszystkie wymagane pola');
  const status = access.canApproveCosts && COST_STATUSES.includes(body.status) ? body.status : 'pending';
  const { error } = await ctx.supabase.from('event_costs').insert({
    event_id: eventId, name, description: String(body.description || ''), amount, cost_date: String(body.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    category_id: category, status, payment_method: String(body.paymentMethod || 'transfer'), created_by: ctx.employee.id,
  });
  if (error) fail(error.message || 'Błąd podczas dodawania kosztu');
  return { ok: true };
}

async function deleteCost(ctx: NativeContext, eventId: string, body: Row) {
  const { error } = await ctx.supabase.from('event_costs').delete().eq('id', String(body.id || '')).eq('event_id', eventId);
  if (error) fail(error.message || 'Błąd podczas usuwania kosztu');
  return { ok: true };
}

async function costStatus(ctx: NativeContext, eventId: string, body: Row) {
  if (!COST_STATUSES.includes(body.status)) fail('Nieprawidłowy status.');
  const { error } = await ctx.supabase.from('event_costs').update({ status: body.status }).eq('id', String(body.id || '')).eq('event_id', eventId);
  if (error) fail(error.message || 'Błąd podczas aktualizacji statusu');
  return { ok: true };
}

/** `handleAddCommission`: podstawa procentu — netto zaakceptowanej oferty albo przychód planowany. */
async function addCommission(ctx: NativeContext, eventId: string, body: Row) {
  const access = await financeAccess(ctx, eventId);
  const name = String(body.name || '').trim();
  if (!name) fail('Podaj beneficjenta prowizji');
  const percent = body.calculation === 'percent';
  const [offer, summary] = await Promise.all([
    ctx.supabase.from('offers').select('total_amount, subtotal, discount_percent, discount_amount, tax_percent, tax_amount').eq('event_id', eventId).eq('status', 'accepted')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.supabase.rpc('get_event_financial_summary', { p_event_id: eventId }),
  ]);
  const expected = offer.data ? getOfferTotals(offer.data as any).net : num((summary.data as Row[] | null)?.[0]?.expected_revenue);
  const base = percent ? expected : 0;
  const amount = percent ? (base * num(body.rate)) / 100 : num(body.amount);
  if (amount <= 0) fail('Kwota prowizji musi być większa od zera');
  const types = ['salesperson', 'hotel', 'partner', 'employee', 'other'];
  const { error } = await ctx.supabase.from('event_commissions').insert({
    event_id: eventId, beneficiary_type: types.includes(body.type) ? body.type : 'other', beneficiary_name: name, calculation_type: percent ? 'percent' : 'fixed',
    rate: percent ? num(body.rate) : 0, base_amount: base, amount,
    status: access.canApproveCommissions && ['planned', 'approved', 'paid'].includes(body.status) ? body.status : 'planned', created_by: ctx.employee.id,
  });
  if (error) fail(error.message || 'Nie udało się zapisać prowizji');
  return { ok: true };
}

async function commissionRow(ctx: NativeContext, eventId: string, id: string) {
  const { data } = await ctx.supabase.from('event_commissions').select('id,status,automatic_source').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!data) fail('Nie znaleziono prowizji.');
  return data as Row;
}

async function deleteCommission(ctx: NativeContext, eventId: string, body: Row) {
  const row = await commissionRow(ctx, eventId, String(body.id || ''));
  if (isAutomaticCommission(row as any)) fail('Prowizji z podsumowania wydarzenia nie usuwa się — możesz ją anulować.');
  const { error } = await ctx.supabase.from('event_commissions').delete().eq('id', row.id);
  if (error) fail(error.message || 'Nie udało się usunąć prowizji');
  return { ok: true };
}

/** `handleUpdateCommissionStatus`: wpis z podsumowania tylko anulowany (z powodem) albo przywrócony przez funkcję bazy. */
async function commissionStatus(ctx: NativeContext, eventId: string, body: Row) {
  const row = await commissionRow(ctx, eventId, String(body.id || ''));
  const status = String(body.status || '');
  if (!['planned', 'approved', 'paid', 'cancelled'].includes(status)) fail('Nieprawidłowy status.');
  if (isAutomaticCommission(row as any)) {
    const restoring = status === 'planned' && row.status === 'cancelled';
    if (status !== 'cancelled' && !restoring) fail(AUTOMATIC_COMMISSION_HINT);
    const reason = status === 'cancelled' ? String(body.reason || '').trim() : null;
    if (status === 'cancelled' && !reason) fail('Podaj powód anulowania prowizji.');
    const { error } = await ctx.supabase.rpc('set_event_commission_cancelled', { p_commission_id: row.id, p_cancel: status === 'cancelled', p_reason: reason });
    if (error) fail(error.message || 'Nie udało się zmienić statusu prowizji');
    return { ok: true };
  }
  const { error } = await ctx.supabase.from('event_commissions').update({ status }).eq('id', row.id);
  if (error) fail(error.message || 'Nie udało się zmienić statusu prowizji');
  return { ok: true };
}

async function requireManage(ctx: NativeContext, eventId: string) {
  const access = await financeAccess(ctx, eventId);
  if (!access.canApproveCosts) fail('Nie masz uprawnień do rozliczeń tego wydarzenia.');
}

/** `savePlan` → `set_event_payment_plan` (zaakceptowana kwota liczona tutaj, jak w CRM). */
async function setPlan(ctx: NativeContext, eventId: string, body: Row) {
  await requireManage(ctx, eventId);
  const { data: event } = await ctx.supabase.from('events').select('event_date,financial_source').eq('id', eventId).maybeSingle();
  const total = await acceptedGross(ctx, eventId, (event as Row | null)?.financial_source ?? null).catch(() => null);
  const mode = ['advance_balance', 'final_only', 'earnest_event'].includes(body.mode) ? body.mode : 'advance_balance';
  const amount = mode === 'final_only' ? 0 : Number(String(body.firstAmount || '').replace(',', '.'));
  const firstDate = String(body.firstDate || '');
  const eventDay = (event as Row | null)?.event_date ? warsawDay((event as Row).event_date) : '';
  const end = mode === 'earnest_event' ? eventDay : null;
  const daysText = String(body.finalDays ?? '').trim();
  const days = Number(daysText);
  if (total === null || total <= 0 || !Number.isFinite(amount) || (mode !== 'final_only' && (amount <= 0 || amount >= total || !firstDate))
    || (mode === 'earnest_event' ? !end || firstDate > end : !daysText || !Number.isInteger(days) || days < 0 || days > 3650)) {
    fail('Sprawdź kwotę i terminy. Zaliczka lub zadatek musi być mniejszy od całości, a termin końcowy musi być liczbą całych dni od wystawienia faktury (0–3650).');
  }
  const { error } = await ctx.supabase.rpc('set_event_payment_plan', {
    p_event_id: eventId, p_mode: mode, p_total: total, p_first_amount: amount, p_first_date: mode === 'final_only' ? null : firstDate,
    p_final_date: end, p_final_days: mode === 'earnest_event' ? null : days,
  });
  if (error) fail(error.message || 'Nie udało się zapisać rozliczenia.');
  return { ok: true };
}

async function addMilestone(ctx: NativeContext, eventId: string, body: Row) {
  await requireManage(ctx, eventId);
  const label = String(body.label || '').trim();
  const due = String(body.dueDate || '');
  if (!label || !due || num(body.amount) <= 0) fail('Podaj nazwę, kwotę i termin płatności');
  const { error } = await ctx.supabase.from('event_payment_milestones').insert({
    event_id: eventId, label, milestone_type: ['deposit', 'installment', 'balance', 'other'].includes(body.type) ? body.type : 'other', amount: num(body.amount),
    due_date: due, invoice_id: body.invoiceId || null, notes: String(body.notes || '').trim() || null,
  });
  if (error) fail(error.message);
  return { ok: true };
}

async function updateMilestone(ctx: NativeContext, eventId: string, body: Row) {
  await requireManage(ctx, eventId);
  const { data: milestone } = await ctx.supabase.from('event_payment_milestones').select('id,amount').eq('id', String(body.id || '')).eq('event_id', eventId).maybeSingle();
  if (!milestone) fail('Nie znaleziono płatności.');
  let patch: Row;
  switch (body.change) {
    case 'paid': patch = { paid_amount: (milestone as Row).amount, paid_at: new Date().toISOString() }; break;
    case 'waived': patch = { status: 'waived' }; break;
    case 'dueDate': patch = { due_date: String(body.value || '') || null }; break;
    case 'invoice': patch = { invoice_id: body.value || null }; break;
    default: fail('Nieznana zmiana.');
  }
  const { error } = await ctx.supabase.from('event_payment_milestones').update(patch).eq('id', (milestone as Row).id);
  if (error) fail(error.message);
  return { ok: true };
}

async function deleteMilestone(ctx: NativeContext, eventId: string, body: Row) {
  await requireManage(ctx, eventId);
  const { error } = await ctx.supabase.from('event_payment_milestones').delete().eq('id', String(body.id || '')).eq('event_id', eventId);
  if (error) fail(error.message);
  return { ok: true };
}

const CLOSEOUT_KEYS = ['equipment_returned', 'vehicles_returned', 'damages_resolved', 'subcontractors_settled', 'employee_time_approved', 'client_balance_settled', 'documents_archived'];

/** `toggleCloseout`: wpis zamknięcia tworzony przy pierwszym zaznaczeniu. */
async function closeout(ctx: NativeContext, eventId: string, body: Row) {
  await requireManage(ctx, eventId);
  const key = String(body.key || '');
  if (!CLOSEOUT_KEYS.includes(key)) fail('Nieznany punkt zamknięcia.');
  let { data: row } = await ctx.supabase.from('event_closeouts').select('*').eq('event_id', eventId).maybeSingle();
  if (!row) {
    const created = await ctx.supabase.from('event_closeouts').insert({ event_id: eventId }).select('*').single();
    if (created.error) fail(created.error.message);
    row = created.data;
  }
  const { error } = await ctx.supabase.from('event_closeouts').update({ [key]: !(row as Row)[key] }).eq('id', (row as Row).id);
  if (error) fail(error.message);
  return { ok: true };
}

registerEventActions('finances', {
  addCost, deleteCost, costStatus, addCommission, deleteCommission, commissionStatus, setPlan, addMilestone, updateMilestone, deleteMilestone, closeout,
});
