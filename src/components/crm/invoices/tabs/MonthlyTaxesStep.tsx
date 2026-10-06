'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, Landmark, Loader2, Pencil, RefreshCw, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { taxPaymentExclusionReason, type TaxPaymentCompanyAccounts } from '@/lib/CRM/bankTaxPayments';
import { isConfirmedInternalVatTransfer } from '@/lib/CRM/bankVatTransfers';
import BankTransactionDetailsModal from '@/components/crm/BankTransactionDetailsModal';
import BankTransactionAccountingModal, { type AccountingTransaction, type BankAccountingSubtype } from '@/components/crm/BankTransactionAccountingModal';
import { PersonnelContractsRegistry } from './PersonnelContractsRegistry';
import type { Bank, Snapshot } from './SaldeoDeliveryPanel';

type Props = { companyId: string; month: number; year: number; snapshot: Snapshot | null; onChanged: () => void };
type PersonnelTax = {
  id: string; payment_date: string; amount: number; currency: string; payment_type: string;
  recipient_name: string; title: string | null; notes: string | null; bank_transaction_id: string | null;
  personnel_contracts: { contract_number: string; party_name: string; my_company_id: string } | { contract_number: string; party_name: string; my_company_id: string }[];
};
type TaxKind = 'vat' | 'pit' | 'zus' | 'other';
const labels: Record<TaxKind, string> = { vat: 'VAT / JPK_V7', pit: 'PIT', zus: 'ZUS', other: 'Pozostałe przelewy podatkowe' };
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:opacity-40';
const panel = 'space-y-4 rounded-xl bg-[var(--brand-burgundy-900)] p-4 sm:p-5';
const money = (amount: number, currency: string) => `${Number(amount).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const date = (value: string) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : 'Nie zapisano';

export default function MonthlyTaxesStep({ companyId, month, year, snapshot, onChanged }: Props) {
  const { canManageModule } = useCurrentEmployee();
  const canManageBanks = canManageModule('invoices');
  const [company, setCompany] = useState<TaxPaymentCompanyAccounts | undefined>();
  const [personnel, setPersonnel] = useState<PersonnelTax[]>([]);
  const [access, setAccess] = useState<{ view: boolean; manage: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [showContracts, setShowContracts] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [accounting, setAccounting] = useState<{ transaction: AccountingTransaction; subtype: BankAccountingSubtype } | null>(null);
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const start = `${period}-01`;
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const scope = `${companyId}:${period}`;
  useEffect(() => { setDetailsId(null); setAccounting(null); setShowContracts(false); setAccess(null); }, [scope]);

  useEffect(() => {
    let active = true;
    setLoading(true); setCompany(undefined); setPersonnel([]); setErrors([]);
    const load = async () => {
      const warnings: string[] = [];
      const [companyResult, view, manage] = await Promise.all([
        supabase.from('my_companies').select('id,bank_account,vat_bank_account,private_bank_account,tax_office_bank_account,zus_bank_account').eq('id', companyId).maybeSingle(),
        supabase.rpc('can_view_personnel_contracts'), supabase.rpc('can_manage_personnel_contracts'),
      ]);
      if (!active) return;
      if (companyResult.error || !companyResult.data) warnings.push('Nie udało się odczytać rachunków podatkowych firmy. Pokazujemy tylko płatności z rozpoznanym odbiorcą lub zapisaną klasyfikacją.');
      else setCompany(companyResult.data as TaxPaymentCompanyAccounts);
      const personnelAccess = { view: !view.error && view.data === true, manage: !manage.error && manage.data === true };
      setAccess(personnelAccess);
      if (view.error || manage.error) warnings.push('Nie udało się potwierdzić uprawnień do obciążeń umów.');
      if (personnelAccess.view) {
        try {
          const rows: PersonnelTax[] = [];
          for (let from = 0; ; from += 200) {
            const result = await supabase.from('personnel_contract_payments')
              .select('id,payment_date,amount,currency,payment_type,recipient_name,title,notes,bank_transaction_id,personnel_contracts!personnel_contract_payments_personnel_contract_id_fkey!inner(contract_number,party_name,my_company_id)')
              .eq('personnel_contracts.my_company_id', companyId).in('payment_type', ['tax', 'zus'])
              .gte('payment_date', start).lt('payment_date', end).order('id').range(from, from + 199);
            if (result.error) throw result.error;
            rows.push(...(result.data || []) as PersonnelTax[]);
            if (!result.data || result.data.length < 200) break;
          }
          if (active) setPersonnel(rows.sort((left, right) => left.payment_date.localeCompare(right.payment_date) || left.id.localeCompare(right.id)));
        } catch { warnings.push('Nie udało się odczytać obciążeń PIT / ZUS przypisanych do umów.'); }
      }
      if (active) setErrors(warnings);
    };
    void load().catch(() => { if (active) setErrors(['Nie udało się odczytać danych podatkowych miesiąca.']); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, start, end, snapshot, revision]);

  const banks = useMemo(() => {
    if (!snapshot) return [];
    const statements = new Set(snapshot.statements.filter((statement) => statement.my_company_id === companyId
      && Number(statement.statement_month) === month && Number(statement.statement_year) === year).map((statement) => statement.id));
    return snapshot.transactions.flatMap((bank): { bank: Bank; kind: TaxKind; reason: string }[] => {
      if (!statements.has(bank.statement_id) || !String(bank.transaction_date).startsWith(period)
        || bank.transaction_type !== 'debit' || bank.accounting_subtype === 'automatic_vat_transfer'
        || isConfirmedInternalVatTransfer(bank)) return [];
      const reason = taxPaymentExclusionReason({ transaction_type: bank.transaction_type, counterparty_name: bank.counterparty_name,
        counterparty_account: bank.counterparty_account, accounting_category: bank.accounting_category }, company);
      if (!reason) return [];
      const kind: TaxKind = bank.accounting_subtype === 'vat7_payment' ? 'vat' : bank.accounting_subtype === 'pit4_payment' ? 'pit'
        : bank.accounting_subtype === 'zus_payment' || /ZUS/.test(reason) ? 'zus' : 'other';
      return [{ bank, kind, reason }];
    }).sort((left, right) => left.bank.transaction_date.localeCompare(right.bank.transaction_date) || left.bank.id.localeCompare(right.bank.id));
  }, [snapshot, companyId, month, year, period, company]);

  const totals = useMemo(() => {
    const result = new Map<string, { kind: TaxKind; currency: string; amount: number; count: number }>();
    banks.forEach(({ bank, kind }) => {
      const key = `${kind}:${bank.currency}`;
      const total = result.get(key) || { kind, currency: bank.currency, amount: 0, count: 0 };
      total.amount += Math.abs(Number(bank.amount)); total.count += 1; result.set(key, total);
    });
    return [...result.values()];
  }, [banks]);

  const edit = (bank: Bank, kind: TaxKind) => {
    if (!canManageBanks) return;
    const subtype: BankAccountingSubtype = kind === 'zus' ? 'zus_payment' : kind === 'vat' ? 'vat7_payment' : kind === 'pit' ? 'pit4_payment' : 'other';
    setDetailsId(null);
    setAccounting({ subtype, transaction: { id: bank.id, statement_id: bank.statement_id, company_id: companyId, transaction_date: bank.transaction_date,
      amount: bank.amount, currency: bank.currency, transaction_type: bank.transaction_type === 'credit' ? 'credit' : 'debit',
      counterparty_name: bank.counterparty_name, title: bank.title, accounting_note: bank.accounting_note } });
  };
  const changed = () => { setAccounting(null); setRevision((value) => value + 1); onChanged(); };

  return <div className="space-y-5 text-[var(--brand-platinum)]">
    <section className={panel}>
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-medium"><Landmark className="h-4 w-4 text-[#d3bb73]" />Podatki i ZUS — przelewy w miesiącu</h3><p className="mt-2 text-sm leading-6 text-[#e5e4e2]/60">To zapis zapłaconych kwot z wyciągów, nie wyliczenie zobowiązań podatkowych. Okres {String(month).padStart(2, '0')}/{year} oznacza datę operacji; tytuł przelewu może dotyczyć wcześniejszego rozliczenia.</p></div><button type="button" className={button} disabled={loading} onClick={() => { setRevision((value) => value + 1); onChanged(); }}><RefreshCw className="h-4 w-4" />Odśwież</button></header>
      <p className="rounded-lg bg-white/[0.03] p-3 text-xs leading-5 text-[#e5e4e2]/65">Przelewy do urzędu skarbowego i ZUS zostają na wyciągach. Nie są osobnymi fakturami ani dodatkowymi kosztami i nie są wysyłane jako osobne pliki do Saldeo. Transfery pomiędzy własnym rachunkiem bieżącym a VAT są poza tą listą. Samo słowo „VAT” w tytule nie kwalifikuje przelewu jako podatku.</p>
      {errors.map((error) => <p key={error} role="alert" className="rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">{error}</p>)}
      {snapshot && totals.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{totals.map((total) => <div key={`${total.kind}:${total.currency}`} className="rounded-lg bg-[var(--brand-burgundy-800)] p-4"><p className="text-xs text-[#e5e4e2]/60">{labels[total.kind]}</p><strong className="mt-2 block text-lg tabular-nums text-[#d3bb73]">{money(total.amount, total.currency)}</strong><p className="mt-1 text-xs text-[#e5e4e2]/45">Liczba przelewów: {total.count}</p></div>)}</div>}
      {!snapshot ? <p className="text-sm text-[#e5e4e2]/55">Dane wyciągów nie są jeszcze dostępne.</p> : loading ? <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/55"><Loader2 className="h-4 w-4 animate-spin" />Ładowanie danych miesiąca…</p> : banks.length === 0 ? <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-[#e5e4e2]/55">W dostępnych wyciągach nie rozpoznano przelewów podatkowych ani ZUS dla tego miesiąca. Nie oznacza to braku należności.</p>
        : <div className="space-y-2">{banks.map(({ bank, kind, reason }) => <article key={bank.id} className="rounded-lg bg-[var(--brand-burgundy-800)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-[#d3bb73]">{labels[kind]} · {date(bank.transaction_date)}</p><h4 className="mt-1 text-sm font-medium">{bank.counterparty_name || 'Odbiorca bez nazwy'}</h4><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[#e5e4e2]/60">{bank.title || 'Brak zapisanego tytułu'}</p></div><strong className="text-sm tabular-nums text-[#d3bb73]">{money(Math.abs(Number(bank.amount)), bank.currency)}</strong></div><p className="mt-2 text-[11px] text-[#e5e4e2]/45">Rozpoznanie: {reason} · Źródło: {snapshot.statementNames.get(bank.statement_id) || 'Wyciąg bankowy'}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setDetailsId(bank.id)}><Eye className="h-4 w-4" />Szczegóły przelewu</button>{canManageBanks && <button type="button" className={button} onClick={() => edit(bank, kind)}><Pencil className="h-4 w-4" />Opis i klasyfikacja</button>}</div></article>)}</div>}
    </section>

    <section className={panel}>
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">PIT i ZUS zapisane przy umowach</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/55">Pozycje rzeczywistych umów tej firmy według zapisanej daty płatności w miesiącu. Nie doliczamy ich do sum przelewów powyżej, ponieważ mogą opisywać tę samą zapłatę.</p></div>{access?.view && <button type="button" className={button} aria-expanded={showContracts} onClick={() => setShowContracts((value) => !value)}><UsersRound className="h-4 w-4" />{showContracts ? 'Ukryj rejestr umów' : access.manage ? 'Dodaj lub edytuj przy umowie' : 'Zobacz rejestr umów'}</button>}</header>
      {loading ? <p className="text-sm text-[#e5e4e2]/55">Ładowanie zapisanych obciążeń…</p> : !access?.view ? <p className="text-sm text-[#e5e4e2]/55">Dostęp do obciążeń umów wymaga uprawnień kadrowych.</p> : personnel.length === 0 ? <p className="text-sm text-[#e5e4e2]/55">Nie zapisano obciążeń PIT / ZUS przy umowach w tym miesiącu.</p> : <div className="space-y-2">{personnel.map((payment) => {
        const contract = Array.isArray(payment.personnel_contracts) ? payment.personnel_contracts[0] : payment.personnel_contracts;
        return <article key={payment.id} className="rounded-lg bg-[var(--brand-burgundy-800)] p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{payment.payment_type === 'zus' ? 'ZUS / składki' : 'Podatek / PIT'} · {contract?.contract_number || 'Umowa bez numeru'}</p><strong className="text-sm tabular-nums text-[#d3bb73]">{money(Number(payment.amount), payment.currency)}</strong></div><p className="mt-1 text-xs text-[#e5e4e2]/60">{payment.recipient_name} · {date(payment.payment_date)}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#e5e4e2]/60">{[payment.title, payment.notes].filter(Boolean).join('\n') || 'Nie zapisano dodatkowego opisu.'}</p></article>;
      })}</div>}
      <p className="rounded-lg bg-white/[0.03] p-3 text-xs leading-5 text-[#e5e4e2]/60">Kwoty i daty obciążeń kadrowych uzupełnij z rozliczenia księgowej przy istniejącej umowie. Nie twórz umowy fikcyjnej dla VAT firmy. Ten widok nie jest kalendarzem terminów PIT-4 / VAT-7 / ZUS i nie wylicza deklaracji ani ustawowych terminów płatności.</p>
      {showContracts && access?.view && <PersonnelContractsRegistry key={scope} filterCompanyIds={[companyId]} month={month} year={year} readOnly={!access.manage} onChanged={changed} />}
    </section>

    {detailsId && <BankTransactionDetailsModal transaction={{ id: detailsId, company_id: companyId }} onClose={() => setDetailsId(null)} />}
    {accounting && canManageBanks && <BankTransactionAccountingModal transaction={accounting.transaction} initialSubtype={accounting.subtype} onClose={() => setAccounting(null)} onSaved={changed} />}
  </div>;
}
