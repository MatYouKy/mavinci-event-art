'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { externalDocumentKindLabel, isExternalDocumentKind } from '@/lib/invoices/externalDocumentKinds';

export type InvoiceScanField =
  | 'document_kind'
  | 'seller_name'
  | 'seller_nip'
  | 'invoice_number'
  | 'invoice_date'
  | 'label'
  | 'payment_method'
  | 'amount_net'
  | 'amount_gross'
  | 'currency';

type InvoiceScanValues = Record<InvoiceScanField, string>;
type RecognizedValues = Partial<InvoiceScanValues>;
type ReviewResult = {
  fields: RecognizedValues;
  amountVat: number | null;
  buyerName: string | null;
  buyerNip: string | null;
  kind: string;
  warnings: string[];
};

const FIELD_LABELS: Record<InvoiceScanField, string> = {
  document_kind: 'Rodzaj dokumentu',
  seller_name: 'Sprzedawca / wystawca / ubezpieczyciel',
  seller_nip: 'NIP / identyfikator podatkowy wystawcy',
  invoice_number: 'Numer dokumentu / polisy / umowy',
  invoice_date: 'Data wystawienia',
  label: 'Nazwa opisowa',
  payment_method: 'Sposób płatności',
  amount_net: 'Kwota netto',
  amount_gross: 'Kwota dokumentu / składka całkowita',
  currency: 'Waluta',
};
const FIELD_KEYS = Object.keys(FIELD_LABELS) as InvoiceScanField[];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readResult(payload: unknown): ReviewResult {
  if (!isObject(payload) || payload.success !== true || !isObject(payload.data)) {
    throw new Error(isObject(payload) ? nonemptyText(payload.error) || 'Nie udało się odczytać dokumentu.' : 'Nie udało się odczytać dokumentu.');
  }
  const data = payload.data;
  if (!isExternalDocumentKind(data.document_kind)) {
    throw new Error('Nie rozpoznano obsługiwanego rodzaju dokumentu. Uzupełnij dane ręcznie lub wybierz właściwy plik.');
  }
  if (!isObject(data.fields)) throw new Error('Odczyt nie zawiera danych formularza. Spróbuj ponownie.');

  const fields: RecognizedValues = {};
  for (const key of FIELD_KEYS) {
    const value = data.fields[key];
    if (key === 'amount_net' || key === 'amount_gross') {
      const amount = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
      if (Number.isFinite(amount)) fields[key] = String(amount);
    } else {
      const text = nonemptyText(value);
      if (text) fields[key] = text;
    }
  }
  fields.document_kind = data.document_kind;

  return {
    fields,
    amountVat: typeof data.amount_vat === 'number' && Number.isFinite(data.amount_vat) ? data.amount_vat : null,
    buyerName: nonemptyText(data.buyer_name),
    buyerNip: nonemptyText(data.buyer_nip),
    kind: nonemptyText(data.document_kind) || 'invoice',
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).slice(0, 20) : [],
  };
}

function displayedValue(field: InvoiceScanField, value: string): string {
  if (field === 'document_kind') return externalDocumentKindLabel(value);
  if (field === 'invoice_date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
  }
  if ((field === 'amount_net' || field === 'amount_gross') && value.trim() && Number.isFinite(Number(value))) {
    return Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return value;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const fallback = 'Nie udało się odczytać dokumentu. Sprawdź połączenie i spróbuj ponownie.';
  if (!isObject(error)) return fallback;
  const context = error.context;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.clone().json();
      if (isObject(body)) {
        const message = nonemptyText(body.error) || nonemptyText(body.message);
        if (message) return message;
      }
    } catch {
      // Some gateway errors have no JSON body; use their HTTP status below.
    }
    if (context.status === 401) return 'Sesja wygasła. Zaloguj się ponownie, aby odczytać dokument.';
    if (context.status === 403) return 'Nie masz uprawnień do odczytu dokumentów tej działalności.';
    if (context.status === 429) return 'Osiągnięto limit odczytów. Spróbuj ponownie za chwilę.';
  }
  return fallback;
}

export function InvoiceScanAssistant({
  file,
  companyId,
  currentValues,
  disabled = false,
  onApply,
  onBusyChange,
}: {
  file: File | null;
  companyId: string;
  currentValues: InvoiceScanValues;
  disabled?: boolean;
  onApply: (values: RecognizedValues) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ file: File; companyId: string; data: ReviewResult } | null>(null);
  // Each selection remembers the value the user saw, protecting later manual edits.
  const [selected, setSelected] = useState<Partial<InvoiceScanValues>>({});
  const requestId = useRef(0);
  const mounted = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ file, companyId, currentValues, onBusyChange });
  latest.current = { file, companyId, currentValues, onBusyChange };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      latest.current.onBusyChange?.(false);
    };
  }, []);

  useEffect(() => {
    requestId.current += 1;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setBusy(false);
    setResult(null);
    setSelected({});
    setError(null);
    setMessage(null);
  }, [file, companyId]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    setSelected((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const key of FIELD_KEYS) {
        if (Object.prototype.hasOwnProperty.call(previous, key) && previous[key] !== currentValues[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [currentValues]);

  const review = result?.file === file && result.companyId === companyId ? result.data : null;
  const recognizedKeys = review ? FIELD_KEYS.filter((key) => review.fields[key] !== undefined) : [];
  const selectedKeys = recognizedKeys.filter((key) => Object.prototype.hasOwnProperty.call(selected, key) && selected[key] === currentValues[key]);
  const kindNeedsApproval = Boolean(review && review.kind !== currentValues.document_kind && !selectedKeys.includes('document_kind'));

  const analyze = async () => {
    if (!file || !companyId || disabled || busy) return;
    setError(null);
    setMessage(null);
    if (!file.size || file.size > MAX_FILE_BYTES) {
      setError('Wybierz niepusty plik o rozmiarze do 10 MB.');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type) && !(file.type === '' && /\.(pdf|jpe?g|png|webp)$/i.test(file.name))) {
      setError('Odczyt AI obsługuje PDF oraz zdjęcia JPG, PNG i WebP.');
      return;
    }

    const activeId = ++requestId.current;
    const sourceFile = file;
    const sourceCompany = companyId;
    const isCurrent = () => mounted.current && requestId.current === activeId && latest.current.file === sourceFile && latest.current.companyId === sourceCompany;
    setBusy(true);
    setResult(null);
    setSelected({});

    try {
      const body = new FormData();
      body.append('file', sourceFile);
      body.append('company_id', sourceCompany);
      const timeout = new Promise<never>((_, reject) => {
        timeoutRef.current = setTimeout(() => reject(new Error('Odczyt trwa zbyt długo. Spróbuj ponownie lub uzupełnij formularz ręcznie.')), 120_000);
      });
      const response = await Promise.race([
        supabase.functions.invoke('extract-external-invoice', { body }),
        timeout,
      ]);
      if (!isCurrent()) return;
      if (response.error) throw new Error(await functionErrorMessage(response.error));
      const parsed = readResult(response.data);
      if (!isCurrent()) return;

      const initialSelection: Partial<InvoiceScanValues> = {};
      for (const key of FIELD_KEYS) {
        if (parsed.fields[key] !== undefined && !latest.current.currentValues[key].trim()) {
          initialSelection[key] = latest.current.currentValues[key];
        }
      }
      setResult({ file: sourceFile, companyId: sourceCompany, data: parsed });
      setSelected(initialSelection);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Nie udało się odczytać dokumentu. Spróbuj ponownie.');
    } finally {
      if (requestId.current === activeId) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const cancelWaiting = () => {
    requestId.current += 1;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setBusy(false);
    setMessage('Przerwano oczekiwanie. Analiza na serwerze może jeszcze trwać, ale jej wynik nie zostanie użyty.');
  };

  const toggleField = (key: InvoiceScanField) => {
    setMessage(null);
    setSelected((previous) => {
      const next = { ...previous };
      if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
      else next[key] = currentValues[key];
      return next;
    });
  };

  const applySelected = () => {
    if (!review || disabled || busy || kindNeedsApproval) return;
    const values: RecognizedValues = {};
    for (const key of selectedKeys) {
      if (selected[key] === latest.current.currentValues[key]) values[key] = review.fields[key];
    }
    const count = Object.keys(values).length;
    if (!count) return;
    onApply(values);
    setSelected({});
    setMessage(`Przeniesiono dane do formularza (${count} pól). Sprawdź je przed zapisaniem dokumentu. Status i data zapłaty nie zostały zmienione.`);
  };

  return (
    <section className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 font-sans normal-case text-[#e5e4e2]" aria-label="Asystent odczytu dokumentu">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-[#d3bb73]" aria-hidden="true" />Asystent odczytu dokumentu</p>
          <p className="mt-1 text-xs leading-relaxed text-[#e5e4e2]/60">
            Po kliknięciu „Odczytaj AI” ten plik zostanie przesłany do OpenAI. AI odczyta dane, a Ty wybierzesz, które przenieść do formularza. Nic nie zapisze automatycznie.
          </p>
          {!file && <p className="mt-1 text-xs text-[#e5e4e2]/50">Najpierw dodaj plik lub wykonaj skan. Obsługiwane: PDF, JPG, PNG i WebP, do 10 MB.</p>}
          {file && !companyId && <p className="mt-1 text-xs text-[#d3bb73]">Wybierz działalność przed odczytem dokumentu.</p>}
        </div>
        <button type="button" onClick={analyze} disabled={!file || !companyId || disabled || busy} className={buttonClass}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {busy ? 'Odczytywanie…' : review ? 'Odczytaj ponownie' : 'Odczytaj AI'}
        </button>
      </div>

      {busy && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
          <p role="status" className="text-xs text-[#e5e4e2]/70">Odczytuję treść i kwoty. Dokument wielostronicowy może wymagać dłuższej chwili.</p>
          <button type="button" onClick={cancelWaiting} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#e5e4e2]/70 hover:bg-white/10 focus-visible:outline-none focus-visible:bg-white/10"><X className="h-3.5 w-3.5" aria-hidden="true" />Przerwij oczekiwanie</button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}

      {review && (
        <div className="mt-4 space-y-3">
          <div className="text-xs leading-relaxed text-[#e5e4e2]/65">
            <p>Porównaj dane ze skanem. Domyślnie zaznaczone są wyłącznie puste pola.</p>
            <p className="mt-1">Aby zastąpić obecną wartość — także domyślną datę, walutę lub sposób płatności — zaznacz dane pole. Ręczna zmiana formularza odznacza je ponownie.</p>
          </div>

          {review.kind === 'credit_note' && <p className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73]">Rozpoznano korektę. Sprawdź numer dokumentu oraz znaki kwot przed zapisaniem.</p>}
          {review.kind === 'receipt' && <p className="text-xs text-[#e5e4e2]/65">Rozpoznano paragon — sprawdź numer dokumentu i dane nabywcy.</p>}
          {review.kind === 'insurance_policy' && <p className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73]">Rozpoznano polisę. Zweryfikuj składkę całkowitą oraz raty — suma ubezpieczenia nie jest kwotą do zapłaty.</p>}
          {kindNeedsApproval && <p className="text-xs text-[#d3bb73]">Rozpoznany rodzaj różni się od wybranego w formularzu. Zaznacz pole „Rodzaj dokumentu” lub sprawdź i zmień je ręcznie przed przeniesieniem danych.</p>}
          {!!review.warnings.length && (
            <div className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs leading-relaxed text-[#d3bb73]">
              <p className="font-medium">Do sprawdzenia</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">{review.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
            </div>
          )}

          {recognizedKeys.length ? (
            <div className="divide-y divide-white/5 overflow-hidden rounded-lg bg-black/10">
              {recognizedKeys.map((key) => {
                const value = review.fields[key]!;
                const current = currentValues[key];
                const same = current.trim() === value;
                return (
                  <label key={key} className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.04] ${disabled || same ? 'opacity-60' : ''}`}>
                    <input type="checkbox" checked={selectedKeys.includes(key)} disabled={disabled || busy || same} onChange={() => toggleField(key)} className="mt-1 h-4 w-4 shrink-0 accent-[#d3bb73] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(211,187,115,0.18)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-[#e5e4e2]/55">{FIELD_LABELS[key]}</span>
                      <span className="mt-0.5 block break-words text-sm">{displayedValue(key, value)}</span>
                      {same ? <span className="mt-0.5 block text-xs text-emerald-300/80">Już w formularzu</span> : current.trim() ? <span className="mt-0.5 block break-words text-xs text-[#e5e4e2]/50">Obecnie: {displayedValue(key, current)}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : <p className="text-xs text-[#e5e4e2]/65">Nie udało się odczytać danych formularza. Wybierz wyraźniejszy skan lub uzupełnij pola ręcznie.</p>}

          {(review.amountVat !== null || review.buyerName || review.buyerNip) && (
            <div className="space-y-1 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-[#e5e4e2]/65">
              <p className="font-medium text-[#e5e4e2]/80">Informacje do porównania ze skanem (bez zmiany formularza)</p>
              {review.amountVat !== null && <p>VAT: {review.amountVat.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {review.fields.currency || ''}</p>}
              {review.buyerName && <p className="break-words">Nabywca: {review.buyerName}</p>}
              {review.buyerNip && <p className="break-words">NIP nabywcy: {review.buyerNip}</p>}
              {(review.buyerName || review.buyerNip) && <p>Sprawdź, czy nabywca jest zgodny z wybraną działalnością.</p>}
            </div>
          )}
          {!!recognizedKeys.length && <button type="button" onClick={applySelected} disabled={!selectedKeys.length || disabled || busy || kindNeedsApproval} className={buttonClass}><Check className="h-4 w-4" aria-hidden="true" />Uzupełnij zaznaczone pola ({selectedKeys.length})</button>}
        </div>
      )}
      {message && <p role="status" className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-[#e5e4e2]/75">{message}</p>}
    </section>
  );
}
