'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, FileText, Loader2, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { useSnackbar } from '@/contexts/SnackbarContext';

export type BankAccountingSubtype =
  | 'automatic_vat_transfer'
  | 'vat7_payment'
  | 'pit4_payment'
  | 'zus_payment'
  | 'payroll_payment'
  | 'bank_fee'
  | 'own_transfer'
  | 'cash_settlement'
  | 'supplier_invoice_missing'
  | 'other';

type AccountingCategory =
  | 'bank_fee'
  | 'tax_or_zus'
  | 'payroll'
  | 'own_transfer'
  | 'cash'
  | 'foreign_purchase'
  | 'other';

type SupportingDocumentType =
  | 'payroll_list'
  | 'vat7_declaration'
  | 'pit4_declaration'
  | 'zus_declaration'
  | 'bank_confirmation'
  | 'other';

export type BankAccountingAction = {
  subtype: BankAccountingSubtype;
  label: string;
  category: AccountingCategory;
  defaultNote: string;
  documentType?: SupportingDocumentType;
  documentLabel?: string;
  resolvesWithoutDocument?: boolean;
  alwaysPending?: boolean;
};

export const BANK_ACCOUNTING_ACTIONS: BankAccountingAction[] = [
  {
    subtype: 'automatic_vat_transfer',
    label: 'Automatyczny transfer: rachunek bieżący ↔ VAT',
    category: 'own_transfer',
    defaultNote: 'Automatyczny transfer środków pomiędzy własnym rachunkiem bieżącym a rachunkiem VAT — nie wymaga dokumentu.',
    resolvesWithoutDocument: true,
  },
  {
    subtype: 'vat7_payment',
    label: 'Płatność VAT-7 / JPK_V7 do urzędu',
    category: 'tax_or_zus',
    defaultNote: 'Rozliczenie podatku VAT. Podstawą jest deklaracja VAT-7 lub JPK_V7.',
    documentType: 'vat7_declaration',
    documentLabel: 'deklarację VAT-7 / JPK_V7',
  },
  {
    subtype: 'pit4_payment',
    label: 'Płatność PIT-4R',
    category: 'tax_or_zus',
    defaultNote: 'Rozliczenie zaliczek PIT od wynagrodzeń. Podstawą jest PIT-4R lub zestawienie księgowe.',
    documentType: 'pit4_declaration',
    documentLabel: 'deklarację PIT-4R',
  },
  {
    subtype: 'zus_payment',
    label: 'Płatność ZUS',
    category: 'tax_or_zus',
    defaultNote: 'Rozliczenie składek ZUS. Podstawą jest deklaracja DRA lub potwierdzenie rozliczenia.',
    documentType: 'zus_declaration',
    documentLabel: 'deklarację ZUS DRA',
  },
  {
    subtype: 'payroll_payment',
    label: 'Wynagrodzenie / lista płac',
    category: 'payroll',
    defaultNote: 'Wypłata wynagrodzenia na podstawie listy płac.',
    documentType: 'payroll_list',
    documentLabel: 'listę płac',
  },
  {
    subtype: 'bank_fee',
    label: 'Opłata lub prowizja bankowa',
    category: 'bank_fee',
    defaultNote: 'Opłata bankowa udokumentowana na wyciągu bankowym.',
    resolvesWithoutDocument: true,
  },
  {
    subtype: 'own_transfer',
    label: 'Przelew między własnymi kontami',
    category: 'own_transfer',
    defaultNote: 'Przelew pomiędzy własnymi rachunkami — nie wymaga faktury.',
    resolvesWithoutDocument: true,
  },
  {
    subtype: 'cash_settlement',
    label: 'Rozliczenie gotówkowe',
    category: 'cash',
    defaultNote: 'Operacja związana z rozliczeniem gotówkowym — nie jest płatnością faktury z tego rachunku.',
    resolvesWithoutDocument: true,
  },
  {
    subtype: 'supplier_invoice_missing',
    label: 'Brak faktury od dostawcy',
    category: 'foreign_purchase',
    defaultNote: 'Dostawca nie wystawił faktury na właściwą działalność. Dokument pozostaje do pozyskania.',
    alwaysPending: true,
  },
  {
    subtype: 'other',
    label: 'Inne wyjaśnienie',
    category: 'other',
    defaultNote: '',
  },
];

export type AccountingTransaction = {
  id: string;
  statement_id: string;
  company_id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string | null;
  title?: string | null;
  accounting_note?: string | null;
};

type VatTransferCandidate = {
  transaction_id: string;
  statement_id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string | null;
  title?: string | null;
  account_type: string;
  account_number?: string | null;
  statement_file_name?: string | null;
  day_distance: number;
};

type StatementContext = {
  account_type: string;
  account_number?: string | null;
  file_name?: string | null;
};

function money(value: number, currency = 'PLN') {
  return `${Math.abs(Number(value || 0)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`;
}

function accountTypeLabel(accountType?: string | null) {
  return accountType === 'vat' ? 'Rachunek VAT' : 'Rachunek bieżący';
}

function accountNumberSuffix(accountNumber?: string | null) {
  const digits = String(accountNumber || '').replace(/\D/g, '');
  return digits.length >= 4 ? ` •••• ${digits.slice(-4)}` : '';
}

function signedMoney(
  amount: number,
  transactionType: 'debit' | 'credit',
  currency = 'PLN',
) {
  return `${transactionType === 'credit' ? '+' : '−'}${money(amount, currency)}`;
}

function safeFileName(name: string) {
  const parts = name.split('.');
  const extension = parts.length > 1 ? `.${parts.pop()}` : '';
  const base = parts.join('.').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return `${base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'dokument'}${extension
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')}`;
}

export default function BankTransactionAccountingModal({
  transaction,
  initialSubtype,
  onClose,
  onSaved,
}: {
  transaction: AccountingTransaction;
  initialSubtype: BankAccountingSubtype;
  onClose: () => void;
  onSaved: (resolved: boolean) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialAction = BANK_ACCOUNTING_ACTIONS.find((item) => item.subtype === initialSubtype) || BANK_ACCOUNTING_ACTIONS.at(-1)!;
  const [subtype, setSubtype] = useState<BankAccountingSubtype>(initialAction.subtype);
  const [note, setNote] = useState(transaction.accounting_note || initialAction.defaultNote);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [statementContext, setStatementContext] = useState<StatementContext | null>(null);
  const [vatTransferCandidates, setVatTransferCandidates] = useState<VatTransferCandidate[]>([]);
  const [selectedVatCounterpartId, setSelectedVatCounterpartId] = useState<string | null>(null);
  const [vatCandidatesLoading, setVatCandidatesLoading] = useState(false);
  const [vatCandidatesError, setVatCandidatesError] = useState('');

  const action = BANK_ACCOUNTING_ACTIONS.find((item) => item.subtype === subtype) || initialAction;
  const isVatTransfer = action.subtype === 'automatic_vat_transfer';
  const searchesVatTransferCandidates = isVatTransfer || action.subtype === 'vat7_payment';
  const requiresDocument = !!action.documentType;
  const resolved = isVatTransfer
    ? Boolean(selectedVatCounterpartId)
    : action.alwaysPending
    ? false
    : action.resolvesWithoutDocument
      ? true
      : requiresDocument
        ? !!file
        : false;

  useEffect(() => {
    if (!searchesVatTransferCandidates) return;

    let cancelled = false;
    setVatCandidatesLoading(true);
    setVatCandidatesError('');
    setSelectedVatCounterpartId(null);

    const loadCandidates = async () => {
      const [statementResult, candidatesResult] = await Promise.all([
        supabase
          .from('bank_statements')
          .select('account_type,account_number,file_name')
          .eq('id', transaction.statement_id)
          .maybeSingle(),
        supabase.rpc('get_vat_transfer_candidates', {
          p_transaction_id: transaction.id,
        }),
      ]);
      if (cancelled) return;
      if (statementResult.error) throw statementResult.error;
      if (candidatesResult.error) throw candidatesResult.error;

      const candidates = (candidatesResult.data || []) as VatTransferCandidate[];
      setStatementContext(statementResult.data as StatementContext | null);
      setVatTransferCandidates(candidates);
    };

    void loadCandidates()
      .catch((error: any) => {
        if (cancelled) return;
        const migrationMissing = error?.code === 'PGRST202' || error?.code === '42703';
        setVatCandidatesError(
          migrationMissing
            ? 'Parowanie rachunku VAT wymaga migracji 20260904140000 w Supabase.'
            : error?.message || 'Nie udało się pobrać operacji z drugiego rachunku.',
        );
        setVatTransferCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setVatCandidatesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchesVatTransferCandidates, transaction.id, transaction.statement_id]);

  const selectFile = (selected?: File) => {
    if (!selected) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(selected.type)) {
      showSnackbar('Dołącz PDF, JPG, PNG albo WEBP.', 'error');
      return;
    }
    if (selected.size > 15 * 1024 * 1024) {
      showSnackbar('Plik może mieć maksymalnie 15 MB.', 'error');
      return;
    }
    setFile(selected);
  };

  const save = async () => {
    if (!note.trim()) {
      showSnackbar('Dodaj krótki opis księgowy.', 'error');
      return;
    }

    let storagePath: string | null = null;
    let supportingDocumentId: string | null = null;
    try {
      setSaving(true);
      if (isVatTransfer) {
        if (!selectedVatCounterpartId) {
          throw new Error('Wybierz przeciwną operację z drugiego rachunku.');
        }
        const { error } = await supabase.rpc('link_vat_account_transactions', {
          p_transaction_id: transaction.id,
          p_counterpart_transaction_id: selectedVatCounterpartId,
          p_note: note.trim(),
        });
        if (error) throw error;

        showSnackbar('Połączono obie strony transferu. Nie jest wymagany dokument.', 'success');
        onSaved(true);
        return;
      }

      if (file) {
        storagePath = `${transaction.company_id}/${transaction.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from('bank-supporting-documents')
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;

        const { data: document, error: documentError } = await supabase
          .from('bank_transaction_supporting_documents')
          .insert({
            bank_transaction_id: transaction.id,
            document_type: action.documentType || 'other',
            title: `${action.label} — ${new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}`,
            document_date: transaction.transaction_date,
            amount: Math.abs(Number(transaction.amount)),
            currency: transaction.currency || 'PLN',
            storage_path: storagePath,
            original_file_name: file.name,
            mime_type: file.type || null,
            file_size: file.size,
            notes: note.trim(),
          })
          .select('id')
          .single();
        if (documentError) throw documentError;
        supportingDocumentId = document.id;
      }

      const { error: updateError } = await supabase
        .from('bank_transactions')
        .update({
          accounting_category: action.category,
          accounting_subtype: action.subtype,
          accounting_note: note.trim(),
          accounting_review_status: resolved ? 'explained' : 'pending',
          accounting_reviewed_at: resolved ? new Date().toISOString() : null,
        })
        .eq('id', transaction.id);
      if (updateError) throw updateError;

      if (resolved) {
        showSnackbar('Płatność została opisana i oznaczona jako wyjaśniona.', 'success');
      } else if (requiresDocument && !file) {
        showSnackbar(`Opis zapisany. Dołącz ${action.documentLabel || 'dokument'}, aby zamknąć kontrolę.`, 'warning');
      } else {
        showSnackbar('Opis zapisany. Płatność pozostaje do kontroli.', 'warning');
      }
      onSaved(resolved);
    } catch (error: any) {
      if (supportingDocumentId) {
        await supabase.from('bank_transaction_supporting_documents').delete().eq('id', supportingDocumentId);
      }
      if (storagePath) {
        await supabase.storage.from('bank-supporting-documents').remove([storagePath]);
      }
      const migrationMissing = error?.code === 'PGRST204' || error?.code === 'PGRST205' || error?.code === '42P01';
      const vatPairingMigrationMissing = isVatTransfer
        && (error?.code === 'PGRST202' || error?.code === '42703');
      showSnackbar(
        vatPairingMigrationMissing
          ? 'Brakuje migracji parowania rachunku VAT. Uruchom migrację 20260904140000 i spróbuj ponownie.'
          : migrationMissing
          ? 'Brakuje migracji dokumentów bankowych. Uruchom migrację 20260903214000 i spróbuj ponownie.'
          : error?.message || 'Nie udało się zapisać wyjaśnienia.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141827] shadow-2xl">
        <header className="flex items-start justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">Wyjaśnij płatność</h3>
            <p className="mt-1 text-xs text-[#e5e4e2]/50">
              {money(transaction.amount, transaction.currency)} · {repairBrokenBankText(transaction.counterparty_name) || 'bez kontrahenta'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 overflow-auto p-5">
          <label className="block text-xs text-[#e5e4e2]/65">
            Rodzaj operacji
            <select
              value={subtype}
              onChange={(event) => {
                const nextSubtype = event.target.value as BankAccountingSubtype;
                const nextAction = BANK_ACCOUNTING_ACTIONS.find((item) => item.subtype === nextSubtype);
                setSubtype(nextSubtype);
                setNote(nextAction?.defaultNote || '');
                setFile(null);
                setSelectedVatCounterpartId(null);
              }}
              className="mt-2 w-full rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55"
            >
              {BANK_ACCOUNTING_ACTIONS.map((item) => (
                <option key={item.subtype} value={item.subtype}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-[#e5e4e2]/65">
            Opis księgowy
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Wyjaśnij, czego dotyczy operacja…"
              className="mt-2 w-full resize-y rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/55"
            />
          </label>

          {searchesVatTransferCandidates && (
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-4">
              <div className="flex items-start gap-3">
                <ArrowRightLeft className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
                <div>
                  <h4 className="text-sm font-medium text-sky-100">
                    {isVatTransfer ? 'Połącz obie strony transferu' : 'Sprawdź drugą stronę operacji'}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-sky-100/65">
                    {isVatTransfer
                      ? 'Pokazujemy operacje tej samej działalności, o tej samej kwocie i walucie, przeciwnym kierunku oraz dacie oddalonej maksymalnie o 7 dni.'
                      : 'Jeśli to automatyczne przeksięgowanie, wybierz przeciwną operację z rachunku VAT lub bieżącego. Klasyfikacja zmieni się na transfer własny bez dokumentu.'}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-white/10 bg-[#1c1f33] p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#e5e4e2]/55">
                    Bieżąca operacja · {accountTypeLabel(statementContext?.account_type)}
                    {accountNumberSuffix(statementContext?.account_number)}
                  </span>
                  <strong className={transaction.transaction_type === 'credit' ? 'text-emerald-300' : 'text-red-300'}>
                    {signedMoney(transaction.amount, transaction.transaction_type, transaction.currency)}
                  </strong>
                </div>
                <div className="mt-1 text-[11px] text-[#e5e4e2]/40">
                  {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}
                  {statementContext?.file_name ? ` · ${statementContext.file_name}` : ''}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {vatCandidatesLoading && (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#1c1f33] px-3 py-6 text-xs text-[#e5e4e2]/55">
                    <Loader2 className="h-4 w-4 animate-spin" /> Szukam operacji na drugim rachunku…
                  </div>
                )}

                {!vatCandidatesLoading && vatCandidatesError && (
                  <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-3 text-xs text-red-200">
                    {vatCandidatesError}
                  </div>
                )}

                {!vatCandidatesLoading && !vatCandidatesError && vatTransferCandidates.length === 0 && (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-3 text-xs leading-relaxed text-amber-100/80">
                    Nie znaleziono przeciwnej operacji. Sprawdź, czy wyciąg z drugiego rachunku
                    został wgrany i poprawnie przetworzony.
                  </div>
                )}

                {!vatCandidatesLoading && vatTransferCandidates.map((candidate) => {
                  const selected = selectedVatCounterpartId === candidate.transaction_id;
                  return (
                    <button
                      key={candidate.transaction_id}
                      type="button"
                      onClick={() => {
                        if (!isVatTransfer) {
                          const transferAction = BANK_ACCOUNTING_ACTIONS.find((item) => item.subtype === 'automatic_vat_transfer');
                          setSubtype('automatic_vat_transfer');
                          setNote(transferAction?.defaultNote || 'Automatyczny transfer pomiędzy rachunkiem bieżącym a rachunkiem VAT.');
                          setFile(null);
                        }
                        setSelectedVatCounterpartId(candidate.transaction_id);
                      }}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-white/10 bg-[#1c1f33] hover:border-[#d3bb73]/40'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#d3bb73] bg-[#d3bb73] text-[#141827]' : 'border-white/25 text-transparent'}`}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <strong className="text-[#e5e4e2]">
                              {accountTypeLabel(candidate.account_type)}
                              {accountNumberSuffix(candidate.account_number)}
                            </strong>
                            <strong className={candidate.transaction_type === 'credit' ? 'text-emerald-300' : 'text-red-300'}>
                              {signedMoney(candidate.amount, candidate.transaction_type, candidate.currency)}
                            </strong>
                          </div>
                          <div className="mt-1 text-[11px] text-[#e5e4e2]/45">
                            {new Date(candidate.transaction_date).toLocaleDateString('pl-PL')}
                            {candidate.day_distance > 0 ? ` · różnica ${candidate.day_distance} dni` : ' · ten sam dzień'}
                          </div>
                          <div className="mt-1 truncate text-[11px] text-[#e5e4e2]/55">
                            {repairBrokenBankText(candidate.counterparty_name) || candidate.title || 'Operacja bez opisu'}
                          </div>
                          {candidate.statement_file_name && (
                            <div className="mt-1 truncate text-[10px] text-[#e5e4e2]/35">
                              Źródło: {candidate.statement_file_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {action.subtype === 'vat7_payment' && (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${
              vatTransferCandidates.length > 0
                ? 'border-sky-400/25 bg-sky-400/5 text-sky-100/80'
                : 'border-amber-400/20 bg-amber-400/5 text-amber-100/80'
            }`}>
              {vatCandidatesLoading
                ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-300" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
              <div>
                {vatCandidatesLoading ? (
                  'Sprawdzam, czy na drugim rachunku istnieje przeciwna operacja o tej samej kwocie…'
                ) : vatTransferCandidates.length > 0 ? (
                  <>
                    <strong className="block text-sky-200">To prawdopodobnie transfer między własnymi rachunkami.</strong>
                    Wybierz pasującą operację powyżej. Zostanie ona połączona z bieżącą
                    płatnością jako transfer własny, bez deklaracji i bez innego dokumentu.
                  </>
                ) : (
                  <>
                    Ten wariant służy płatności podatku do urzędu. Jeśli jest to automatyczne
                    przeksięgowanie pomiędzy rachunkiem bieżącym i VAT, wybierz „Automatyczny
                    transfer: rachunek bieżący ↔ VAT” — wtedy dokument nie będzie wymagany.
                  </>
                )}
              </div>
            </div>
          )}

          {action.subtype === 'payroll_payment' && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-100/80">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              Sprawdź sposób wypłaty na liście płac. Jeżeli widnieje „GOT”, dokument opisuje gotówkę; „ROR” oznacza przelew na rachunek.
            </div>
          )}

          {requiresDocument && (
            <div>
              <div className="mb-2 text-xs text-[#e5e4e2]/65">
                Dokument źródłowy <span className="text-[#e5e4e2]/40">— {action.documentLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  selectFile(event.dataTransfer.files?.[0]);
                }}
                className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#1c1f33] p-4 text-center hover:border-[#d3bb73]/40"
              >
                {file ? (
                  <>
                    <FileText className="mb-2 h-6 w-6 text-[#d3bb73]" />
                    <span className="max-w-full truncate text-sm text-[#e5e4e2]">{file.name}</span>
                    <span className="mt-1 text-xs text-[#e5e4e2]/45">Kliknij, aby zmienić plik</span>
                  </>
                ) : (
                  <>
                    <Upload className="mb-2 h-6 w-6 text-[#d3bb73]" />
                    <span className="text-sm text-[#e5e4e2]">Przeciągnij dokument lub kliknij</span>
                    <span className="mt-1 text-xs text-[#e5e4e2]/40">PDF, JPG, PNG lub WEBP · maks. 15 MB</span>
                  </>
                )}
              </button>
              <input
                ref={inputRef}
                hidden
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
            </div>
          )}

          <div className={`rounded-lg border p-3 text-xs leading-relaxed ${resolved ? 'border-emerald-400/15 bg-emerald-400/5 text-emerald-100/80' : 'border-amber-400/15 bg-amber-400/5 text-amber-100/80'}`}>
            {isVatTransfer
              ? selectedVatCounterpartId
                ? 'Po zapisaniu obie operacje zostaną połączone i uznane za wyjaśnione bez dokumentu.'
                : 'Wybierz odpowiadającą operację z drugiego rachunku, aby zamknąć obie strony transferu.'
              : resolved
              ? 'Po zapisaniu pozycja zostanie uznana za wyjaśnioną bez faktury i zniknie z listy do rozliczenia.'
              : action.alwaysPending
                ? 'Pozycja pozostanie na liście do czasu pozyskania właściwej faktury.'
                : 'Bez dokumentu pozycja pozostanie na liście do kontroli.'}
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:bg-white/5">
            Anuluj
          </button>
          <button
            type="button"
            disabled={saving || !note.trim() || (isVatTransfer && !selectedVatCounterpartId)}
            onClick={() => void save()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#141827] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz
          </button>
        </footer>
      </div>
    </div>
  );
}
