'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Banknote, Building2, CalendarDays, Loader2, Scissors, Search, UserRound } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  CommissionPaymentMethod,
  CommissionStatus,
  commissionPaymentLabels,
  commissionStatusLabels,
  formatCommissionMoney,
} from '@/lib/CRM/events/eventCommission';
import { supabase } from '@/lib/supabase/browser';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { AUTOMATIC_COMMISSION_HINT, isAutomaticCommission } from '@/lib/CRM/events/commissionSettlements';
import {
  COMMISSION_ENTRY_KIND_LABELS,
  COMMISSION_SOURCE_LABELS,
  formatPercent,
  type CommissionEntryKind,
} from '@/lib/events/settlement/eventSettlement';

const REGISTER_COLUMNS =
  'id,sales_partner_id,beneficiary_name,employee_id,contact_id,organization_id,amount,company_cost_amount,status,payment_method,due_date,paid_at,created_at,event:events!inner(id,name,event_date,my_company_id)';
/** Pola podsumowania wydarzenia (migracja 20261105130000). */
const SETTLEMENT_COLUMNS = 'entry_kind,automatic_source,base_description,rate,base_amount,rate_reason,auto_cancelled,cancel_reason';

type RegisterCommission = {
  id: string;
  sales_partner_id: string | null;
  beneficiary_name: string;
  employee_id: string | null;
  contact_id: string | null;
  organization_id: string | null;
  amount: number;
  company_cost_amount: number | null;
  status: CommissionStatus;
  payment_method: CommissionPaymentMethod;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  entry_kind?: CommissionEntryKind | null;
  automatic_source?: string | null;
  base_description?: string | null;
  rate?: number | null;
  base_amount?: number | null;
  rate_reason?: string | null;
  /** Anulowana przez podsumowanie (nie ręcznie) — bez przycisku „Przywróć”. */
  auto_cancelled?: boolean | null;
  /** Powód ręcznego anulowania prowizji z podsumowania. */
  cancel_reason?: string | null;
  event: {
    id: string;
    name: string;
    event_date: string | null;
    my_company_id: string | null;
  } | null;
};

type BeneficiarySummary = {
  key: string;
  name: string;
  profileHref: string | null;
  commissionCount: number;
  payable: number;
  paid: number;
  companyCost: number;
  toOffset: number;
};

export default function CommissionRegisterPanel({
  filterCompanyIds,
  canManage,
}: {
  filterCompanyIds?: string[] | null;
  canManage: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const { access, loading: accessLoading, error: accessError } = useInvoiceFinanceAccess();
  const isSalesView = access?.scope === 'sales';
  const canEditCommissions = Boolean(canManage && access?.canManageCompanyFinance);
  const loadRevision = useRef(0);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<RegisterCommission[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CommissionStatus>('all');
  // Rozliczenia wpisów: total = przelewy i potrącenia (saldo), cash = tylko przelewy / wypłaty (bez potrąceń).
  const [paidById, setPaidById] = useState<Record<string, { total: number; cash: number }>>({});
  // Potrącenie: wpis do potrącenia, wybrana prowizja i stały klucz operacji (bezpieczne ponowienie).
  const [deducting, setDeducting] = useState<{ id: string; target: string; key: string } | null>(null);
  const [settlingDeduction, setSettlingDeduction] = useState(false);

  const loadCommissions = useCallback(async () => {
    const revision = ++loadRevision.current;
    setCommissions([]);
    setLoadError(null);
    if (!access || access.scope === 'none') {
      setLoading(false);
      return;
    }
    setLoading(true);
    let conditions: string[] = [];
    if (access.scope === 'sales') {
      const partnerIds = access.managedSellerPartnerIds;
      const contactIds = access.managedSellerContactIds;
      conditions = [
        ...(partnerIds.length ? [`sales_partner_id.in.(${partnerIds.join(',')})`] : []),
        ...(contactIds.length ? [`and(sales_partner_id.is.null,contact_id.in.(${contactIds.join(',')}))`] : []),
      ];
      if (!conditions.length) {
        setLoading(false);
        return;
      }
    }
    const runQuery = (columns: string) => {
      let query = supabase.from('event_commissions').select(columns).order('created_at', { ascending: false });
      if (conditions.length) query = query.or(conditions.join(','));
      if (filterCompanyIds?.length) query = query.in('event.my_company_id', filterCompanyIds);
      return query;
    };
    // Starsza baza (bez pól podsumowania) — dotychczasowe kolumny.
    let { data, error } = await runQuery(`${REGISTER_COLUMNS},${SETTLEMENT_COLUMNS}`);
    if (error && ['42703', 'PGRST204'].includes(error.code || '')) ({ data, error } = await runQuery(REGISTER_COLUMNS));
    if (revision !== loadRevision.current) return;

    if (error) {
      const missingSchema = error.message?.includes('company_cost_amount');
      setAvailable(!missingSchema);
      setLoadError('Nie udało się odczytać prowizji w Twoim zakresie dostępu.');
      if (!missingSchema) console.error('Error loading commission register:', error);
      setCommissions([]);
    } else {
      const rows = (data || []) as unknown as RegisterCommission[];
      // Wypłaty i potrącenia (is_offset) wpisów zatwierdzonych i wypłaconych — saldo, wypłacono i do potrącenia.
      const settledIds = rows.filter((row) => row.status === 'approved' || row.status === 'paid').map((row) => row.id);
      const paid: Record<string, { total: number; cash: number }> = {};
      let paidKnown = true;
      for (let index = 0; index < settledIds.length; index += 100) {
        const chunk = settledIds.slice(index, index + 100);
        let payouts = await supabase.from('event_commission_payouts').select('commission_id,amount,is_offset').in('commission_id', chunk);
        if (payouts.error && ['42703', 'PGRST204'].includes(payouts.error.code || '')) {
          payouts = await supabase.from('event_commission_payouts').select('commission_id,amount').in('commission_id', chunk);
        }
        if (payouts.error) {
          paidKnown = false;
          break;
        }
        for (const payout of (payouts.data || []) as { commission_id: string; amount: number; is_offset?: boolean }[]) {
          const entry = paid[payout.commission_id] || { total: 0, cash: 0 };
          entry.total += Number(payout.amount || 0);
          if (!payout.is_offset) entry.cash += Number(payout.amount || 0);
          paid[payout.commission_id] = entry;
        }
      }
      if (revision !== loadRevision.current) return;
      setAvailable(true);
      setPaidById(paidKnown ? paid : {});
      setCommissions(rows);
    }
    setLoading(false);
  }, [access, filterCompanyIds]);

  useEffect(() => {
    if (accessLoading) return;
    void loadCommissions();
    return () => { loadRevision.current += 1; };
  }, [accessLoading, loadCommissions]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pl');
    return commissions.filter((commission) => {
      if (!access || access.scope === 'none') return false;
      if (access.scope === 'sales') {
        const owned = commission.sales_partner_id
          ? access.managedSellerPartnerIds.includes(commission.sales_partner_id)
          : Boolean(commission.contact_id && access.managedSellerContactIds.includes(commission.contact_id));
        if (!owned) return false;
      }
      if (
        filterCompanyIds?.length
        && commission.event?.my_company_id
        && !filterCompanyIds.includes(commission.event.my_company_id)
      ) return false;
      if (statusFilter !== 'all' && commission.status !== statusFilter) return false;
      if (
        normalizedSearch
        && !`${commission.beneficiary_name} ${commission.event?.name || ''}`
          .toLocaleLowerCase('pl')
          .includes(normalizedSearch)
      ) return false;
      return true;
    });
  }, [commissions, filterCompanyIds, search, statusFilter, access]);

  const active = filtered.filter((commission) => commission.status !== 'cancelled');
  const isDeduction = (commission: RegisterCommission) => commission.entry_kind === 'deduction';
  const fallbackPaid = (commission: RegisterCommission) => (commission.status === 'paid' ? Number(commission.amount || 0) : 0);
  /** Rozliczono (przelewy i potrącenia razem). */
  const paidOf = (commission: RegisterCommission) => paidById[commission.id]?.total ?? fallbackPaid(commission);
  /** Wypłacono przelewem / wypłatą (bez potrąceń). */
  const cashOf = (commission: RegisterCommission) => paidById[commission.id]?.cash ?? fallbackPaid(commission);
  /** Naliczenie: do wypłaty; potrącenie: ile jeszcze do potrącenia. */
  const remainingOf = (commission: RegisterCommission) =>
    commission.status === 'approved' ? Math.max(0, Number(commission.amount || 0) - paidOf(commission)) : 0;
  // Do wypłaty: zatwierdzone minus rozliczenia, pomniejszone o otwarte potrącenia. „Wypłacono” — tylko przelewy
  // (zapis potrącenia nie jest gotówką). Prognoza (planowane) pokazana osobno.
  const sumRows = (rows: RegisterCommission[]) => {
    let payable = 0;
    let toOffset = 0;
    let paid = 0;
    let planned = 0;
    let companyCost = 0;
    for (const commission of rows) {
      const cost = Number(commission.company_cost_amount ?? commission.amount ?? 0);
      if (isDeduction(commission)) {
        toOffset += remainingOf(commission);
        companyCost -= cost;
        continue;
      }
      if (commission.status === 'planned') planned += Number(commission.amount || 0);
      payable += remainingOf(commission);
      paid += cashOf(commission);
      companyCost += cost;
    }
    return { payable: Math.max(0, payable - toOffset), toOffset, paid, planned, companyCost };
  };
  const totals = sumRows(active);

  const groupedBeneficiaries = new Map<string, { summary: BeneficiarySummary; rows: RegisterCommission[] }>();
  active.forEach((commission) => {
    const key = commission.employee_id
      ? `employee:${commission.employee_id}`
      : commission.contact_id
        ? `contact:${commission.contact_id}`
        : commission.organization_id
          ? `organization:${commission.organization_id}`
          : `manual:${commission.beneficiary_name.toLocaleLowerCase('pl')}`;
    const profileHref = commission.employee_id
      ? `/crm/employees/${commission.employee_id}`
      : commission.contact_id
        ? `/crm/contacts/${commission.contact_id}`
        : commission.organization_id
          ? `/crm/contacts/${commission.organization_id}`
          : null;
    const current = groupedBeneficiaries.get(key) || {
      summary: { key, name: commission.beneficiary_name, profileHref, commissionCount: 0, payable: 0, paid: 0, companyCost: 0, toOffset: 0 },
      rows: [],
    };
    current.summary.commissionCount += 1;
    current.rows.push(commission);
    groupedBeneficiaries.set(key, current);
  });
  const beneficiaries = [...groupedBeneficiaries.values()]
    .map(({ summary, rows }) => {
      const sums = sumRows(rows);
      return { ...summary, payable: sums.payable, paid: sums.paid, companyCost: sums.companyCost, toOffset: sums.toOffset };
    })
    .sort((a, b) => b.payable - a.payable || a.name.localeCompare(b.name, 'pl'));

  /** Prowizje, z których można potrącić: zatwierdzone, ta sama osoba, marka i sposób wypłaty, z kwotą do wypłaty (potrącenie może być częściowe). */
  const deductionTargets = (deduction: RegisterCommission) => commissions.filter((commission) =>
    commission.id !== deduction.id
    && !isDeduction(commission)
    && commission.status === 'approved'
    && ((deduction.sales_partner_id && commission.sales_partner_id === deduction.sales_partner_id)
      || (Boolean(deduction.contact_id) && commission.contact_id === deduction.contact_id)
      || (!deduction.sales_partner_id && !commission.sales_partner_id && Boolean(deduction.employee_id) && commission.employee_id === deduction.employee_id))
    && (commission.event?.my_company_id ?? null) === (deduction.event?.my_company_id ?? null)
    // Ten sam sposób wypłaty — chyba że to nadpłata z tego samego wydarzenia (np. wpis ręczny tej osoby).
    && (commission.payment_method === deduction.payment_method || (commission.event?.id ?? null) === (deduction.event?.id ?? null))
    && remainingOf(commission) > 0);

  const settleDeduction = async () => {
    if (!deducting || !deducting.target || settlingDeduction || !canEditCommissions) return;
    setSettlingDeduction(true);
    const { data, error } = await supabase.rpc('settle_commission_deduction', {
      p_deduction_id: deducting.id,
      p_target_id: deducting.target,
      p_idempotency_key: deducting.key,
    });
    setSettlingDeduction(false);
    if (error) {
      showSnackbar(
        ['PGRST202', '42883'].includes(error.code || '')
          ? 'Potrącenia wymagają aktualizacji bazy danych.'
          : error.message || 'Nie udało się zapisać potrącenia. Ponowienie nie zapisze go drugi raz.',
        'error',
        8000,
      );
      return;
    }
    setDeducting(null);
    showSnackbar(
      data?.duplicate ? 'To potrącenie było już zapisane.' : `Potrącono ${formatCommissionMoney(Number(data?.amount ?? 0))} — saldo pomniejszone, bez przelewu.`,
      'success',
    );
    await loadCommissions();
  };

  const updateStatus = async (commissionId: string, status: CommissionStatus) => {
    if (!canEditCommissions) return;
    const current = commissions.find((commission) => commission.id === commissionId);
    // Prowizja z podsumowania: anulowanie / przywrócenie przez set_event_commission_cancelled (undefined = wpis ręczny).
    let automaticReason: string | null | undefined;
    // Wpis z podsumowania: tylko anulowanie i przywrócenie anulowanego (zatwierdzenie i wypłata — podsumowanie i rejestr wypłat).
    if (current && isAutomaticCommission(current)) {
      const restoring = status === 'planned' && current.status === 'cancelled';
      if (status !== 'cancelled' && !restoring) {
        showSnackbar(AUTOMATIC_COMMISSION_HINT, 'info');
        return;
      }
      // Anulowanie (zawsze z powodem) i przywrócenie: finanse / administrator, przez funkcję w bazie.
      automaticReason = null;
      if (status === 'cancelled') {
        const reason = window.prompt('Powód anulowania prowizji z podsumowania. Anulowanie jest trwałe — zatwierdzenie podsumowania jej nie przywróci (możesz ją przywrócić ręcznie).');
        if (reason === null) return;
        if (!reason.trim()) {
          showSnackbar('Podaj powód anulowania prowizji.', 'warning');
          return;
        }
        automaticReason = reason.trim();
      }
    }
    const { error } = automaticReason !== undefined
      ? await supabase.rpc('set_event_commission_cancelled', {
          p_commission_id: commissionId,
          p_cancel: status === 'cancelled',
          p_reason: automaticReason,
        })
      : await supabase.from('event_commissions').update({ status }).eq('id', commissionId);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zmienić statusu prowizji', 'error');
      return;
    }
    await loadCommissions();
  };

  if (accessLoading) {
    return <div className="p-5 text-sm text-[#e5e4e2]/60">Sprawdzanie dostępu do prowizji…</div>;
  }
  if (accessError || !access || access.scope === 'none') {
    return <div role="alert" className="p-5 text-sm text-[#e5e4e2]/70">{accessError || 'Brak dostępu do rejestru prowizji.'}</div>;
  }
  if (loading) {
    return <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#d3bb73]" /></div>;
  }

  if (!available) {
    return (
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm text-amber-100/80">
        Rejestr prowizji będzie dostępny po uruchomieniu najnowszej migracji bazy danych.
      </div>
    );
  }
  if (loadError) {
    return <div role="alert" className="p-5 text-sm text-[#e5e4e2]/70">{loadError}</div>;
  }

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${isSalesView ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        <div className="rounded-xl border border-violet-300/15 bg-[#1c1f33] p-5">
          <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/40">Do wypłaty sprzedawcom</p>
          <p className="mt-2 text-2xl text-violet-200">{formatCommissionMoney(totals.payable)}</p>
          <p className="mt-1 text-[11px] text-[#e5e4e2]/40">Zatwierdzone, po odjęciu wypłat i potrąceń{totals.planned > 0 ? ` · prognoza: ${formatCommissionMoney(totals.planned)}` : ''}</p>
          {totals.toOffset > 0 && <p className="mt-1 text-[11px] text-rose-200/80">Do potrącenia: {formatCommissionMoney(totals.toOffset)}</p>}
        </div>
        <div className="rounded-xl border border-emerald-300/15 bg-[#1c1f33] p-5">
          <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/40">Wypłacono</p>
          <p className="mt-2 text-2xl text-emerald-300">{formatCommissionMoney(totals.paid)}</p>
        </div>
        {!isSalesView && <div className="rounded-xl border border-amber-300/15 bg-[#1c1f33] p-5">
          <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/40">Łączny koszt dla spółki</p>
          <p className="mt-2 text-2xl text-amber-200">{formatCommissionMoney(totals.companyCost)}</p>
        </div>}
      </div>

      <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-5">
          <div className="flex items-center gap-3">
            <UserRound className="h-5 w-5 text-[#d3bb73]" />
            <div>
              <h2 className="font-medium text-[#e5e4e2]">{isSalesView ? 'Sprzedawcy pod Twoją opieką' : 'Sprzedawcy i osoby polecające'}</h2>
              <p className="mt-1 text-xs text-[#e5e4e2]/40">{isSalesView ? 'Tylko prowizje kontaktów, których jesteś opiekunem. Brak dostępu do pozostałych rozliczeń firmy.' : 'Saldo według osoby, niezależnie od tego, czy jest pracownikiem, czy kontaktem hotelowym.'}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {beneficiaries.map((beneficiary) => {
            const content = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[#e5e4e2]">{beneficiary.name}</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/35">{beneficiary.commissionCount} naliczeń</p>
                  </div>
                  {beneficiary.profileHref && <UserRound className="h-4 w-4 shrink-0 text-[#d3bb73]/60" />}
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <span className="text-xs text-[#e5e4e2]/40">do wypłaty</span>
                  <span className="text-base text-violet-200">{formatCommissionMoney(beneficiary.payable)}</span>
                </div>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <span className="text-xs text-[#e5e4e2]/40">wypłacono</span>
                  <span className="text-xs text-emerald-300/80">{formatCommissionMoney(beneficiary.paid)}</span>
                </div>
                {beneficiary.toOffset > 0 && (
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <span className="text-xs text-[#e5e4e2]/40">do potrącenia</span>
                    <span className="text-xs text-rose-200/80">{formatCommissionMoney(beneficiary.toOffset)}</span>
                  </div>
                )}
              </>
            );
            return beneficiary.profileHref ? (
              <Link key={beneficiary.key} href={beneficiary.profileHref} className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4 transition-colors hover:border-[#d3bb73]/25">
                {content}
              </Link>
            ) : (
              <div key={beneficiary.key} className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">{content}</div>
            );
          })}
          {beneficiaries.length === 0 && <p className="py-8 text-center text-sm text-[#e5e4e2]/35 md:col-span-2 xl:col-span-3">Brak beneficjentów dla wybranego zakresu.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d3bb73]/10 p-5">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="font-medium text-[#e5e4e2]">Wszystkie naliczenia</h2>
          </div>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <div className="relative min-w-60 max-w-md flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#e5e4e2]/30" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj osoby lub wydarzenia..." className="w-full rounded-lg border border-white/10 bg-[#0a0d1a] py-2 pl-9 pr-3 text-sm text-[#e5e4e2] outline-none" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | CommissionStatus)} className="rounded-lg border border-white/10 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2]">
              <option value="all">Wszystkie statusy</option>
              <option value="planned">Planowane</option>
              <option value="approved">Zatwierdzone</option>
              <option value="paid">Wypłacone</option>
              <option value="cancelled">Anulowane</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-white/5">
          {filtered.map((commission) => {
            const deduction = isDeduction(commission);
            const automatic = isAutomaticCommission(commission);
            const kind = commission.entry_kind && commission.entry_kind !== 'accrual' ? commission.entry_kind : null;
            const source = commission.automatic_source ? COMMISSION_SOURCE_LABELS[commission.automatic_source] || null : null;
            const paid = paidOf(commission);
            const cash = cashOf(commission);
            const offset = Math.max(paid - cash, 0);
            const canCancelAutomatic = automatic && !deduction && (commission.status === 'planned' || commission.status === 'approved') && paid === 0;
            const canRestoreAutomatic = automatic && !kind && commission.status === 'cancelled' && !commission.auto_cancelled;
            const picking = deducting?.id === commission.id ? deducting : null;
            const targets = picking ? deductionTargets(commission) : [];
            return (
              <div key={commission.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-[#e5e4e2]">{commission.beneficiary_name}</p>
                    <Link href={commission.event?.id ? `/crm/events/${commission.event.id}?tab=overview` : '#'} className="mt-1 flex items-center gap-2 text-xs text-[#d3bb73]/70 hover:text-[#d3bb73]">
                      <CalendarDays className="h-3 w-3" />
                      {commission.event?.name || 'Wydarzenie'}
                      {commission.event?.event_date && ` · ${new Date(commission.event.event_date).toLocaleDateString('pl-PL')}`}
                    </Link>
                    {(kind || source) && (
                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        {kind && <span className={`rounded px-1.5 py-0.5 text-[10px] ${kind === 'deduction' ? 'bg-rose-400/15 text-rose-200' : 'bg-emerald-300/15 text-emerald-200'}`}>{COMMISSION_ENTRY_KIND_LABELS[kind]}</span>}
                        {source && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[#e5e4e2]/55">{source}</span>}
                      </p>
                    )}
                    {commission.base_description && <p className="mt-1 text-xs text-[#e5e4e2]/45">{commission.base_description}</p>}
                    {!kind && commission.rate != null && Number(commission.rate) > 0 && commission.base_amount != null && (
                      <p className="mt-0.5 text-[11px] text-[#e5e4e2]/40">
                        {formatPercent(Number(commission.rate))} od {formatCommissionMoney(Number(commission.base_amount))}
                        {commission.rate_reason ? ` · ${commission.rate_reason}` : ''}
                      </p>
                    )}
                    {commission.status === 'cancelled' && commission.cancel_reason && (
                      <p className="mt-0.5 text-[11px] text-[#e5e4e2]/45">Powód anulowania: {commission.cancel_reason}</p>
                    )}
                    {automatic && commission.event?.id && (
                      <Link href={`/crm/events/${commission.event.id}?tab=summary`} className="mt-1 inline-block text-[11px] text-[#d3bb73]/80 hover:text-[#d3bb73]">
                        Wyliczenie: zakładka Podsumowanie
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="text-right">
                      <p className={`text-sm ${deduction ? 'text-rose-200' : 'text-violet-200'}`}>{deduction ? '−' : ''}{formatCommissionMoney(Number(commission.amount || 0))}</p>
                      {cash > 0 && !deduction && commission.status === 'approved' && (
                        <p className="text-[11px] text-emerald-300/70">wypłacono {formatCommissionMoney(cash)}</p>
                      )}
                      {(deduction ? paid : offset) > 0 && (
                        <p className="text-[11px] text-[#e5e4e2]/50">potrącono {formatCommissionMoney(deduction ? paid : offset)}</p>
                      )}
                      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#e5e4e2]/35">
                        {commission.organization_id && <Building2 className="h-3 w-3" />}
                        {commissionPaymentLabels[commission.payment_method || 'invoice']}
                      </p>
                    </div>
                    {deduction ? (
                      canEditCommissions && commission.status === 'approved' && remainingOf(commission) > 0 ? (
                        <button
                          type="button"
                          disabled={Boolean(deducting) || settlingDeduction}
                          onClick={() => setDeducting({ id: commission.id, target: '', key: crypto.randomUUID() })}
                          className="inline-flex items-center gap-1.5 rounded bg-rose-400/10 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-400/20 disabled:opacity-40"
                        >
                          <Scissors className="h-3.5 w-3.5" />
                          Potrąć z prowizji
                        </button>
                      ) : (
                        <span className="rounded bg-white/5 px-2 py-1 text-xs text-[#e5e4e2]/45">
                          {commission.status === 'approved' ? 'Do potrącenia' : commission.status === 'paid' ? 'Potrącone' : commissionStatusLabels[commission.status]}
                        </span>
                      )
                    ) : canEditCommissions && !automatic ? (
                      <select value={commission.status} onChange={(event) => updateStatus(commission.id, event.target.value as CommissionStatus)} className="rounded border border-white/10 bg-[#0a0d1a] px-2 py-1.5 text-xs text-[#e5e4e2]/70">
                        <option value="planned">Planowana</option>
                        <option value="approved">Zatwierdzona</option>
                        <option value="paid">Wypłacona</option>
                        <option value="cancelled">Anulowana</option>
                      </select>
                    ) : canEditCommissions && canRestoreAutomatic ? (
                      <button
                        type="button"
                        onClick={() => updateStatus(commission.id, 'planned')}
                        title="Przywróć prowizję — kwotę ustali podsumowanie wydarzenia"
                        className="rounded bg-[#d3bb73]/10 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20"
                      >
                        Przywróć
                      </button>
                    ) : canEditCommissions && canCancelAutomatic ? (
                      <select value={commission.status} title={AUTOMATIC_COMMISSION_HINT} onChange={(event) => updateStatus(commission.id, event.target.value as CommissionStatus)} className="rounded border border-white/10 bg-[#0a0d1a] px-2 py-1.5 text-xs text-[#e5e4e2]/70">
                        <option value={commission.status}>{commissionStatusLabels[commission.status]}</option>
                        <option value="cancelled">Anulowana</option>
                      </select>
                    ) : (
                      <span className="rounded bg-white/5 px-2 py-1 text-xs text-[#e5e4e2]/45">{commissionStatusLabels[commission.status]}</span>
                    )}
                  </div>
                </div>
                {automatic && !deduction && commission.status === 'planned' && (
                  <p className="mt-1.5 text-[11px] text-[#e5e4e2]/40">{AUTOMATIC_COMMISSION_HINT}</p>
                )}
                {picking && (
                  <div className="mt-3 rounded-lg bg-black/20 p-3">
                    <p className="text-xs text-[#e5e4e2]/70">
                      Do potrącenia: {formatCommissionMoney(remainingOf(commission))}. Wybierz zatwierdzoną prowizję tej samej osoby, marki i sposobu wypłaty — baza potrąci mniejszą z kwot (pozostałe potrącenie albo kwotę do wypłaty z wybranej prowizji).
                    </p>
                    {targets.length === 0 ? (
                      <p className="mt-2 text-xs text-amber-200/80">Brak takiej prowizji (ta sama marka i sposób wypłaty) — potrącenie poczeka na kolejną prowizję tej osoby.</p>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        {targets.map((target) => (
                          <label key={target.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-xs ${picking.target === target.id ? 'bg-[#d3bb73]/10' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                            <span className="flex items-center gap-2 text-[#e5e4e2]">
                              <input type="radio" name={`deduction-${commission.id}`} checked={picking.target === target.id} onChange={() => setDeducting({ ...picking, target: target.id })} className="accent-[#d3bb73]" />
                              {target.event?.name || 'Wydarzenie'}
                            </span>
                            <span className="text-[#d3bb73]">zostało {formatCommissionMoney(remainingOf(target))}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      <button type="button" disabled={settlingDeduction} onClick={() => setDeducting(null)} className="rounded px-3 py-1.5 text-xs text-[#e5e4e2]/60 hover:bg-white/5">Anuluj</button>
                      <button type="button" disabled={settlingDeduction || !picking.target} onClick={() => void settleDeduction()} className="inline-flex items-center gap-1.5 rounded bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#111522] disabled:opacity-40">
                        {settlingDeduction && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Potrąć z wybranej prowizji
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#e5e4e2]/35">Brak naliczeń spełniających filtry.</p>}
        </div>
      </section>
    </div>
  );
}
