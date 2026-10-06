'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Pencil, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { externalDocumentKindLabel, type ExternalDocumentKind } from '@/lib/invoices/externalDocumentKinds';
import { externalObligationInMonth } from '@/lib/invoices/contractPeriods';
import { PersonnelContractsRegistry } from './PersonnelContractsRegistry';
import { InvoiceFormModal, type SavedSellerOption } from './ExternalInvoicesTab/InvoiceFormModal';
import type { ExternalInvoice, InvoicePrefill } from './ExternalInvoicesTab/ExternalInvoicesTab';
import type { Snapshot } from './SaldeoDeliveryPanel';

export type MonthlyObligationsStepProps = {
  companyId: string;
  month: number;
  year: number;
  snapshot: Snapshot | null;
  onChanged: () => void;
};

const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:opacity-40';
const panel = 'space-y-4 rounded-xl bg-[var(--brand-burgundy-900)] p-4 sm:p-5';
const kindOptions: { kind: ExternalDocumentKind; label: string }[] = [
  { kind: 'contract', label: 'Umowa / czynsz' },
  { kind: 'insurance_policy', label: 'Polisa' },
  { kind: 'debit_note', label: 'Nota obciążeniowa' },
  { kind: 'other', label: 'Inny dokument zobowiązania' },
];
const date = (value: string) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : 'Nie zapisano';
const money = (amount: number | null, currency: string) => amount == null ? 'Nie zapisano kwoty' : `${Number(amount).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export default function MonthlyObligationsStep({ companyId, month, year, snapshot, onChanged }: MonthlyObligationsStepProps) {
  const { canManageModule } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const canManageDocuments = canManageModule('invoices');
  const [access, setAccess] = useState<{ view: boolean; manage: boolean } | null>(null);
  const [accessError, setAccessError] = useState('');
  const [invoices, setInvoices] = useState<ExternalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{ invoice: ExternalInvoice | null; prefill: InvoicePrefill | null } | null>(null);
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const scope = `${companyId}:${period}`;
  useEffect(() => { setForm(null); }, [scope]);

  useEffect(() => {
    let active = true;
    setAccess(null); setAccessError('');
    void Promise.all([supabase.rpc('can_view_personnel_contracts'), supabase.rpc('can_manage_personnel_contracts')])
      .then(([view, manage]) => {
        if (!active) return;
        if (view.error || manage.error) { setAccessError('Nie udało się potwierdzić dostępu do umów kadrowych.'); setAccess({ view: false, manage: false }); return; }
        setAccess({ view: view.data === true, manage: manage.data === true });
      }).catch(() => { if (active) { setAccessError('Nie udało się potwierdzić dostępu do umów kadrowych.'); setAccess({ view: false, manage: false }); } });
    return () => { active = false; };
  }, [companyId]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setInvoices([]);
    const load = async () => {
      const rows: ExternalInvoice[] = [];
      for (let from = 0; ; from += 200) {
        const result = await supabase.from('external_invoices').select('*').eq('my_company_id', companyId)
          .in('document_kind', kindOptions.map((option) => option.kind)).order('id').range(from, from + 199);
        if (result.error) throw result.error;
        rows.push(...(result.data || []) as ExternalInvoice[]);
        if (!result.data || result.data.length < 200) break;
      }
      if (!active) return;
      setInvoices(rows.filter((row) => externalObligationInMonth(row, month, year))
        .sort((left, right) => right.invoice_date.localeCompare(left.invoice_date) || left.id.localeCompare(right.id)));
    };
    void load().catch(() => { if (active) setError('Nie udało się pobrać dokumentów zobowiązań. Lista nie jest kompletna.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, month, year, period, revision, snapshot]);

  const sellers = useMemo<SavedSellerOption[]>(() => {
    const options = new Map<string, SavedSellerOption>();
    invoices.forEach((invoice) => {
      const key = invoice.seller_nip || invoice.seller_name.trim().toLocaleLowerCase('pl-PL');
      if (!key) return;
      const current = options.get(key);
      options.set(key, { key, name: invoice.seller_name, nip: invoice.seller_nip || '', usageCount: (current?.usageCount || 0) + 1 });
    });
    return [...options.values()].sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name, 'pl'));
  }, [invoices]);

  const saved = () => { setForm(null); setRevision((value) => value + 1); onChanged(); };
  const add = (kind: ExternalDocumentKind) => {
    if (!canManageDocuments) return;
    setForm({ invoice: null, prefill: { document_kind: kind, my_company_id: companyId, period_year: year, period_month: month, invoice_date: `${period}-01`, payment_status: 'unpaid', payment_date: '' } });
  };
  const preview = async (invoice: ExternalInvoice) => {
    if (!invoice.file_url) return;
    try {
      const { data, error: previewError } = await supabase.storage.from('external-invoices').createSignedUrl(invoice.file_url, 300);
      if (previewError || !data?.signedUrl) throw previewError || new Error('Brak podglądu');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch { showSnackbar('Nie udało się otworzyć pliku źródłowego.', 'error'); }
  };

  return <div className="space-y-5 text-[var(--brand-platinum)]">
    <section className={panel}>
      <div><h3 className="font-medium">Umowy i zobowiązania miesiąca</h3><p className="mt-2 text-sm leading-6 text-[#e5e4e2]/60">Zapisz rzeczywiste umowy i dokumenty kosztowe. Wynagrodzenie netto, PIT i ZUS pozostają oddzielnymi pozycjami. Dopasowanie do przelewów i kontrola braków są w kroku 5.</p></div>
      {access === null ? <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/55"><Loader2 className="h-4 w-4 animate-spin" /> Sprawdzanie dostępu do umów…</p>
        : access.view ? <PersonnelContractsRegistry key={scope} filterCompanyIds={[companyId]} month={month} year={year} readOnly={!access.manage} onChanged={onChanged} />
          : <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-[#e5e4e2]/60">{accessError || 'Nie masz uprawnień do przeglądania umów kadrowych. Pozostałe dokumenty firmy są poniżej.'}</p>}
    </section>

    <section className={panel}>
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">Czynsz, polisy i pozostałe dokumenty zobowiązań</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/55">Okres rozliczeniowy: {String(month).padStart(2, '0')}/{year}. Umowy terminowe są tylko w przypisanym miesiącu; bezterminowe pozostają widoczne od początku do wskazanej daty zakończenia. Pokazujemy ten sam dokument, bez powielania kosztów ani płatności.</p></div><button type="button" className={button} disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw className="h-4 w-4" />Odśwież</button></header>
      {canManageDocuments && <div className="flex flex-wrap gap-2">{kindOptions.map((option) => <button key={option.kind} type="button" className={button} onClick={() => add(option.kind)}><Plus className="h-4 w-4" />{option.label}</button>)}</div>}
      <p className="text-xs leading-5 text-[#e5e4e2]/50">Dodajesz dokument źródłowy przez formularz spoza KSeF. Data dokumentu i data zapłaty nie są terminem wymagalności. Raty polisy lub czynszu zapisuj zgodnie z rzeczywistymi dokumentami, bez ponownego dodawania istniejącej faktury.</p>
      {error ? <p role="alert" className="rounded-lg bg-amber-400/5 p-4 text-sm text-amber-200">{error}</p> : loading ? <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/55"><Loader2 className="h-4 w-4 animate-spin" />Ładowanie dokumentów…</p>
        : invoices.length === 0 ? <p className="rounded-lg bg-white/[0.03] p-4 text-sm text-[#e5e4e2]/55">Nie zapisano takich dokumentów w tym miesiącu. Faktury i paragony są w kroku „Przychody i koszty”.</p>
          : <div className="space-y-2">{invoices.map((invoice) => <article key={invoice.id} className="rounded-lg bg-[var(--brand-burgundy-800)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-[#d3bb73]">{externalDocumentKindLabel(invoice.document_kind)}</p><h4 className="mt-1 break-words text-sm font-medium">{invoice.invoice_number}</h4><p className="mt-1 text-xs text-[#e5e4e2]/65">{invoice.seller_name} · {date(invoice.invoice_date)}</p></div><strong className="text-sm tabular-nums text-[#d3bb73]">{money(invoice.amount_gross, invoice.currency)}</strong></div><details className="mt-3 text-sm"><summary className="cursor-pointer text-[#e5e4e2]/70">Zobacz opis i dokument</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap break-words text-xs leading-5 text-[#e5e4e2]/65">{invoice.label || invoice.notes || 'Nie zapisano dodatkowego opisu.'}</p>{invoice.label && invoice.notes && <p className="whitespace-pre-wrap text-xs leading-5 text-[#e5e4e2]/65">{invoice.notes}</p>}<div className="flex flex-wrap gap-2">{invoice.file_url && <button type="button" className={button} onClick={() => void preview(invoice)}><FileText className="h-4 w-4" />Plik źródłowy</button>}{canManageDocuments && <button type="button" className={button} onClick={() => setForm({ invoice, prefill: null })}><Pencil className="h-4 w-4" />Edytuj dokument</button>}</div></div></details></article>)}</div>}
    </section>
    {form && canManageDocuments && <InvoiceFormModal key={`${scope}:${form.invoice?.id || 'new'}`} invoice={form.invoice} prefill={form.prefill} sellerOptions={sellers} lockedCompanyId={companyId} onClose={() => setForm(null)} onSaved={saved} />}
  </div>;
}
