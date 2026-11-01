'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { canFinanceCompany, filterFinanceCompanies } from '@/lib/invoices/financeAccess';
import {
  RECURRING_CONTRACT_CYCLE_LABELS,
  RECURRING_CONTRACT_DIRECTION_LABELS,
  RECURRING_CONTRACT_KIND_LABELS,
  RECURRING_PERIOD_STATUS_META,
  accountDigits,
  contractMatchEvidence,
  defaultContractPeriod,
  formatAccount,
  matchMethodLabel,
  recurringContractSummarySentence,
  type RecurringContract,
  type RecurringContractCycle,
  type RecurringContractDirection,
  type RecurringContractKind,
  type RecurringContractPeriod,
} from '@/lib/invoices/bankReconciliation';

const BUCKET = 'finance-contracts';
const card = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const input = 'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';
const select = 'rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2]';

const money = (value: number | string | null | undefined, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');
const num = (value: string) => {
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const CYCLE_MONTHS: Record<RecurringContractCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };

interface Company { id: string; name: string }

interface Props {
  filterCompanyIds?: string[] | null;
  /** Przejście do uzgodnienia wyciągów (tam przypisuje się przelewy). */
  onOpenReconciliation?: () => void;
}

/** Rejestr „Umowy stałe”: najem, leasing, abonamenty, raty — okresy i płatności z wyciągów. */
export default function RecurringContractsPanel({ filterCompanyIds = null, onOpenReconciliation }: Props) {
  const { showSnackbar } = useSnackbar();
  const { access } = useInvoiceFinanceAccess();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  // Umowy widzi poziom „Podgląd finansów” działalności; zmienia tylko „Zarządzanie finansami” tej działalności.
  const canManage = canFinanceCompany(access, companyId, 'finance_manage');
  const [rows, setRows] = useState<RecurringContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'active' | 'ended' | 'all'>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<RecurringContract | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const companyKey = filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    if (!access) return () => { cancelled = true; };
    (async () => {
      let query = supabase.from('my_companies').select('id,name').eq('is_active', true).order('name');
      if (filterCompanyIds) query = query.in('id', filterCompanyIds.length ? filterCompanyIds : ['00000000-0000-0000-0000-000000000000']);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) { showSnackbar('Nie udało się wczytać firm.', 'error'); setLoading(false); return; }
      const list = filterFinanceCompanies(access, (data || []) as Company[], 'finance_view');
      setCompanies(list);
      setCompanyId((current) => (current && list.some((c) => c.id === current) ? current : list[0]?.id || ''));
      if (list.length === 0) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, access]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_finance_recurring_contracts', { p_company_id: companyId });
    if (error) { showSnackbar(error.message || 'Nie udało się wczytać umów stałych.', 'error'); setRows([]); }
    else setRows((data || []) as RecurringContract[]);
    setLoading(false);
  }, [companyId, showSnackbar]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => rows.filter((r) => statusFilter === 'all' || r.status === statusFilter), [rows, statusFilter]);
  const totals = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active');
    // Miesięczny koszt umów w PLN (kwartał i rok przeliczone na miesiąc) — orientacyjnie.
    const monthlyCost = active.filter((r) => r.direction === 'cost' && r.currency === 'PLN')
      .reduce((s, r) => s + Number(r.amount) / CYCLE_MONTHS[r.billing_cycle], 0);
    const monthlyIncome = active.filter((r) => r.direction === 'income' && r.currency === 'PLN')
      .reduce((s, r) => s + Number(r.amount) / CYCLE_MONTHS[r.billing_cycle], 0);
    const overdue = rows.reduce((s, r) => s + Number(r.summary?.overdue || 0), 0);
    const overdueAmount = rows.reduce((s, r) => s + Number(r.summary?.overdue_amount || 0), 0);
    return { active: active.length, monthlyCost, monthlyIncome, overdue, overdueAmount };
  }, [rows]);

  const run = async (key: string, action: () => PromiseLike<{ error: { message?: string } | null }>, success: string) => {
    setBusy(key);
    const { error } = await action();
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Operacja nie powiodła się.', 'error'); return false; }
    showSnackbar(success, 'success');
    await load();
    return true;
  };

  const removeContract = async (c: RecurringContract) => {
    const question = c.payments.length > 0
      ? `Umowa „${c.title}” ma przypisane płatności z wyciągów, więc nie zostanie usunięta — zostanie zakończona i zostanie w historii. Kontynuować?`
      : `Usunąć umowę „${c.title}”? Pliki umowy też zostaną usunięte.`;
    if (!window.confirm(question)) return;
    setBusy(`delete:${c.id}`);
    const { data, error } = await supabase.rpc('delete_finance_recurring_contract', { p_id: c.id });
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Nie udało się usunąć umowy.', 'error'); return; }
    const result = (data || {}) as { deleted?: boolean; ended?: boolean; paths?: string[] };
    if (result.paths?.length) await supabase.storage.from(BUCKET).remove(result.paths);
    showSnackbar(result.deleted ? 'Umowa usunięta.' : 'Umowa zakończona — zostaje w historii z płatnościami.', 'success');
    if (result.deleted) setOpenId(null);
    await load();
  };

  const upload = async (c: RecurringContract, file: File) => {
    if (file.size > 20 * 1024 * 1024) { showSnackbar('Plik jest większy niż 20 MB.', 'warning'); return; }
    setBusy(`upload:${c.id}`);
    const safe = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'plik';
    const path = `${c.company_id}/${c.id}/${Date.now()}-${safe}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream', upsert: false,
    });
    if (uploadError) { setBusy(null); showSnackbar(uploadError.message || 'Nie udało się wgrać pliku.', 'error'); return; }
    const { error } = await supabase.rpc('add_finance_recurring_contract_file', {
      p_contract_id: c.id, p_storage_path: path, p_file_name: file.name, p_mime_type: file.type || null, p_file_size: file.size,
    });
    setBusy(null);
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      showSnackbar(error.message || 'Nie udało się zapisać pliku.', 'error');
      return;
    }
    showSnackbar('Plik umowy dodany.', 'success');
    await load();
  };

  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { showSnackbar('Nie udało się otworzyć pliku.', 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const removeFile = async (fileId: string) => {
    if (!window.confirm('Usunąć plik z umowy?')) return;
    setBusy(`file:${fileId}`);
    const { data, error } = await supabase.rpc('remove_finance_recurring_contract_file', { p_file_id: fileId });
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Nie udało się usunąć pliku.', 'error'); return; }
    if (data) await supabase.storage.from(BUCKET).remove([data as string]);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]"><CalendarClock className="h-5 w-5 text-[#d3bb73]" /> Umowy stałe — najem, leasing, abonamenty</h3>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[#e5e4e2]/55">
              Zobowiązania i należności płacone co miesiąc, kwartał lub rok bez faktury za każdy okres — np. najem garażu od osoby
              prywatnej, rata pożyczki, abonament. Przelew na rachunek z umowy z kwotą okresu przypisuje się sam podczas uzgadniania
              wyciągu; inne przypiszesz w „Uzgodnieniu wyciągów” przyciskiem „Przypisz do umowy”. Tutaj widać, za które okresy zapłacono.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={select}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={select}>
              <option value="active">Aktywne</option>
              <option value="ended">Zakończone</option>
              <option value="all">Wszystkie</option>
            </select>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Odśwież
            </button>
            {canManage && companyId && (
              <button type="button" data-crm-action="primary" onClick={() => setForm('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799]">
                <Plus className="h-3.5 w-3.5" /> Dodaj umowę
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-2 border-t border-[#d3bb73]/10 pt-3 text-xs sm:grid-cols-3">
          <div><span className="text-[#e5e4e2]/45">Aktywne umowy: </span><span className="text-[#e5e4e2]">{totals.active}</span></div>
          <div>
            <span className="text-[#e5e4e2]/45">Miesięcznie (PLN): </span>
            <span className="text-[#e5e4e2]">koszty {money(totals.monthlyCost)}</span>
            {totals.monthlyIncome > 0 && <span className="text-green-300"> · przychody {money(totals.monthlyIncome)}</span>}
          </div>
          <div className={totals.overdue ? 'text-red-300' : 'text-green-400'}>
            {totals.overdue ? `${totals.overdue} ${totals.overdue === 1 ? 'okres' : 'okresów'} po terminie — brakuje ${money(totals.overdueAmount)}` : 'Brak zaległości.'}
          </div>
        </div>
      </div>

      <div className={card}>
        {loading ? (
          <div className="flex items-center justify-center py-14 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" /> Wczytywanie…</div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#e5e4e2]/55">
            {statusFilter === 'ended' ? 'Brak zakończonych umów.' : 'Brak umów stałych. Dodaj umowę (np. najem garażu) albo utwórz ją z płatności w „Uzgodnieniu wyciągów”.'}
          </div>
        ) : (
          <ul className="divide-y divide-[#d3bb73]/10">
            {visible.map((c) => {
              const open = openId === c.id;
              const recent = c.periods.slice(-12);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="flex w-full flex-col gap-2 px-4 py-3 text-left md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#e5e4e2]">{c.title}</span>
                        <span className="rounded bg-[#0f1119] px-1.5 py-0.5 text-[10px] text-[#e5e4e2]/55">{RECURRING_CONTRACT_KIND_LABELS[c.kind]}</span>
                        {c.direction === 'income' && <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-300">otrzymujemy</span>}
                        {c.status === 'ended' && <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] text-slate-300">zakończona {date(c.end_date)}</span>}
                        {c.expects_invoice && <span className="rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-[10px] text-[#d3bb73]">z fakturami</span>}
                        {c.files.length > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-[#e5e4e2]/45"><FileText className="h-3 w-3" />{c.files.length}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-[#e5e4e2]/55">{c.counterparty_name}{c.counterparty_account ? ` · ${formatAccount(c.counterparty_account)}` : ''}</p>
                      <p className="mt-0.5 text-[11px] text-[#e5e4e2]/45">{recurringContractSummarySentence(c, (v) => money(v, c.currency))}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <PeriodStrip periods={recent} currency={c.currency} compact />
                      <div className="text-right text-xs">
                        <div className="text-[#e5e4e2]">{money(c.amount, c.currency)}</div>
                        <div className="text-[10px] text-[#e5e4e2]/45">{RECURRING_CONTRACT_CYCLE_LABELS[c.billing_cycle]}</div>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-[#e5e4e2]/40 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {open && (
                    <ContractDetails
                      contract={c}
                      canManage={canManage}
                      busy={busy}
                      onEdit={() => setForm(c)}
                      onDelete={() => void removeContract(c)}
                      onUpload={(file) => void upload(c, file)}
                      onOpenFile={(path) => void openFile(path)}
                      onRemoveFile={(id) => void removeFile(id)}
                      onUndoPayment={(paymentId) => void run(`undo:${paymentId}`, () => supabase.rpc('undo_bank_recurring_contract_payment', { p_payment_id: paymentId }),
                        'Przelew odpięty od umowy. Nie zostanie przypięty ponownie automatycznie.')}
                      onOpenReconciliation={onOpenReconciliation}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {form && companyId && (
        <RecurringContractFormModal
          companyId={companyId}
          contract={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={async (id) => { setForm(null); setOpenId(id); await load(); }}
        />
      )}
    </div>
  );
}

/** Okresy jako kolorowe kratki: opłacone / brak / po terminie / przyszłe. */
function PeriodStrip({ periods, currency, compact = false }: { periods: RecurringContractPeriod[]; currency: string; compact?: boolean }) {
  if (periods.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? 'hidden max-w-[260px] justify-end lg:flex' : ''}`}>
      {periods.map((p) => {
        const meta = RECURRING_PERIOD_STATUS_META[p.status];
        const title = `${p.label} · ${meta.label}\nNależne ${money(p.amount, currency)}, zapłacono ${money(p.paid, currency)}${Number(p.missing) > 0.009 ? `, brakuje ${money(p.missing, currency)}` : ''}\nTermin płatności ${date(p.due_date)}`;
        return compact ? (
          <span key={p.period_start} title={title} className={`h-3 w-3 rounded-sm border ${meta.cell}`} />
        ) : (
          <span key={p.period_start} title={title} className={`min-w-[64px] rounded-md border px-1.5 py-1 text-center text-[10px] leading-tight ${meta.cell}`}>
            <span className="block font-medium">{p.label}</span>
            <span className="block opacity-80">{p.status === 'paid' || p.status === 'overpaid' ? money(p.paid, currency) : p.status === 'invoice' ? 'faktury' : Number(p.paid) > 0.009 ? `brak ${money(p.missing, currency)}` : meta.label.toLowerCase()}</span>
          </span>
        );
      })}
    </div>
  );
}

function ContractDetails({ contract: c, canManage, busy, onEdit, onDelete, onUpload, onOpenFile, onRemoveFile, onUndoPayment, onOpenReconciliation }: {
  contract: RecurringContract;
  canManage: boolean;
  busy: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: (file: File) => void;
  onOpenFile: (path: string) => void;
  onRemoveFile: (id: string) => void;
  onUndoPayment: (paymentId: string) => void;
  onOpenReconciliation?: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-[#d3bb73]/10 bg-[#161928] px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#e5e4e2]/55">
        <span>{RECURRING_CONTRACT_DIRECTION_LABELS[c.direction]}</span>
        <span>· od {date(c.start_date)} {c.end_date ? `do ${date(c.end_date)}` : '(czas nieokreślony)'}</span>
        {c.payments_from && <span>· rozliczane od {c.payments_from.slice(5, 7)}/{c.payments_from.slice(0, 4)}</span>}
        <span>· {money(c.amount, c.currency)} {RECURRING_CONTRACT_CYCLE_LABELS[c.billing_cycle]}{c.payment_day ? `, do ${c.payment_day}. dnia` : ''}</span>
        {c.counterparty_nip && <span>· NIP {c.counterparty_nip}</span>}
        {c.notes && <span>· {c.notes}</span>}
        {canManage && (
          <span className="ml-auto flex gap-2">
            <button type="button" className={ghost} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edytuj</button>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-red-400/25 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              disabled={busy === `delete:${c.id}` || (c.status === 'ended' && c.payments.length > 0)}
              title={c.payments.length > 0 ? 'Umowa z płatnościami zostanie zakończona, nie usunięta' : undefined} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> {c.payments.length > 0 ? 'Zakończ' : 'Usuń'}
            </button>
          </span>
        )}
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-xs font-medium text-[#e5e4e2]/80">Okresy</h5>
          <span className="flex flex-wrap gap-2 text-[10px] text-[#e5e4e2]/50">
            {(['paid', 'missing', 'overdue', 'upcoming'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm border ${RECURRING_PERIOD_STATUS_META[s].cell}`} />{RECURRING_PERIOD_STATUS_META[s].label}</span>
            ))}
          </span>
        </div>
        {c.expects_invoice && (
          <p className="mt-1 text-xs text-[#e5e4e2]/45">Kontrahent wystawia faktury — płatności przypisuj do faktur (KSeF lub spoza KSeF). Okresy są tu tylko informacyjnie.</p>
        )}
        <div className="mt-1.5">
          {c.periods.length === 0 ? <p className="text-xs text-[#e5e4e2]/45">Brak okresów do rozliczenia.</p> : <PeriodStrip periods={c.periods} currency={c.currency} />}
        </div>
      </section>

      <section>
        <h5 className="text-xs font-medium text-[#e5e4e2]/80">Przelewy z wyciągów</h5>
        {c.payments.length === 0 ? (
          <p className="mt-1 text-xs text-[#e5e4e2]/45">
            Brak przypisanych przelewów. Przelew na rachunek z umowy z kwotą okresu przypisze się podczas uzgadniania wyciągu; inny przypiszesz
            w „Uzgodnieniu wyciągów” (przycisk „Przypisz do umowy”).
            {onOpenReconciliation && <button type="button" onClick={onOpenReconciliation} className="ml-1 text-[#d3bb73] hover:underline">Przejdź do uzgodnienia</button>}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {c.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-1.5 text-xs" title={(p.reasons || []).join('\n')}>
                <span className="rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-[10px] text-[#d3bb73]">{p.period_label}</span>
                <span className="text-[#e5e4e2]/60">{date(p.date)}</span>
                <span className="min-w-0 flex-1 truncate text-[#e5e4e2]/70">{p.title || p.counterparty || 'przelew'}</span>
                <span className="text-[#e5e4e2]">{money(p.amount, c.currency)}</span>
                <span className="text-[10px] text-[#e5e4e2]/45">{matchMethodLabel(p.method)}</span>
                {canManage && (
                  <button type="button" disabled={busy === `undo:${p.id}`} onClick={() => onUndoPayment(p.id)} title="Odepnij przelew od umowy"
                    className="text-[#e5e4e2]/45 hover:text-red-300"><Undo2 className="h-3.5 w-3.5" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h5 className="text-xs font-medium text-[#e5e4e2]/80">Pliki umowy i aneksów</h5>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {c.files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-2 py-1 text-[11px] text-[#e5e4e2]/80">
              <button type="button" onClick={() => onOpenFile(f.storage_path)} className="inline-flex items-center gap-1 hover:text-[#d3bb73]"><FileText className="h-3.5 w-3.5" />{f.file_name}</button>
              {canManage && <button type="button" disabled={busy === `file:${f.id}`} onClick={() => onRemoveFile(f.id)} className="text-[#e5e4e2]/40 hover:text-red-300"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          {c.files.length === 0 && <span className="text-xs text-[#e5e4e2]/45">Brak pliku — dodaj skan umowy (PDF lub zdjęcie).</span>}
          {canManage && (
            <label className={`${ghost} cursor-pointer`}>
              {busy === `upload:${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Dodaj plik
              <input type="file" className="hidden" accept=".pdf,.doc,.docx,.odt,.zip,image/*" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUpload(file);
              }} />
            </label>
          )}
        </div>
      </section>
    </div>
  );
}

export interface RecurringContractInitial {
  kind?: RecurringContractKind;
  direction?: RecurringContractDirection;
  title?: string;
  counterpartyName?: string;
  counterpartyAccount?: string | null;
  amount?: number;
  currency?: string;
  billingCycle?: RecurringContractCycle;
  startDate?: string;
}

/** Formularz umowy stałej (dodawanie, edycja, „Nowa umowa z tej płatności”). */
export function RecurringContractFormModal({ companyId, contract, initial, onClose, onSaved }: {
  companyId: string;
  contract: RecurringContract | null;
  initial?: RecurringContractInitial;
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<RecurringContractKind>(contract?.kind || initial?.kind || 'rent');
  const [direction, setDirection] = useState<RecurringContractDirection>(contract?.direction || initial?.direction || 'cost');
  const [title, setTitle] = useState(contract?.title || initial?.title || '');
  const [counterparty, setCounterparty] = useState(contract?.counterparty_name || initial?.counterpartyName || '');
  const [nip, setNip] = useState(contract?.counterparty_nip || '');
  const [account, setAccount] = useState(formatAccount(contract?.counterparty_account || initial?.counterpartyAccount || ''));
  const [amount, setAmount] = useState(contract ? String(contract.amount) : initial?.amount != null ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(contract?.currency || initial?.currency || 'PLN');
  const [cycle, setCycle] = useState<RecurringContractCycle>(contract?.billing_cycle || initial?.billingCycle || 'monthly');
  const [paymentDay, setPaymentDay] = useState(contract?.payment_day ? String(contract.payment_day) : '');
  const [startDate, setStartDate] = useState(contract?.start_date || initial?.startDate || today);
  const [endDate, setEndDate] = useState(contract?.end_date || '');
  const [paymentsFrom, setPaymentsFrom] = useState(contract?.payments_from ? contract.payments_from.slice(0, 7) : '');
  const [status, setStatus] = useState(contract?.status || 'active');
  const [expectsInvoice, setExpectsInvoice] = useState(contract?.expects_invoice || false);
  const [notes, setNotes] = useState(contract?.notes || '');
  const [saving, setSaving] = useState(false);

  const accountClean = accountDigits(account);
  const nipClean = accountDigits(nip);
  const accountWarning = accountClean && accountClean.length !== 26 && currency === 'PLN' ? 'Polski rachunek ma 26 cyfr — sprawdź numer.' : null;

  const save = async () => {
    if (title.trim().length < 2) { showSnackbar('Podaj tytuł umowy.', 'warning'); return; }
    if (counterparty.trim().length < 2) { showSnackbar('Podaj nazwę kontrahenta.', 'warning'); return; }
    if (nipClean && nipClean.length !== 10) {
      showSnackbar(nipClean.length === 11 ? 'To wygląda na PESEL — nie zapisujemy go. Przy osobie prywatnej zostaw NIP pusty.' : 'NIP ma 10 cyfr.', 'warning');
      return;
    }
    if (accountClean && (accountClean.length < 10 || accountClean.length > 34)) { showSnackbar('Nieprawidłowy numer rachunku.', 'warning'); return; }
    if (num(amount) <= 0) { showSnackbar('Podaj kwotę brutto na okres.', 'warning'); return; }
    if (!startDate) { showSnackbar('Podaj datę początku umowy.', 'warning'); return; }
    if (endDate && endDate < startDate) { showSnackbar('Data końca nie może być wcześniejsza niż początek.', 'warning'); return; }
    const day = paymentDay.trim() === '' ? null : Math.round(num(paymentDay));
    if (day !== null && (day < 1 || day > 31)) { showSnackbar('Dzień płatności to liczba od 1 do 31.', 'warning'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('save_finance_recurring_contract', {
      p_id: contract?.id || null, p_company_id: companyId, p_kind: kind, p_direction: direction, p_title: title.trim(),
      p_counterparty_name: counterparty.trim(), p_counterparty_nip: nipClean || null, p_counterparty_account: accountClean || null,
      p_amount: num(amount), p_currency: currency.trim().toUpperCase() || 'PLN', p_billing_cycle: cycle, p_payment_day: day,
      p_start_date: startDate, p_end_date: endDate || null, p_payments_from: paymentsFrom ? `${paymentsFrom}-01` : null,
      p_status: status, p_expects_invoice: expectsInvoice, p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) { showSnackbar(error.message || 'Nie udało się zapisać umowy.', 'error'); return; }
    showSnackbar('Umowa zapisana.', 'success');
    await onSaved(data as string);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-light text-[#e5e4e2]">{contract ? `Umowa „${contract.title}”` : 'Nowa umowa stała'}</h4>
          <button type="button" onClick={onClose} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 grid flex-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <label className="text-xs text-[#e5e4e2]/60">Rodzaj
            <select className={`${input} mt-1`} value={kind} onChange={(e) => setKind(e.target.value as RecurringContractKind)}>
              {(Object.keys(RECURRING_CONTRACT_KIND_LABELS) as RecurringContractKind[]).map((k) => <option key={k} value={k}>{RECURRING_CONTRACT_KIND_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Kierunek
            <select className={`${input} mt-1`} value={direction} onChange={(e) => setDirection(e.target.value as RecurringContractDirection)}>
              {(Object.keys(RECURRING_CONTRACT_DIRECTION_LABELS) as RecurringContractDirection[]).map((d) => <option key={d} value={d}>{RECURRING_CONTRACT_DIRECTION_LABELS[d]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Tytuł
            <input className={`${input} mt-1`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="np. Najem garażu nr 6, ul. Marcina Kasprzaka 11" />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Kontrahent (nazwa lub imię i nazwisko)
            <input className={`${input} mt-1`} value={counterparty} maxLength={200} onChange={(e) => setCounterparty(e.target.value)} placeholder="np. Mariusz Skarul" />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">NIP (opcjonalnie, firma)
            <input className={`${input} mt-1`} value={nip} inputMode="numeric" onChange={(e) => setNip(e.target.value)} placeholder="bez PESEL" />
          </label>
          <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Rachunek kontrahenta
            <input className={`${input} mt-1 font-mono`} value={account} onChange={(e) => setAccount(e.target.value)} onBlur={() => setAccount(formatAccount(account))}
              placeholder="62 1140 2004 0000 3902 7077 4694" />
            <span className={`mt-0.5 block text-[10px] ${accountWarning ? 'text-amber-300' : 'text-[#e5e4e2]/40'}`}>
              {accountWarning || 'Przelew na ten rachunek z kwotą okresu przypisze się do umowy automatycznie.'}
            </span>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Kwota brutto na okres
            <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="np. 450,00" />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Waluta
            <select className={`${input} mt-1`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {Array.from(new Set(['PLN', 'EUR', 'USD', 'GBP', 'CHF', currency])).map((cur) => <option key={cur} value={cur}>{cur}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Cykl
            <select className={`${input} mt-1`} value={cycle} onChange={(e) => setCycle(e.target.value as RecurringContractCycle)}>
              {(Object.keys(RECURRING_CONTRACT_CYCLE_LABELS) as RecurringContractCycle[]).map((k) => <option key={k} value={k}>{RECURRING_CONTRACT_CYCLE_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Dzień płatności (opcjonalnie)
            <input className={`${input} mt-1`} inputMode="numeric" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} placeholder="np. 10 — puste: do końca miesiąca" />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Data początku
            <input type="date" className={`${input} mt-1`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Data końca (puste — czas nieokreślony)
            <input type="date" className={`${input} mt-1`} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Rozliczaj płatności od (opcjonalnie)
            <input type="month" className={`${input} mt-1`} value={paymentsFrom} onChange={(e) => setPaymentsFrom(e.target.value)} />
            <span className="mt-0.5 block text-[10px] text-[#e5e4e2]/40">Dla umów zawartych dawno: wcześniejsze okresy nie będą pokazywane jako brak płatności.</span>
          </label>
          {contract && (
            <label className="text-xs text-[#e5e4e2]/60">Status
              <select className={`${input} mt-1`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="active">Aktywna</option>
                <option value="ended">Zakończona</option>
              </select>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs text-[#e5e4e2]/70 sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={expectsInvoice} onChange={(e) => setExpectsInvoice(e.target.checked)} />
            <span>Kontrahent wystawia faktury za okresy <span className="block text-[10px] text-[#e5e4e2]/40">Wtedy przelew rozliczasz z fakturą (KSeF lub spoza KSeF), a umowa tylko informuje — automat nie przypisuje do niej płatności.</span></span>
          </label>
          <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Notatki
            <textarea className={`${input} mt-1`} rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="np. umowa na czas nieokreślony, 1 miesiąc wypowiedzenia" />
          </label>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[#e5e4e2]/45">
          Zmiana kwoty (np. waloryzacja czynszu) dotyczy wszystkich okresów. Jeśli od danego miesiąca kwota jest inna, zakończ umowę datą
          i dodaj nową od kolejnego okresu — historia płatności zostanie bez zmian.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#e5e4e2]/15 px-3 py-2 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Anuluj</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}

export interface RecurringLinkTransaction {
  id: string;
  date: string;
  amount: number;
  remaining: number;
  title: string;
  counterparty: string;
  counterparty_account: string | null;
  direction: 'credit' | 'debit';
  currency: string;
}

/** Ręczne przypięcie przelewu do umowy stałej (z ekranu uzgodnienia) — z podpowiedzią najlepiej pasującej umowy. */
export function RecurringContractLinkModal({ companyId, transaction, onClose, onLinked }: {
  companyId: string;
  transaction: RecurringLinkTransaction;
  onClose: () => void;
  onLinked: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const [rows, setRows] = useState<RecurringContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const direction: RecurringContractDirection = transaction.direction === 'credit' ? 'income' : 'cost';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_finance_recurring_contracts', { p_company_id: companyId });
      if (cancelled) return;
      if (error) showSnackbar(error.message || 'Nie udało się wczytać umów stałych.', 'error');
      setRows((data || []) as RecurringContract[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId, showSnackbar]);

  // Umowy w kierunku i walucie operacji, najlepiej pasujące (rachunek, nazwa, kwota) na górze.
  const candidates = useMemo(() => rows
    .filter((c) => c.direction === direction && c.currency === (transaction.currency || 'PLN'))
    .map((c) => ({ contract: c, evidence: contractMatchEvidence(c, transaction) }))
    .sort((a, b) => Number(b.contract.status === 'active') - Number(a.contract.status === 'active')
      || b.evidence.score - a.evidence.score || a.contract.title.localeCompare(b.contract.title, 'pl')),
  [rows, direction, transaction]);
  const best = candidates.find((c) => !c.contract.expects_invoice && c.evidence.score >= 3) || null;

  const choose = useCallback((contract: RecurringContract) => {
    setSelectedId(contract.id);
    const suggested = defaultContractPeriod(contract, transaction.date);
    setPeriod(suggested?.period_start || '');
    const open = suggested ? Number(suggested.missing) : Number(contract.amount);
    setAmount(String(Math.round(Math.min(transaction.remaining, open > 0.009 ? open : transaction.remaining) * 100) / 100));
  }, [transaction.date, transaction.remaining]);

  useEffect(() => {
    if (!selectedId && best) choose(best.contract);
  }, [best, selectedId, choose]);

  const link = async (contractId: string, periodStart: string | null, value: number | null) => {
    setBusy(true);
    const { error } = await supabase.rpc('link_bank_transaction_to_recurring_contract', {
      p_transaction_id: transaction.id, p_contract_id: contractId, p_period_start: periodStart, p_amount: value,
    });
    setBusy(false);
    if (error) { showSnackbar(error.message || 'Nie udało się przypisać przelewu.', 'error'); return false; }
    showSnackbar('Przelew przypisany do umowy.', 'success');
    await onLinked();
    return true;
  };

  const selected = candidates.find((c) => c.contract.id === selectedId)?.contract || null;
  const selectedPeriod = selected?.periods.find((p) => p.period_start === period) || null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
        <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-light text-[#e5e4e2]">Przypisz do umowy stałej</h4>
            <button type="button" onClick={onClose} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-1 text-xs text-[#e5e4e2]/55">
            {date(transaction.date)} · {transaction.direction === 'credit' ? 'wpływ' : 'wydatek'} {money(transaction.remaining, transaction.currency)}
            {transaction.remaining < transaction.amount - 0.009 ? ` (z ${money(transaction.amount, transaction.currency)})` : ''} · {transaction.counterparty || 'bez nazwy'}
            {transaction.counterparty_account ? ` · ${formatAccount(transaction.counterparty_account)}` : ''}
          </p>
          <p className="text-xs text-[#e5e4e2]/40">{transaction.title}</p>
          <div className="mt-3 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wczytywanie…</div>
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#e5e4e2]/50">
                Brak umów {direction === 'income' ? 'przychodowych' : 'kosztowych'} w {transaction.currency || 'PLN'}. Utwórz umowę z tej płatności poniżej.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {candidates.map(({ contract: c, evidence }) => {
                  const isSelected = c.id === selectedId;
                  const isBest = best?.contract.id === c.id;
                  return (
                    <li key={c.id} className={`rounded-lg px-3 py-2 text-xs ${isSelected ? 'bg-[#d3bb73]/[0.08] ring-1 ring-[#d3bb73]/40' : 'bg-[#0f1119]'} ${c.expects_invoice ? 'opacity-60' : ''}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[#e5e4e2]">
                            {isBest && <Sparkles className="h-3.5 w-3.5 text-[#d3bb73]" />}
                            <span className="font-medium">{c.title}</span>
                            <span className="text-[#e5e4e2]/50">{c.counterparty_name}</span>
                            {c.status === 'ended' && <span className="rounded bg-slate-500/20 px-1.5 py-px text-[10px] text-slate-300">zakończona</span>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px]">
                            <span className="text-[#e5e4e2]/45">{money(c.amount, c.currency)} {RECURRING_CONTRACT_CYCLE_LABELS[c.billing_cycle]}</span>
                            {evidence.account && <span className="rounded bg-green-500/10 px-1.5 py-px text-green-300">rachunek jak w umowie</span>}
                            {evidence.name && <span className="rounded bg-green-500/10 px-1.5 py-px text-green-300">nazwa kontrahenta</span>}
                            {evidence.amount && <span className="rounded bg-green-500/10 px-1.5 py-px text-green-300">kwota okresu</span>}
                            {isBest && <span className="text-[#d3bb73]">najlepiej pasuje</span>}
                          </div>
                        </div>
                        {c.expects_invoice ? (
                          <span className="text-[10px] text-[#e5e4e2]/50">rozliczana fakturami — przypisz do faktury</span>
                        ) : !isSelected ? (
                          <button type="button" onClick={() => choose(c)} className={ghost}><Check className="h-3.5 w-3.5" /> Wybierz</button>
                        ) : null}
                      </div>
                      {isSelected && !c.expects_invoice && (
                        <div className="mt-2 grid gap-2 border-t border-[#d3bb73]/10 pt-2 sm:grid-cols-[1fr_140px_auto] sm:items-end">
                          <label className="text-[11px] text-[#e5e4e2]/60">Okres
                            <select className={`${input} mt-1`} value={period} onChange={(e) => {
                              setPeriod(e.target.value);
                              const p = c.periods.find((x) => x.period_start === e.target.value);
                              if (p) setAmount(String(Math.round(Math.min(transaction.remaining, Number(p.missing) > 0.009 ? Number(p.missing) : transaction.remaining) * 100) / 100));
                            }}>
                              <option value="">Najwcześniejszy nieopłacony (automatycznie)</option>
                              {c.periods.map((p) => (
                                <option key={p.period_start} value={p.period_start}>
                                  {p.label} — {RECURRING_PERIOD_STATUS_META[p.status].label.toLowerCase()}{Number(p.paid) > 0.009 ? `, zapłacono ${money(p.paid, c.currency)}` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] text-[#e5e4e2]/60">Kwota
                            <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                          </label>
                          <button type="button" disabled={busy} onClick={() => void link(c.id, period || null, amount.trim() === '' ? null : num(amount))}
                            className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:opacity-50">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Przypisz
                          </button>
                          {selectedPeriod && Math.abs(num(amount) - Number(c.amount)) > 0.01 && (
                            <p className="text-[10px] text-amber-200/80 sm:col-span-3">
                              Kwota różni się od kwoty okresu ({money(c.amount, c.currency)}). Resztę przelewu możesz przypisać do kolejnego okresu.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-3 flex justify-between gap-2 border-t border-[#d3bb73]/10 pt-3">
            <button type="button" onClick={() => setCreating(true)} className={ghost}><Plus className="h-3.5 w-3.5" /> Nowa umowa z tej płatności</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Zamknij</button>
          </div>
        </div>
      </div>
      {creating && (
        <RecurringContractFormModal
          companyId={companyId}
          contract={null}
          initial={{
            kind: 'rent',
            direction,
            title: transaction.title.slice(0, 200),
            counterpartyName: transaction.counterparty.slice(0, 200),
            counterpartyAccount: transaction.counterparty_account,
            amount: transaction.remaining,
            currency: transaction.currency || 'PLN',
            billingCycle: 'monthly',
            startDate: transaction.date.slice(0, 10),
          }}
          onClose={() => setCreating(false)}
          onSaved={async (id) => { setCreating(false); await link(id, null, null); }}
        />
      )}
    </>
  );
}
