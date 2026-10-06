'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Banknote, Building2, CalendarDays, Loader2, Search, UserRound } from 'lucide-react';
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

  const loadCommissions = useCallback(async () => {
    const revision = ++loadRevision.current;
    setCommissions([]);
    setLoadError(null);
    if (!access || access.scope === 'none') {
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = supabase
      .from('event_commissions')
      .select(
        'id,sales_partner_id,beneficiary_name,employee_id,contact_id,organization_id,amount,company_cost_amount,status,payment_method,due_date,paid_at,created_at,event:events!inner(id,name,event_date,my_company_id)',
      )
      .order('created_at', { ascending: false });
    if (access.scope === 'sales') {
      const partnerIds = access.managedSellerPartnerIds;
      const contactIds = access.managedSellerContactIds;
      const conditions = [
        ...(partnerIds.length ? [`sales_partner_id.in.(${partnerIds.join(',')})`] : []),
        ...(contactIds.length ? [`and(sales_partner_id.is.null,contact_id.in.(${contactIds.join(',')}))`] : []),
      ];
      if (!conditions.length) {
        setLoading(false);
        return;
      }
      query = query.or(conditions.join(','));
    }
    if (filterCompanyIds?.length) query = query.in('event.my_company_id', filterCompanyIds);
    const { data, error } = await query;
    if (revision !== loadRevision.current) return;

    if (error) {
      const missingSchema = error.message?.includes('company_cost_amount');
      setAvailable(!missingSchema);
      setLoadError('Nie udało się odczytać prowizji w Twoim zakresie dostępu.');
      if (!missingSchema) console.error('Error loading commission register:', error);
      setCommissions([]);
    } else {
      setAvailable(true);
      setCommissions((data || []) as unknown as RegisterCommission[]);
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
  const totals = {
    payable: active
      .filter((commission) => commission.status !== 'paid')
      .reduce((sum, commission) => sum + Number(commission.amount || 0), 0),
    paid: active
      .filter((commission) => commission.status === 'paid')
      .reduce((sum, commission) => sum + Number(commission.amount || 0), 0),
    companyCost: active.reduce(
      (sum, commission) => sum + Number(commission.company_cost_amount ?? commission.amount ?? 0),
      0,
    ),
  };

  const beneficiaries = useMemo(() => {
    const grouped = new Map<string, BeneficiarySummary>();
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
      const current = grouped.get(key) || {
        key,
        name: commission.beneficiary_name,
        profileHref,
        commissionCount: 0,
        payable: 0,
        paid: 0,
        companyCost: 0,
      };
      current.commissionCount += 1;
      current.companyCost += Number(commission.company_cost_amount ?? commission.amount ?? 0);
      if (commission.status === 'paid') current.paid += Number(commission.amount || 0);
      else current.payable += Number(commission.amount || 0);
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.payable - a.payable || a.name.localeCompare(b.name, 'pl'));
  }, [active]);

  const updateStatus = async (commissionId: string, status: CommissionStatus) => {
    if (!canEditCommissions) return;
    const { error } = await supabase.from('event_commissions').update({ status }).eq('id', commissionId);
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
          {filtered.map((commission) => (
            <div key={commission.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm text-[#e5e4e2]">{commission.beneficiary_name}</p>
                <Link href={commission.event?.id ? `/crm/events/${commission.event.id}?tab=overview` : '#'} className="mt-1 flex items-center gap-2 text-xs text-[#d3bb73]/70 hover:text-[#d3bb73]">
                  <CalendarDays className="h-3 w-3" />
                  {commission.event?.name || 'Wydarzenie'}
                  {commission.event?.event_date && ` · ${new Date(commission.event.event_date).toLocaleDateString('pl-PL')}`}
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-violet-200">{formatCommissionMoney(Number(commission.amount || 0))}</p>
                  <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#e5e4e2]/35">
                    {commission.organization_id && <Building2 className="h-3 w-3" />}
                    {commissionPaymentLabels[commission.payment_method || 'invoice']}
                  </p>
                </div>
                {canEditCommissions ? (
                  <select value={commission.status} onChange={(event) => updateStatus(commission.id, event.target.value as CommissionStatus)} className="rounded border border-white/10 bg-[#0a0d1a] px-2 py-1.5 text-xs text-[#e5e4e2]/70">
                    <option value="planned">Planowana</option>
                    <option value="approved">Zatwierdzona</option>
                    <option value="paid">Wypłacona</option>
                    <option value="cancelled">Anulowana</option>
                  </select>
                ) : (
                  <span className="rounded bg-white/5 px-2 py-1 text-xs text-[#e5e4e2]/45">{commissionStatusLabels[commission.status]}</span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#e5e4e2]/35">Brak naliczeń spełniających filtry.</p>}
        </div>
      </section>
    </div>
  );
}
