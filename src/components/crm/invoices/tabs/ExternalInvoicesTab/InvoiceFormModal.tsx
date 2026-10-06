import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import { useEffect, useState } from 'react';
import {
  BUCKET,
  ExternalInvoice,
  InvoicePrefill,
  labelClass,
  inputClass,
  PAYMENT_METHODS,
  MONTH_NAMES,
} from './ExternalInvoicesTab';
import { uploadFile } from './uploadFile';
import { Modal } from '@/components/UI/Modal';
import { FileDropzone } from '@/components/UI/FileDropzone/FileDropzone';
import { ScannerCaptureModal } from '@/components/crm/scanner/ScannerCaptureModal';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { fetchCompanyDataFromGUS } from '@/lib/gus';
import { Loader2, ScanLine, Search } from 'lucide-react';
import { InvoiceScanAssistant } from './InvoiceScanAssistant';
import type { InvoiceScanField } from './InvoiceScanAssistant';
import { ContractTermFields, isContractDate, type ContractTerm } from '@/components/crm/invoices/ContractTermFields';
import {
  EXTERNAL_DOCUMENT_KINDS,
  isExternalDocumentKind,
  type ExternalDocumentKind,
} from '@/lib/invoices/externalDocumentKinds';

function isDocumentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface SavedSellerOption {
  key: string;
  name: string;
  nip: string;
  usageCount: number;
}

export function InvoiceFormModal({
  invoice,
  prefill,
  sellerOptions,
  lockedCompanyId,
  onClose,
  onSaved,
}: {
  invoice: ExternalInvoice | null;
  prefill: InvoicePrefill | null;
  sellerOptions: SavedSellerOption[];
  lockedCompanyId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [gusLoading, setGusLoading] = useState(false);
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [existingFileUrl, setExistingFileUrl] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [aiReading, setAiReading] = useState(false);
  const [aiFieldsApplied, setAiFieldsApplied] = useState(false);
  const [paymentReviewed, setPaymentReviewed] = useState(false);
  const [paymentStatusTouched, setPaymentStatusTouched] = useState(false);
  const initialKind = invoice?.document_kind ?? prefill?.document_kind;
  const inferredExternalDocumentKind: ExternalDocumentKind = isExternalDocumentKind(initialKind) ? initialKind : 'invoice';
  const [contractTerm, setContractTerm] = useState<ContractTerm | ''>(invoice?.contract_term ?? prefill?.contract_term ?? (invoice ? '' : 'fixed'));
  const [contractStart, setContractStart] = useState(invoice?.contract_start_date ?? prefill?.contract_start_date ?? invoice?.invoice_date ?? prefill?.invoice_date ?? new Date().toISOString().slice(0, 10));
  const [contractEnd, setContractEnd] = useState(invoice?.contract_end_date ?? prefill?.contract_end_date ?? '');
  const [contractEnding, setContractEnding] = useState(Boolean(invoice?.contract_end_date ?? prefill?.contract_end_date));

  const [form, setForm] = useState({
    document_kind: inferredExternalDocumentKind,
    seller_name: invoice?.seller_name ?? prefill?.seller_name ?? '',
    seller_nip: invoice?.seller_nip ?? prefill?.seller_nip ?? '',
    invoice_number: invoice?.invoice_number ?? prefill?.invoice_number ?? '',
    label: invoice?.label ?? prefill?.label ?? '',
    invoice_date:
      invoice?.invoice_date ?? prefill?.invoice_date ?? new Date().toISOString().slice(0, 10),

    payment_method: invoice?.payment_method ?? prefill?.payment_method ?? 'Przelew',

    amount_net: invoice?.amount_net != null ? String(invoice.amount_net) : prefill?.amount_net ?? '',

    amount_gross: invoice?.amount_gross != null ? String(invoice.amount_gross) : prefill?.amount_gross ?? '',

    currency: invoice?.currency ?? prefill?.currency ?? 'PLN',

    notes: invoice?.notes ?? prefill?.notes ?? '',
    my_company_id: lockedCompanyId ?? invoice?.my_company_id ?? prefill?.my_company_id ?? '',
    category_id: invoice?.category_id ?? prefill?.category_id ?? '',
    payment_status: invoice?.payment_status ?? prefill?.payment_status ?? (['invoice', 'receipt', 'credit_note'].includes(inferredExternalDocumentKind) ? 'paid' : 'unpaid'),
    paid_amount: invoice?.paid_amount ? String(invoice.paid_amount) : prefill?.paid_amount ?? '',
    payment_date:
      invoice?.payment_date ?? invoice?.invoice_date ?? prefill?.payment_date ?? prefill?.invoice_date ?? new Date().toISOString().slice(0, 10),
  });
  const [file, setFile] = useState<File | null>(null);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  

  const isSubscriptionInvoice = !!prefill?.subscription_id;
  const isPolicy = form.document_kind === 'insurance_policy';
  const isInvoiceDocument = ['invoice', 'receipt', 'credit_note'].includes(form.document_kind);
  const issuerLabel = isPolicy ? 'Ubezpieczyciel' : isInvoiceDocument ? 'Sprzedawca' : 'Wystawca / kontrahent';
  const numberLabel = isPolicy ? 'Numer polisy' : form.document_kind === 'contract' ? 'Numer / oznaczenie umowy' : form.document_kind === 'other' ? 'Numer / własne oznaczenie dokumentu' : 'Numer dokumentu';
  const selectedSellerKey =
    sellerOptions.find(
      (seller) =>
        seller.name === form.seller_name &&
        seller.nip.replace(/\D/g, '') === form.seller_nip.replace(/\D/g, ''),
    )?.key || '';

  const selectSavedSeller = (key: string) => {
    const seller = sellerOptions.find((option) => option.key === key);
    if (!seller) return;
    setForm((current) => ({
      ...current,
      seller_name: seller.name,
      seller_nip: seller.nip,
    }));
  };

  const applyScanFields = (values: Partial<Record<InvoiceScanField, string>>) => {
    setForm((current) => {
      const next = { ...current };
      // The assistant may only update document fields, never payment status or allocations.
      const allowed: Exclude<InvoiceScanField, 'document_kind'>[] = ['seller_name', 'seller_nip', 'invoice_number', 'invoice_date', 'label', 'payment_method', 'amount_net', 'amount_gross', 'currency'];
      for (const field of allowed) {
        if (typeof values[field] === 'string') next[field] = values[field]!;
      }
      if (isExternalDocumentKind(values.document_kind)) next.document_kind = values.document_kind;
      return next;
    });
    setAiFieldsApplied(true);
    setPaymentReviewed(false);
    showSnackbar('Uzupełniono wybrane pola. Sprawdź dokument oraz status i datę płatności przed zapisem.', 'success');
  };

  const fetchSellerFromGUS = async () => {
    const cleanNip = form.seller_nip.replace(/\D/g, '');

    if (cleanNip.length !== 10) {
      showSnackbar('Wprowadź poprawny polski NIP wystawcy (10 cyfr)', 'error');
      return;
    }

    try {
      setGusLoading(true);
      const company = await fetchCompanyDataFromGUS(cleanNip);

      if (!company?.name) {
        showSnackbar('Nie znaleziono firmy w GUS ani na Białej Liście VAT', 'warning');
        return;
      }

      setForm((current) => ({
        ...current,
        seller_nip: company.nip || cleanNip,
        seller_name: company.name,
      }));
      showSnackbar('Pobrano dane wystawcy z rejestru publicznego', 'success');
    } catch (error) {
      showSnackbar(
        error instanceof Error ? error.message : 'Nie udało się pobrać danych wystawcy',
        'error',
      );
    } finally {
      setGusLoading(false);
    }
  };

  const submit = async () => {
    if (saving || aiReading) return;
    if (lockedCompanyId && (form.my_company_id !== lockedCompanyId || (invoice && invoice.my_company_id !== lockedCompanyId))) {
      showSnackbar('Dokument musi należeć do firmy wybranej w rozliczeniu miesiąca. Otwórz go ponownie z właściwego miesiąca i firmy.', 'error');
      return;
    }
    if (aiFieldsApplied && !paymentReviewed) {
      showSnackbar('Sprawdź i potwierdź status oraz datę płatności. AI nie ustala, czy dokument został opłacony.', 'warning');
      return;
    }
    if (!form.seller_name.trim() || !form.invoice_number.trim() || !form.invoice_date || !form.my_company_id) {
      showSnackbar('Uzupełnij działalność, wystawcę, numer lub oznaczenie oraz datę dokumentu', 'error');
      return;
    }
    if (!isExternalDocumentKind(form.document_kind) || !isDocumentDate(form.invoice_date)) {
      showSnackbar('Wybierz rodzaj dokumentu i podaj poprawną datę dokumentu', 'error');
      return;
    }
    if (form.document_kind === 'contract') {
      if (!contractTerm && (!invoice || invoice.document_kind !== 'contract')) {
        showSnackbar('Wybierz zakres umowy: czas określony albo nieokreślony.', 'error');
        return;
      }
      if (contractTerm && (!isContractDate(contractStart)
        || ((contractTerm === 'fixed' || contractEnding) && (!isContractDate(contractEnd) || contractEnd < contractStart)))) {
        showSnackbar('Podaj poprawną datę początku oraz datę zakończenia nie wcześniejszą od początku. Umowa terminowa i zakończenie bezterminowej wymagają daty końca.', 'error');
        return;
      }
    }
    if ((form.payment_status === 'paid' || form.payment_status === 'partially_paid') && !isDocumentDate(form.payment_date || form.invoice_date)) {
      showSnackbar('Podaj poprawną datę zapłaty', 'error');
      return;
    }
    if (form.payment_status === 'partially_paid') {
      const paid = Number(form.paid_amount || 0);
      const gross = Math.abs(Number(form.amount_gross || 0));
      if (paid <= 0 || gross <= 0 || paid >= gross) {
        showSnackbar(
          'Dla płatności częściowej podaj kwotę większą od zera i mniejszą od całkowitej kwoty dokumentu',
          'error',
        );
        return;
      }
    }
    setSaving(true);

    let filePath: string | null = null;
    if (file) {
      filePath = await uploadFile(file);
      if (!filePath) {
        setSaving(false);
        showSnackbar('Nie udało się wgrać pliku', 'error');
        return;
      }
    }

    const payload = {
      document_kind: form.document_kind,
      ...((form.document_kind === 'contract' && contractTerm) || invoice?.contract_term ? {
        contract_term: form.document_kind === 'contract' ? contractTerm || null : null,
        contract_start_date: form.document_kind === 'contract' && contractTerm ? contractStart : null,
        contract_end_date: form.document_kind === 'contract' && contractTerm && (contractTerm === 'fixed' || contractEnding) ? contractEnd : null,
      } : {}),
      seller_name: form.seller_name.trim(),
      seller_nip: form.seller_nip.trim() || null,
      invoice_number: form.invoice_number.trim(),
      label: form.label.trim() || null,
      invoice_date: form.invoice_date,
      payment_method: form.payment_method || null,
      amount_net: form.amount_net ? Number(form.amount_net) : null,
      amount_gross: form.amount_gross ? Number(form.amount_gross) : null,
      currency: form.currency,
      file_url: filePath ?? (removeExistingFile ? null : invoice?.file_url ?? null),
      notes: form.notes.trim() || null,
      my_company_id: lockedCompanyId || form.my_company_id || null,
      category_id: form.category_id || null,
      event_id: invoice?.event_id ?? prefill?.event_id ?? null,
      subscription_id: invoice?.subscription_id ?? prefill?.subscription_id ?? null,
      period_year:
        invoice?.period_year ?? prefill?.period_year ?? (prefill?.subscription_id ? Number(form.invoice_date.slice(0, 4)) : null),
      period_month:
        invoice?.period_month ?? prefill?.period_month ?? (prefill?.subscription_id ? Number(form.invoice_date.slice(5, 7)) : null),
      payment_status: form.payment_status,
      paid_amount:
        form.payment_status === 'paid'
          ? Math.abs(Number(form.amount_gross || 0))
          : form.payment_status === 'partially_paid'
            ? Math.max(Number(form.paid_amount || 0), 0)
            : 0,
      payment_date:
        form.payment_status === 'paid' || form.payment_status === 'partially_paid'
          ? form.payment_date || form.invoice_date
          : null,
    };

    let result;

    if (invoice) {
      const query = supabase.from('external_invoices').update(payload).eq('id', invoice.id);
      result = lockedCompanyId ? await query.eq('my_company_id', lockedCompanyId) : await query;
    } else {
      result = await supabase.from('external_invoices').insert(payload);
    }

    const { error } = result;

    setSaving(false);
    if (error) {
      if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
      showSnackbar(['PGRST204', '42703'].includes(error.code) && /contract_(term|start_date|end_date)/i.test(error.message)
        ? 'Zakres umów wymaga wdrożenia aktualizacji bazy. Dokument nie został zapisany; nie zmieniaj rodzaju umowy, aby ominąć tę informację.'
        : 'Nie udało się zapisać dokumentu', 'error');
      return;
    }
    showSnackbar(
      invoice ? 'Dokument został zaktualizowany' : 'Dokument został dodany',
      'success'
    );
    onSaved();
  };

  useEffect(() => {
    Promise.all([
      supabase.from('my_companies').select('id,name').eq('is_active', true).order('name'),
      supabase.from('finance_categories').select('id,name').eq('is_active', true).in('kind', ['expense', 'both']).order('sort_order'),
    ]).then(([companiesResult, categoriesResult]) => {
      const companyRows = (companiesResult.data || []).filter((company) => !lockedCompanyId || company.id === lockedCompanyId);
      setCompanies(companyRows);
      setCategories(categoriesResult.data || []);
      if (companyRows.length === 1) {
        setForm((current) => ({ ...current, my_company_id: current.my_company_id || companyRows[0].id }));
      }
    });
  }, [lockedCompanyId]);

  useEffect(() => {
    const loadFile = async () => {
      if (!invoice?.file_url) return;
  
      const { data } = await supabase.storage
        .from('external-invoices')
        .createSignedUrl(invoice.file_url, 3600);
  
      if (data?.signedUrl) {
        setExistingFileUrl(data.signedUrl);
      }
    };
  
    loadFile();
  }, [invoice]);

  return (
    <Modal
      open
      onClose={onClose}
      title={prefill?.copied_from_number ? 'Dodaj podobny dokument' : isSubscriptionInvoice ? 'Dodaj dokument do subskrypcji' : invoice ? 'Edytuj dokument spoza KSeF' : 'Dodaj dokument spoza KSeF'}
    >
      {prefill?.copied_from_number && (
        <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-3 py-2 text-xs leading-5 text-[#e5e4e2]/70">
          Skopiowano dane z dokumentu <span className="font-medium text-[#d3bb73]">{prefill.copied_from_number}</span>.
          {' '}Uzupełnij nowy numer, datę oraz dołącz właściwy plik.
        </div>
      )}
      {isSubscriptionInvoice && prefill?.period_year && prefill?.period_month && (
        <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-3 py-2 text-xs text-[#e5e4e2]/70">
          Dokument zostanie przypisany do subskrypcji za okres{' '}
          <span className="font-medium text-[#d3bb73]">
            {MONTH_NAMES[prefill.period_month - 1]} {prefill.period_year}
          </span>
          .
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Rodzaj dokumentu *</label>
          <select
            className={inputClass}
            value={form.document_kind}
            onChange={(event) => {
              const kind = event.target.value;
              if (!isExternalDocumentKind(kind)) return;
              setForm((current) => ({
                ...current,
                document_kind: kind,
                ...(!invoice && !paymentStatusTouched && !['invoice', 'receipt', 'credit_note'].includes(kind) ? { payment_status: 'unpaid' as const } : {}),
              }));
              setPaymentReviewed(false);
            }}
          >
            {EXTERNAL_DOCUMENT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </select>
          <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">
            {isPolicy
              ? 'Wpisz składkę należną za całą polisę, nie sumę ubezpieczenia. Przy ratach wybierz płatność częściową i wpisz tylko faktycznie zapłaconą kwotę. Przelew dopasujesz osobno po zapisaniu dokumentu.'
              : 'Możesz dodać również dokument inny niż faktura. Samo dodanie dokumentu nie potwierdza płatności ani nie przesądza jego kwalifikacji księgowej.'}
          </p>
        </div>
        {form.document_kind === 'contract' && <ContractTermFields
          term={contractTerm} startDate={contractStart} endDate={contractEnd} ending={contractEnding} disabled={saving || aiReading}
          onTermChange={setContractTerm} onStartChange={setContractStart} onEndChange={setContractEnd}
          onEndingChange={(value) => { setContractEnding(value); if (!value) setContractEnd(''); }}
        />}
        <div>
          <label className={labelClass}>Działalność *</label>
          <select className={inputClass} disabled={Boolean(lockedCompanyId)} value={form.my_company_id} onChange={(e) => setForm({ ...form, my_company_id: e.target.value })}>
            <option value="">Wybierz działalność</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
          {lockedCompanyId && <p className="mt-1 text-xs text-[#e5e4e2]/50">Firma jest ustalona przez rozliczenie miesiąca.</p>}
        </div>
        <div>
          <label className={labelClass}>Kategoria kosztu</label>
          <select className={inputClass} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            <option value="">Rozpoznaj automatycznie</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className={labelClass}>Podgląd dokumentu (zdjęcie lub PDF)</label>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              disabled={saving || aiReading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#d3bb73]/5 px-3 py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
            >
              <ScanLine className="h-4 w-4" />
              Skanuj
            </button>
          </div>
          <FileDropzone
            file={file}
            existingFile={removeExistingFile ? undefined : {
              url: invoice?.file_url,
              name: invoice?.invoice_number,
            }}
            onRemoveExisting={() => setRemoveExistingFile(true)}
            onChange={setFile}
          />
          <InvoiceScanAssistant
            file={file}
            companyId={form.my_company_id}
            currentValues={form}
            disabled={saving || gusLoading || scannerOpen}
            onApply={applyScanFields}
            onBusyChange={setAiReading}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>{isInvoiceDocument ? 'Zapisany sprzedawca' : 'Zapisany wystawca / kontrahent'}</label>
          <SearchCombobox
            value={selectedSellerKey}
            options={sellerOptions.map((seller) => ({
              id: seller.key,
              label: seller.name,
              description: [
                seller.nip ? `NIP ${seller.nip}` : null,
                seller.usageCount > 1 ? `użyto ${seller.usageCount}×` : null,
              ].filter(Boolean).join(' · '),
              keywords: seller.nip,
            }))}
            onChange={selectSavedSeller}
            placeholder="Szukaj po nazwie lub NIP…"
            emptyLabel="Nie znaleziono takiego kontrahenta"
            allowClear={false}
          />
          <p className="mt-1 text-xs text-[#e5e4e2]/45">
            Wyszukaj kontrahenta albo uzupełnij dane ręcznie poniżej.
          </p>
        </div>
        <div>
          <label className={labelClass}>{issuerLabel} *</label>
          <input
            className={inputClass}
            value={form.seller_name}
            onChange={(e) => setForm({ ...form, seller_name: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>{isPolicy ? 'NIP ubezpieczyciela' : isInvoiceDocument ? 'NIP sprzedawcy' : 'NIP wystawcy / kontrahenta'}</label>
          <div className="flex gap-2">
            <input
              className={`${inputClass} min-w-0 flex-1`}
              value={form.seller_nip}
              autoComplete="off"
              placeholder="NIP lub zagraniczny VAT ID"
              onChange={(e) => setForm({ ...form, seller_nip: e.target.value })}
            />
            <button
              type="button"
              onClick={fetchSellerFromGUS}
              disabled={gusLoading}
              title="Pobierz nazwę firmy z GUS lub Białej Listy VAT"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-[#d3bb73] transition-colors hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-60"
            >
              {gusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span>GUS</span>
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>{numberLabel} *</label>
          <input
            className={inputClass}
            value={form.invoice_number}
            onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>{isPolicy ? 'Nazwa opisowa (np. OC samochodu)' : 'Nazwa opisowa dokumentu'}</label>
          <input
            className={inputClass}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>{isPolicy ? 'Data wystawienia polisy' : 'Data dokumentu'} *</label>
          <input
            type="date"
            className={inputClass}
            value={form.invoice_date}
            onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Sposób płatności</label>
          <select
            className={inputClass}
            value={form.payment_method}
            onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Status płatności</label>
          <select
            className={inputClass}
            value={form.payment_status}
            onChange={(e) => {
              setForm({ ...form, payment_status: e.target.value as typeof form.payment_status });
              setPaymentStatusTouched(true);
              setPaymentReviewed(false);
            }}
          >
            <option value="paid">Opłacony</option>
            <option value="unpaid">Nieopłacony</option>
            <option value="partially_paid">Częściowo opłacony</option>
            <option value="cancelled">Anulowany</option>
          </select>
        </div>
        {(form.payment_status === 'paid' || form.payment_status === 'partially_paid') && (
          <div>
            <label className={labelClass}>Data zapłaty</label>
            <input type="date" className={inputClass} value={form.payment_date} onChange={(e) => {
              setForm({ ...form, payment_date: e.target.value });
              setPaymentReviewed(false);
            }} />
          </div>
        )}

        {aiFieldsApplied && (
          <label className="flex items-start gap-2 rounded-lg bg-[#d3bb73]/5 p-3 text-xs leading-5 text-[#e5e4e2]/75 sm:col-span-2">
            <input
              type="checkbox"
              checked={paymentReviewed}
              onChange={(event) => setPaymentReviewed(event.target.checked)}
              className="mt-1 accent-[#d3bb73]"
            />
            <span>Sprawdziłem status płatności oraz datę i kwotę zapłaty, jeśli dotyczą dokumentu. AI odczytuje treść dokumentu, ale nie potwierdza jego opłacenia.</span>
          </label>
        )}

        {form.payment_status === 'partially_paid' && (
          <div>
            <label className={labelClass}>Faktycznie zapłacona kwota *</label>
            <input
              type="number"
              min="0.01"
              max={form.amount_gross ? Math.abs(Number(form.amount_gross)) : undefined}
              step="0.01"
              required
              value={form.paid_amount}
              onChange={(event) => {
                setForm({ ...form, paid_amount: event.target.value });
                setPaymentReviewed(false);
              }}
              className={inputClass}
              placeholder="0,00"
            />
            <p className="mt-1 text-xs text-[#e5e4e2]/45">
              Ta kwota jest potrzebna, aby kolejne przelewy rozliczały wyłącznie pozostałe saldo.
            </p>
          </div>
        )}
        <div>
          <label className={labelClass}>Kwota netto (jeśli podana na dokumencie)</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.amount_net}
            onChange={(e) =>
              setForm({
                ...form,
                amount_net: e.target.value,
              })
            }
          />
        </div>
        <div>
          <label className={labelClass}>{isPolicy ? 'Składka za całą polisę' : isInvoiceDocument ? 'Kwota brutto' : 'Całkowita kwota dokumentu'}</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.amount_gross}
            onChange={(e) => {
              setForm({ ...form, amount_gross: e.target.value });
              setPaymentReviewed(false);
            }}
          />
        </div>
        <div>
          <label className={labelClass}>Waluta</label>
          <select
            className={inputClass}
            value={form.currency}
            onChange={(e) => {
              setForm({ ...form, currency: e.target.value });
              setPaymentReviewed(false);
            }}
          >
            <option value="PLN">PLN - złoty</option>
            <option value="EUR">EUR - euro</option>
            <option value="USD">USD - dolar</option>
            <option value="GBP">GBP - funt</option>
            {!['PLN', 'EUR', 'USD', 'GBP'].includes(form.currency) && (
              <option value={form.currency}>{form.currency}</option>
            )}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Uwagi</label>
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
        >
          Anuluj
        </button>
        <button
          onClick={submit}
          disabled={saving || aiReading}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          {saving ? 'Zapisywanie...' : 'Zapisz dokument'}
        </button>
      </div>

      <ScannerCaptureModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(scannedFile) => {
          setFile(scannedFile);
          setRemoveExistingFile(Boolean(invoice?.file_url));
          setScannerOpen(false);
          showSnackbar('Skan jest gotowy — kliknij „Odczytaj AI”, aby uzupełnić formularz, albo wpisz dane ręcznie.', 'success');
        }}
      />
    </Modal>
  );
}
