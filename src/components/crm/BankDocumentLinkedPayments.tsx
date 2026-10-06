'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FileText, Link as LinkIcon, Loader2, MessageSquare, RefreshCw, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import BankTransactionDetailsModal, { type BankTransactionDetailsTransaction } from './BankTransactionDetailsModal';
import BankTransactionDocumentPickerModal from './BankTransactionDocumentPickerModal';
import BankTransactionAccountingModal, { type BankAccountingSubtype } from './BankTransactionAccountingModal';

type Document = { id: string; source: 'ksef' | 'crm' | 'external' | 'personnel'; number: string };
type Props = {
  document: Document;
  refreshKey: number;
  onFindPayment: () => void;
  onDocumentNoteChanged: (note: string) => void;
  onLinkedStateChange: (hasLinks: boolean) => void;
  onSaved: () => void;
};
type Allocation = {
  id: string; bank_transaction_id: string; amount: number; currency: string;
  document_amount: number | null; document_currency: string | null;
};
type Link = { bank: BankTransactionDetailsTransaction; allocations: Allocation[]; legacy: boolean };
type Snapshot = { links: Link[]; note: string | null; canManage: boolean; canManageDocument: boolean };
type NoteEditor = {
  target: 'document' | 'payment'; id: string; table: string; field: 'accounting_note' | 'notes';
  original: string | null; draft: string; templates: string[];
};
const tableFor = (source: Document['source']) => source === 'crm' ? 'invoices'
  : source === 'ksef' ? 'ksef_invoices' : source === 'external' ? 'external_invoices' : 'personnel_contract_payments';
const money = (value: number, currency: string) => `${Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const date = (value: string) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : 'nie zapisano daty';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-100 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4bf73]/30 disabled:cursor-not-allowed disabled:opacity-40';

async function read<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const result = await query;
  if (result.error) throw new Error('Nie udało się pobrać aktualnych danych lub brakuje uprawnień. Spróbuj ponownie.');
  return result.data as T;
}

async function pages<T>(table: string, fields: string, column: string, ids: string[]) {
  if (!ids.length) return [] as T[];
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    for (let from = 0; ; from += 200) {
      const page = await read<T[]>(supabase.from(table).select(fields).in(column, ids.slice(start, start + 100)).order('id').range(from, from + 199));
      rows.push(...page);
      if (page.length < 200) break;
    }
  }
  return rows;
}

async function loadSnapshot(document: Document): Promise<Snapshot> {
  const personnel = document.source === 'personnel';
  const table = tableFor(document.source);
  const fields = personnel
    ? 'id,notes,amount,currency,bank_transaction_id,personnel_contracts!personnel_contract_payments_personnel_contract_id_fkey!inner(my_company_id)'
    : document.source === 'external' ? 'id,my_company_id,accounting_note'
      : 'id,my_company_id,accounting_note,ksef_reference_number' + (document.source === 'ksef' ? ',invoice_id' : '');
  if (personnel && await read<boolean>(supabase.rpc('can_view_personnel_contracts')) !== true) {
    throw new Error('Brak dostępu do rozliczeń kadrowych. Nie można potwierdzić powiązania wypłaty.');
  }
  const [row, canManage, canManagePersonnel] = await Promise.all([
    read<Record<string, any> | null>(supabase.from(table).select(fields).eq('id', document.id).maybeSingle()),
    read<boolean>(supabase.rpc('finance_can_manage')),
    personnel ? read<boolean>(supabase.rpc('can_manage_personnel_contracts')) : Promise.resolve(false),
  ]);
  if (!row) throw new Error('Dokument jest niedostępny. Nie można uznać braku odczytu za brak płatności.');
  const contract = Array.isArray(row.personnel_contracts) ? row.personnel_contracts[0] : row.personnel_contracts;
  const companyId = personnel ? contract?.my_company_id : row.my_company_id;
  if (!companyId) throw new Error('Dokument nie ma potwierdzonej działalności. Najpierw uzupełnij ją w dokumencie.');
  const crmIds = new Set<string>(document.source === 'crm' ? [document.id] : []);
  const ksefIds = new Set<string>(document.source === 'ksef' ? [document.id] : []);
  // Follow stored identity links only. A similar number, amount or seller is never an alias.
  if (document.source === 'crm' || document.source === 'ksef') {
    if (row.invoice_id) {
      const alias = await read<Record<string, any> | null>(supabase.from('invoices').select('id,my_company_id,ksef_reference_number').eq('id', row.invoice_id).maybeSingle());
      if (!alias || alias.my_company_id !== companyId || (alias.ksef_reference_number && row.ksef_reference_number && alias.ksef_reference_number !== row.ksef_reference_number)) {
        throw new Error('Nie można potwierdzić zapisanego połączenia CRM ↔ KSeF. Sprawdź dokument przed dalszym dopasowaniem.');
      }
      crmIds.add(alias.id);
    }
    if (row.ksef_reference_number) {
      const aliases = await pages<{ id: string; my_company_id: string }>('invoices', 'id,my_company_id', 'ksef_reference_number', [row.ksef_reference_number]);
      aliases.filter((alias) => alias.my_company_id === companyId).forEach((alias) => crmIds.add(alias.id));
    }
    const ksefAliases = await pages<{ id: string; my_company_id: string }>('ksef_invoices', 'id,my_company_id', 'invoice_id', [...crmIds]);
    ksefAliases.filter((alias) => alias.my_company_id === companyId).forEach((alias) => ksefIds.add(alias.id));
    if (row.ksef_reference_number) {
      const aliases = await pages<{ id: string; my_company_id: string }>('ksef_invoices', 'id,my_company_id', 'ksef_reference_number', [row.ksef_reference_number]);
      aliases.filter((alias) => alias.my_company_id === companyId).forEach((alias) => ksefIds.add(alias.id));
    }
  }
  const ledgerFields = 'id,bank_transaction_id,amount,currency,document_amount,document_currency';
  const groups = await Promise.all([
    pages<Allocation>('bank_transaction_invoice_matches', ledgerFields, 'invoice_id', [...crmIds]),
    pages<Allocation>('bank_transaction_invoice_matches', ledgerFields, 'ksef_invoice_id', [...ksefIds]),
    pages<Allocation>('bank_transaction_invoice_matches', ledgerFields, 'external_invoice_id', document.source === 'external' ? [document.id] : []),
  ]);
  const allocations = [...new Map(groups.flat().map((item) => [item.id, item])).values()];
  if (personnel && row.bank_transaction_id) allocations.push({ id: `personnel:${row.id}`, bank_transaction_id: row.bank_transaction_id, amount: Number(row.amount), currency: row.currency, document_amount: Number(row.amount), document_currency: row.currency });
  const legacy = await pages<BankTransactionDetailsTransaction>('bank_transactions', '*', 'matched_invoice_id', [...ksefIds]);
  const bankIds = [...new Set([...allocations.map((item) => item.bank_transaction_id), ...legacy.map((item) => item.id)])];
  const banks = await pages<BankTransactionDetailsTransaction>('bank_transactions', '*', 'id', bankIds);
  if (banks.length !== bankIds.length) throw new Error('Część powiązanych płatności jest niedostępna. Nie twórz ponownego dopasowania.');
  const statements = await pages<{ id: string; my_company_id: string }>('bank_statements', 'id,my_company_id', 'id', [...new Set(banks.map((bank) => bank.statement_id))]);
  const statementCompanies = new Map(statements.map((statement) => [statement.id, statement.my_company_id]));
  if (banks.some((bank) => statementCompanies.get(bank.statement_id) !== companyId)) throw new Error('Nie można potwierdzić działalności wyciągu powiązanej płatności.');
  return {
    note: personnel ? row.notes : row.accounting_note, canManage: canManage === true,
    canManageDocument: canManage === true && (!personnel || canManagePersonnel === true),
    links: banks.map((bank) => ({
      bank: { ...bank, company_id: companyId }, allocations: allocations.filter((item) => item.bank_transaction_id === bank.id),
      legacy: !allocations.some((item) => item.bank_transaction_id === bank.id),
    })).sort((a, b) => a.bank.transaction_date.localeCompare(b.bank.transaction_date)),
  };
}

function allocationText(link: Link) {
  if (link.legacy) return 'Starsze powiązanie — brak kwoty alokacji w rejestrze.';
  const totals = new Map<string, number>();
  for (const item of link.allocations) {
    const currency = item.document_currency || item.currency;
    totals.set(currency, (totals.get(currency) || 0) + Number(item.document_amount ?? item.amount));
  }
  const bankAmount = link.allocations.reduce((sum, item) => sum + Number(item.amount), 0);
  return `Do tego dokumentu: ${[...totals].map(([currency, amount]) => money(amount, currency)).join(' + ')}${[...totals.keys()].some((currency) => currency !== link.bank.currency) ? ` (z wyciągu ${money(bankAmount, link.bank.currency)})` : ''}.`;
}

function allegroTemplate(link: Link, target: 'document' | 'payment') {
  const bank = link.bank;
  if (bank.transaction_type !== 'debit' || !/allegro/i.test([bank.counterparty_name, bank.title, bank.raw_description].join(' '))) return null;
  const description = Number(bank.matched_document_count) > 1
    ? 'Jedna płatność zbiorcza przez Allegro, obejmująca kilka faktur.' : 'Jednorazowa płatność przez Allegro.';
  const reference = bank.reference_number?.trim() ? `Numer płatności z wyciągu: ${bank.reference_number.trim()}.` : 'Numer płatności nie został zapisany na wyciągu.';
  return `${description} Data płatności: ${date(bank.transaction_date)}. Łączna kwota płatności: ${money(Math.abs(Number(bank.amount)), bank.currency)}. ${reference}${target === 'document' ? ` ${allocationText(link)}` : ''}`;
}

export default function BankDocumentLinkedPayments(props: Props) {
  const { document: currentDocument, refreshKey } = props;
  const callbacks = useRef(props); callbacks.current = props;
  const epoch = useRef(0);
  const lifetime = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<BankTransactionDetailsTransaction | null>(null);
  const [child, setChild] = useState<'all' | 'personnel' | 'explain' | null>(null);
  const [editor, setEditor] = useState<NoteEditor | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [message, setMessage] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const editorTitleId = useId();
  const noteSavingRef = useRef(false); noteSavingRef.current = noteSaving;

  useEffect(() => {
    ++lifetime.current;
    setSelected(null); setChild(null); setEditor(null); setMessage(''); setNoteError(''); setNoteLoading(false); setNoteSaving(false);
    return () => { ++lifetime.current; };
  }, [currentDocument.id, currentDocument.source]);

  useEffect(() => {
    const request = ++epoch.current;
    setLoading(true); setError(''); setSnapshot(null);
    void loadSnapshot(currentDocument).then((fresh) => {
      if (request !== epoch.current) return;
      setSnapshot(fresh); setLoading(false);
      callbacks.current.onLinkedStateChange(fresh.links.length > 0);
      callbacks.current.onDocumentNoteChanged(fresh.note || '');
      setSelected((current) => current ? fresh.links.find((link) => link.bank.id === current.id)?.bank || current : null);
    }).catch((cause) => {
      if (request === epoch.current) { setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać powiązanych płatności.'); setLoading(false); }
    });
    return () => { ++epoch.current; };
  }, [currentDocument.id, currentDocument.source, refreshKey, revision]);

  useEffect(() => {
    if (!editor) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editorRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!noteSavingRef.current) setEditor(null); }
      if (event.key !== 'Tab') return;
      event.stopImmediatePropagation();
      const elements = Array.from(editorRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || []).filter((item) => item.offsetParent !== null);
      const first = elements[0]; const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); editorRef.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === editorRef.current || !editorRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !editorRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); if (previous?.isConnected) previous.focus(); };
  }, [Boolean(editor)]);

  const refresh = () => { setRevision((value) => value + 1); callbacks.current.onSaved(); };
  const openNote = async (target: 'document' | 'payment', bankId?: string) => {
    const request = lifetime.current;
    setNoteLoading(true); setNoteError(''); setMessage('');
    try {
      const fresh = await loadSnapshot(currentDocument);
      if (request !== lifetime.current) return;
      if (!fresh.canManage || (target === 'document' && !fresh.canManageDocument)) throw new Error('Brak uprawnień do zapisu opisu.');
      const link = bankId ? fresh.links.find((item) => item.bank.id === bankId) : undefined;
      if (target === 'payment' && !link) throw new Error('Powiązanie płatności zmieniło się. Odśwież dane.');
      const original = target === 'payment' ? link!.bank.accounting_note ?? null : fresh.note ?? null;
      const templates = (target === 'payment' ? [link!] : fresh.links).map((item) => allegroTemplate(item, target)).filter((item): item is string => Boolean(item));
      setSnapshot(fresh);
      setEditor({ target, id: target === 'payment' ? link!.bank.id : currentDocument.id,
        table: target === 'payment' ? 'bank_transactions' : tableFor(currentDocument.source),
        field: target === 'document' && currentDocument.source === 'personnel' ? 'notes' : 'accounting_note', original, draft: original || '', templates });
    } catch (cause) {
      if (request === lifetime.current) setNoteError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć opisu.');
    } finally { if (request === lifetime.current) setNoteLoading(false); }
  };

  const saveNote = async () => {
    if (!editor || noteSaving) return;
    const request = lifetime.current;
    setNoteSaving(true); setNoteError('');
    try {
      if (await read<boolean>(supabase.rpc('finance_can_manage')) !== true || (editor.field === 'notes' && await read<boolean>(supabase.rpc('can_manage_personnel_contracts')) !== true)) throw new Error('Brak uprawnień do zmiany opisu.');
      if (request !== lifetime.current) return;
      // Update only the note, and only if nobody edited it since opening the editor.
      const note = editor.draft.trim();
      let query = supabase.from(editor.table).update({ [editor.field]: note }).eq('id', editor.id);
      query = editor.original == null ? query.is(editor.field, null) : query.eq(editor.field, editor.original);
      const result = await query.select('id');
      if (result.error) throw new Error('Nie udało się zapisać opisu. Twoja treść pozostała w edytorze.');
      if (result.data?.length !== 1) throw new Error('Opis zmienił się w międzyczasie lub utracono dostęp. Skopiuj swoją treść i otwórz opis ponownie — niczego nie nadpisano.');
      if (request !== lifetime.current) return;
      if (editor.target === 'document') callbacks.current.onDocumentNoteChanged(note);
      setEditor(null); setMessage('Opis zapisany. Dopasowania i kwoty pozostały bez zmian.'); refresh();
    } catch (cause) {
      if (request === lifetime.current) setNoteError(cause instanceof Error ? cause.message : 'Nie udało się zapisać opisu.');
    } finally { if (request === lifetime.current) setNoteSaving(false); }
  };

  return <div className="space-y-3 text-sm normal-case" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
    {loading && <p role="status" className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={14} className="animate-spin" />Sprawdzam zapisane płatności…</p>}
    {error && <div role="alert" className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">{error}<button type="button" className={`${button} mt-2`} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} />Ponów odczyt</button></div>}
    {snapshot && !loading && <>
      {snapshot.links.map((link) => <div key={link.bank.id} className="space-y-2 rounded-lg bg-black/20 p-3">
        <p className="font-semibold text-green-300">Zapisana płatność · {date(link.bank.transaction_date)} · {money(Math.abs(Number(link.bank.amount)), link.bank.currency)}</p>
        <p className="break-words text-xs text-gray-300 [overflow-wrap:anywhere]">Numer z wyciągu: {link.bank.reference_number || 'nie zapisano'}</p>
        <p className="text-xs text-gray-300">{allocationText(link)}</p>
        {link.bank.accounting_note && <p className="whitespace-pre-wrap break-words text-xs text-gray-400 [overflow-wrap:anywhere]">Opis płatności: {link.bank.accounting_note}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setSelected(link.bank)}><LinkIcon size={14} />Pokaż płatność</button>
          <button type="button" className={button} disabled={!snapshot.canManage || noteLoading} onClick={() => void openNote('payment', link.bank.id)}><MessageSquare size={14} />Opisz płatność</button></div>
      </div>)}
      {snapshot.note && <p className="whitespace-pre-wrap break-words rounded-lg bg-black/10 p-3 text-xs text-gray-300 [overflow-wrap:anywhere]">Aktualny opis dokumentu: {snapshot.note}</p>}
      <div className="flex flex-wrap gap-2">
        {!snapshot.links.length && <button type="button" className={button} onClick={() => callbacks.current.onFindPayment()}><Search size={14} />Znajdź płatność</button>}
        <button type="button" className={button} disabled={!snapshot.canManageDocument || noteLoading} onClick={() => void openNote('document')}><FileText size={14} />Opisz dokument</button>
      </div>
    </>}
    {message && <p role="status" className="text-xs text-green-300">{message}</p>}
    {noteError && !editor && <p role="alert" className="text-xs text-amber-200">{noteError}</p>}
    {selected && !child && !editor && <BankTransactionDetailsModal key={`${selected.id}:${revision}`} transaction={selected} onClose={() => setSelected(null)}
      onMatchDocuments={(fresh) => { setSelected(fresh); setChild('all'); }} onMatchPersonnel={(fresh) => { setSelected(fresh); setChild('personnel'); }}
      onExplain={(fresh) => { setSelected(fresh); setChild('explain'); }}
      onDescribe={(fresh) => { setSelected(fresh); void openNote('payment', fresh.id); }} />}
    {selected && child && child !== 'explain' && <BankTransactionDocumentPickerModal transaction={selected} initialSource={child} onClose={() => setChild(null)} onMatched={() => { setChild(null); refresh(); }} />}
    {selected && child === 'explain' && <BankTransactionAccountingModal transaction={selected} initialSubtype={(selected.accounting_subtype || 'other') as BankAccountingSubtype}
      onClose={() => setChild(null)} onSaved={() => { setChild(null); refresh(); }} />}
    {editor && <div className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/75 p-4" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && !noteSaving) setEditor(null); }}>
      <div ref={editorRef} role="dialog" aria-modal="true" aria-labelledby={editorTitleId} tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[#191a29] text-gray-100 shadow-2xl outline-none ring-1 ring-white/10">
        <header className="flex items-center justify-between gap-3 bg-[#401426] p-4"><h3 id={editorTitleId} className="text-base font-semibold">{editor.target === 'document' ? `Opis dokumentu ${currentDocument.number}` : 'Opis przypisanej płatności'}</h3><button type="button" aria-label="Zamknij opis" className={button} disabled={noteSaving} onClick={() => setEditor(null)}><X size={18} /></button></header>
        <div className="space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-gray-400">Zapis zmieni wyłącznie ten opis. Nie zmieni kwot, statusów ani istniejących dopasowań.</p>
          <label className="block text-xs text-gray-300" htmlFor={`${editorTitleId}-note`}>Treść opisu</label>
          <textarea id={`${editorTitleId}-note`} value={editor.draft} disabled={noteSaving} rows={8} className="w-full resize-y rounded-lg border-0 bg-black/20 p-3 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-[#d4bf73]/25" onChange={(event) => setEditor({ ...editor, draft: event.target.value })} />
          {!!editor.templates.length && <button type="button" className={button} disabled={noteSaving} onClick={() => setEditor((current) => {
            if (!current) return current;
            const missing = current.templates.filter((template) => {
              if (current.draft.includes(template)) return false;
              const link = snapshot?.links.find((item) => allegroTemplate(item, current.target) === template);
              const reference = link?.bank.reference_number?.trim();
              return !(reference && /allegro/i.test(current.draft) && current.draft.includes(reference));
            });
            return { ...current, draft: [current.draft.trim(), ...missing].filter(Boolean).join('\n\n') };
          })}>Dodaj opis płatności Allegro</button>}
          {noteError && <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">{noteError}</p>}
        </div>
        <footer className="flex justify-end gap-2 bg-black/20 p-4"><button type="button" className={button} disabled={noteSaving} onClick={() => setEditor(null)}>Anuluj</button><button type="button" className={`${button} !bg-[#d4bf73] !text-[#191a29]`} disabled={noteSaving} onClick={() => void saveNote()}>{noteSaving && <Loader2 size={14} className="animate-spin" />}Zapisz opis</button></footer>
      </div>
    </div>}
  </div>;
}
