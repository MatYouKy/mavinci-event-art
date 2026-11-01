'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  FileText,
  Landmark,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { canFinanceCompany, filterFinanceCompanies } from '@/lib/invoices/financeAccess';
import {
  DECLARATION_FORMS,
  DECLARATION_KIND_LABELS,
  DECLARATION_STATUS_META,
  declarationStatusSentence,
  matchMethodLabel,
  type DeclarationKind,
  type DeclarationLine,
  type DeclarationPeriodKind,
  type FinanceDeclaration,
} from '@/lib/invoices/bankReconciliation';

const BUCKET = 'finance-declarations';
const card = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const input = 'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';

const money = (value: number | string | null | undefined) =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');
const num = (value: string) => {
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

interface Company { id: string; name: string }

interface Props {
  filterCompanyIds?: string[] | null;
  /** Przejście do uzgodnienia wyciągu, w którym jest przelew. */
  onOpenReconciliation?: () => void;
}

export default function FinanceDeclarationsPanel({ filterCompanyIds = null, onOpenReconciliation }: Props) {
  const { showSnackbar } = useSnackbar();
  const { access } = useInvoiceFinanceAccess();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  // Deklaracje widzi poziom „Podgląd finansów” działalności; zmienia tylko „Zarządzanie finansami” tej działalności.
  const canManage = canFinanceCompany(access, companyId, 'finance_manage');
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<FinanceDeclaration[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<'all' | DeclarationKind>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<FinanceDeclaration | 'new' | null>(null);
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
    const { data, error } = await supabase.rpc('get_finance_declarations', { p_company_id: companyId, p_year: year });
    if (error) { showSnackbar(error.message || 'Nie udało się wczytać deklaracji.', 'error'); setRows([]); }
    else setRows((data || []) as FinanceDeclaration[]);
    setLoading(false);
  }, [companyId, year, showSnackbar]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => rows.filter((r) => kindFilter === 'all' || r.kind === kindFilter), [rows, kindFilter]);
  const totals = useMemo(() => {
    const due = visible.reduce((s, r) => s + Number(r.amount_due || 0), 0);
    const paid = visible.reduce((s, r) => s + Number(r.paid || 0), 0);
    const attention = visible.filter((r) => ['underpaid', 'unpaid', 'amount_missing', 'overpaid'].includes(r.status)).length;
    return { due, paid, attention };
  }, [visible]);

  const run = async (key: string, action: () => PromiseLike<{ error: { message?: string } | null }>, success: string) => {
    setBusy(key);
    const { error } = await action();
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Operacja nie powiodła się.', 'error'); return false; }
    showSnackbar(success, 'success');
    await load();
    return true;
  };

  const removeDeclaration = async (d: FinanceDeclaration) => {
    if (!window.confirm(`Usunąć ${d.label} z rejestru? Pliki deklaracji też zostaną usunięte.`)) return;
    setBusy(`delete:${d.id}`);
    const { data, error } = await supabase.rpc('delete_finance_declaration', { p_id: d.id });
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Nie udało się usunąć deklaracji.', 'error'); return; }
    const paths = (data || []) as string[];
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    showSnackbar('Deklaracja usunięta.', 'success');
    await load();
  };

  const upload = async (d: FinanceDeclaration, file: File) => {
    if (file.size > 20 * 1024 * 1024) { showSnackbar('Plik jest większy niż 20 MB.', 'warning'); return; }
    setBusy(`upload:${d.id}`);
    const safe = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'plik';
    const path = `${d.company_id}/${d.id}/${Date.now()}-${safe}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream', upsert: false,
    });
    if (uploadError) { setBusy(null); showSnackbar(uploadError.message || 'Nie udało się wgrać pliku.', 'error'); return; }
    const { error } = await supabase.rpc('add_finance_declaration_file', {
      p_declaration_id: d.id, p_storage_path: path, p_file_name: file.name, p_mime_type: file.type || null, p_file_size: file.size,
    });
    setBusy(null);
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      showSnackbar(error.message || 'Nie udało się zapisać pliku.', 'error');
      return;
    }
    showSnackbar('Plik deklaracji dodany.', 'success');
    await load();
  };

  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { showSnackbar('Nie udało się otworzyć pliku.', 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const removeFile = async (fileId: string) => {
    if (!window.confirm('Usunąć plik z deklaracji?')) return;
    setBusy(`file:${fileId}`);
    const { data, error } = await supabase.rpc('remove_finance_declaration_file', { p_file_id: fileId });
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
            <h3 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]"><Landmark className="h-5 w-5 text-[#d3bb73]" /> ZUS i podatki — deklaracje</h3>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[#e5e4e2]/55">
              Rejestr zobowiązań za okres: DRA, PIT-4R, VAT-7, CIT-8. Każda deklaracja ma kwotę do zapłaty, pliki (PDF/XML z Płatnika,
              PUE lub e-Deklaracji) i rozbicie na pracowników. Przelewy z okresem w tytule („ZUS DRA 03.2026”, „N 26M03 PIT-4R”) przypisują
              się same podczas uzgadniania wyciągu — tutaj widać, czy zapłacono tyle, ile wynika z deklaracji.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2]">
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2]">
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2]">
              <option value="all">Wszystkie rodzaje</option>
              {(Object.keys(DECLARATION_KIND_LABELS) as DeclarationKind[]).map((k) => <option key={k} value={k}>{DECLARATION_KIND_LABELS[k]}</option>)}
            </select>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Odśwież
            </button>
            {canManage && companyId && (
              <button type="button" data-crm-action="primary" onClick={() => setForm('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799]">
                <Plus className="h-3.5 w-3.5" /> Dodaj deklarację
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-2 border-t border-[#d3bb73]/10 pt-3 text-xs sm:grid-cols-3">
          <div><span className="text-[#e5e4e2]/45">Do zapłaty wg deklaracji: </span><span className="text-[#e5e4e2]">{money(totals.due)}</span></div>
          <div><span className="text-[#e5e4e2]/45">Zapłacono z wyciągów: </span><span className="text-[#e5e4e2]">{money(totals.paid)}</span></div>
          <div className={totals.attention ? 'text-amber-300' : 'text-green-400'}>
            {totals.attention ? `${totals.attention} do sprawdzenia (brak kwoty, niedopłata, nadpłata, brak przelewu)` : 'Wszystko zgodne.'}
          </div>
        </div>
      </div>

      <div className={card}>
        {loading ? (
          <div className="flex items-center justify-center py-14 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" /> Wczytywanie…</div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#e5e4e2]/55">
            Brak deklaracji w {year} r. Pojawią się same po uzgodnieniu wyciągu z przelewami do ZUS lub urzędu skarbowego — możesz też dodać je ręcznie.
          </div>
        ) : (
          <ul className="divide-y divide-[#d3bb73]/10">
            {visible.map((d) => {
              const meta = DECLARATION_STATUS_META[d.status];
              const open = openId === d.id;
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => setOpenId(open ? null : d.id)} className="flex w-full flex-col gap-2 px-4 py-3 text-left md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#e5e4e2]">{d.label}</span>
                        <span className="rounded bg-[#0f1119] px-1.5 py-0.5 text-[10px] text-[#e5e4e2]/55">{DECLARATION_KIND_LABELS[d.kind]}</span>
                        {d.created_from === 'payment' && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">założona z przelewu</span>}
                        {d.files.length > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-[#e5e4e2]/45"><FileText className="h-3 w-3" />{d.files.length}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-[#e5e4e2]/55">{declarationStatusSentence(d, money)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right text-xs">
                        <div className="text-[#e5e4e2]">{d.amount_due == null ? 'kwota —' : money(d.amount_due)}</div>
                        <div className="text-[10px] text-[#e5e4e2]/45">zapłacono {money(d.paid)}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>{meta.label}</span>
                      <ChevronDown className={`h-4 w-4 text-[#e5e4e2]/40 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {open && (
                    <DeclarationDetails
                      declaration={d}
                      canManage={canManage}
                      busy={busy}
                      onEdit={() => setForm(d)}
                      onDelete={() => void removeDeclaration(d)}
                      onUpload={(file) => void upload(d, file)}
                      onOpenFile={(path) => void openFile(path)}
                      onRemoveFile={(id) => void removeFile(id)}
                      onUndoPayment={(paymentId) => void run(`undo:${paymentId}`, () => supabase.rpc('undo_bank_declaration_payment', { p_payment_id: paymentId }),
                        'Przelew odpięty od deklaracji. Nie zostanie przypięty ponownie automatycznie.')}
                      onPrefill={() => void run(`prefill:${d.id}`, () => supabase.rpc('prefill_finance_declaration_lines', { p_declaration_id: d.id }),
                        'Dodano osoby z umów obowiązujących w tym okresie.')}
                      onSaveLine={(line) => run(`line:${line.id || 'new'}`, () => supabase.rpc('save_finance_declaration_line', {
                        p_id: line.id || null, p_declaration_id: d.id, p_contract_id: line.contract_id || null, p_person_name: line.person_name,
                        p_social_insured: line.social_insured, p_social_payer: line.social_payer, p_health: line.health, p_funds: line.funds,
                        p_pit: line.pit, p_notes: line.notes || null,
                      }), 'Pozycja zapisana.')}
                      onDeleteLine={(id) => void run(`line-del:${id}`, () => supabase.rpc('delete_finance_declaration_line', { p_id: id }), 'Pozycja usunięta.')}
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
        <DeclarationFormModal
          companyId={companyId}
          declaration={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={async (id) => { setForm(null); setOpenId(id); await load(); }}
        />
      )}
    </div>
  );
}

function DeclarationDetails({ declaration: d, canManage, busy, onEdit, onDelete, onUpload, onOpenFile, onRemoveFile, onUndoPayment, onPrefill, onSaveLine, onDeleteLine, onOpenReconciliation }: {
  declaration: FinanceDeclaration;
  canManage: boolean;
  busy: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: (file: File) => void;
  onOpenFile: (path: string) => void;
  onRemoveFile: (id: string) => void;
  onUndoPayment: (paymentId: string) => void;
  onPrefill: () => void;
  onSaveLine: (line: Partial<DeclarationLine> & { person_name: string }) => Promise<boolean>;
  onDeleteLine: (id: string) => void;
  onOpenReconciliation?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const showPit = d.kind === 'pit';
  const showZus = d.kind === 'zus';
  const diff = d.amount_due == null ? null : Math.round((Number(d.lines_total) - Number(d.amount_due)) * 100) / 100;

  return (
    <div className="space-y-4 border-t border-[#d3bb73]/10 bg-[#161928] px-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#e5e4e2]/55">
        <span>Okres: {date(d.period_start)} – {date(d.period_end)}</span>
        {d.due_date && <span>· termin płatności {date(d.due_date)}</span>}
        {d.notes && <span>· {d.notes}</span>}
        {canManage && (
          <span className="ml-auto flex gap-2">
            <button type="button" className={ghost} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Kwota i dane</button>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-red-400/25 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              disabled={busy === `delete:${d.id}` || d.payments.length > 0} title={d.payments.length > 0 ? 'Najpierw odepnij przelewy' : undefined} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Usuń
            </button>
          </span>
        )}
      </div>

      {/* Płatności z wyciągów */}
      <section>
        <h5 className="text-xs font-medium text-[#e5e4e2]/80">Przelewy z wyciągów</h5>
        {d.payments.length === 0 ? (
          <p className="mt-1 text-xs text-[#e5e4e2]/45">
            Brak przypisanych przelewów. Przelew z okresem w tytule przypisze się podczas uzgadniania wyciągu; inny możesz przypisać ręcznie
            w „Uzgodnieniu wyciągów” (przycisk „Przypisz do deklaracji”).
            {onOpenReconciliation && <button type="button" onClick={onOpenReconciliation} className="ml-1 text-[#d3bb73] hover:underline">Przejdź do uzgodnienia</button>}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {d.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-1.5 text-xs" title={(p.reasons || []).join('\n')}>
                <span className="text-[#e5e4e2]/60">{date(p.date)}</span>
                <span className="min-w-0 flex-1 truncate text-[#e5e4e2]/70">{p.title || 'przelew'}</span>
                <span className="text-[#e5e4e2]">{money(p.amount)}</span>
                <span className="text-[10px] text-[#e5e4e2]/45">{matchMethodLabel(p.method)}</span>
                {canManage && (
                  <button type="button" disabled={busy === `undo:${p.id}`} onClick={() => onUndoPayment(p.id)} title="Odepnij przelew"
                    className="text-[#e5e4e2]/45 hover:text-red-300"><Undo2 className="h-3.5 w-3.5" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pliki */}
      <section>
        <h5 className="text-xs font-medium text-[#e5e4e2]/80">Pliki deklaracji</h5>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {d.files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-2 py-1 text-[11px] text-[#e5e4e2]/80">
              <button type="button" onClick={() => onOpenFile(f.storage_path)} className="inline-flex items-center gap-1 hover:text-[#d3bb73]"><FileText className="h-3.5 w-3.5" />{f.file_name}</button>
              {canManage && <button type="button" disabled={busy === `file:${f.id}`} onClick={() => onRemoveFile(f.id)} className="text-[#e5e4e2]/40 hover:text-red-300"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          {d.files.length === 0 && <span className="text-xs text-[#e5e4e2]/45">Brak pliku — dodaj PDF lub XML deklaracji (np. DRA z raportami RCA).</span>}
          {canManage && (
            <label className={`${ghost} cursor-pointer`}>
              {busy === `upload:${d.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Dodaj plik
              <input type="file" className="hidden" accept=".pdf,.xml,.kdu,.zip,image/*" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUpload(file);
              }} />
            </label>
          )}
        </div>
      </section>

      {/* Rozbicie na osoby */}
      {(showZus || showPit || d.lines.length > 0) && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-xs font-medium text-[#e5e4e2]/80">Rozbicie na pracowników {showZus ? '(z raportów RCA)' : '(zaliczki PIT)'}</h5>
            {canManage && (
              <div className="flex gap-2">
                <button type="button" className={ghost} disabled={busy === `prefill:${d.id}`} onClick={onPrefill}><UsersRound className="h-3.5 w-3.5" /> Dodaj osoby z umów</button>
                <button type="button" className={ghost} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Pozycja</button>
              </div>
            )}
          </div>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#e5e4e2]/40">
                  <th className="py-1 pr-2 font-normal">Osoba / umowa</th>
                  {showZus && <th className="py-1 pr-2 text-right font-normal">Społ. ubezp.</th>}
                  {showZus && <th className="py-1 pr-2 text-right font-normal">Społ. płatnik</th>}
                  {showZus && <th className="py-1 pr-2 text-right font-normal">Zdrowotna</th>}
                  {showZus && <th className="py-1 pr-2 text-right font-normal">FP / FS / FGŚP</th>}
                  {showPit && <th className="py-1 pr-2 text-right font-normal">Zaliczka PIT</th>}
                  <th className="py-1 pr-2 text-right font-normal">Razem</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {d.lines.map((line) => (
                  <LineRow key={line.id} line={line} showZus={showZus} showPit={showPit} canManage={canManage} busy={busy}
                    onSave={onSaveLine} onDelete={() => onDeleteLine(line.id)} />
                ))}
                {adding && (
                  <LineRow line={null} showZus={showZus} showPit={showPit} canManage={canManage} busy={busy}
                    onSave={async (line) => { const ok = await onSaveLine(line); if (ok) setAdding(false); return ok; }}
                    onDelete={() => setAdding(false)} />
                )}
                {d.lines.length === 0 && !adding && (
                  <tr><td colSpan={8} className="py-2 text-[#e5e4e2]/45">Brak rozbicia. Użyj „Dodaj osoby z umów” i wpisz kwoty z raportów RCA (lub z listy płac).</td></tr>
                )}
              </tbody>
              {d.lines.length > 0 && (
                <tfoot>
                  <tr className="border-t border-[#d3bb73]/10">
                    <td className="py-1.5 pr-2 text-[#e5e4e2]/60">Suma pozycji</td>
                    {(showZus || showPit) && <td colSpan={(showZus ? 4 : 0) + (showPit ? 1 : 0)} />}
                    <td className="py-1.5 pr-2 text-right text-[#e5e4e2]">{money(d.lines_total)}</td>
                    <td className={`py-1.5 text-[11px] ${diff === null ? 'text-[#e5e4e2]/45' : Math.abs(diff) <= 0.01 ? 'text-green-400' : 'text-amber-300'}`}>
                      {diff === null ? 'brak kwoty deklaracji' : Math.abs(diff) <= 0.01 ? 'zgodne z deklaracją' : `różnica ${money(diff)}`}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function LineRow({ line, showZus, showPit, canManage, busy, onSave, onDelete }: {
  line: DeclarationLine | null;
  showZus: boolean;
  showPit: boolean;
  canManage: boolean;
  busy: string | null;
  onSave: (line: Partial<DeclarationLine> & { person_name: string }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(line === null);
  const [draft, setDraft] = useState(() => ({
    person_name: line?.person_name || '',
    social_insured: String(line?.social_insured ?? ''),
    social_payer: String(line?.social_payer ?? ''),
    health: String(line?.health ?? ''),
    funds: String(line?.funds ?? ''),
    pit: String(line?.pit ?? ''),
  }));
  const fields = [
    ...(showZus ? (['social_insured', 'social_payer', 'health', 'funds'] as const) : []),
    ...(showPit ? (['pit'] as const) : []),
  ];

  if (!editing && line) {
    return (
      <tr className="border-t border-[#d3bb73]/5">
        <td className="py-1.5 pr-2 text-[#e5e4e2]/85">{line.person_name}{line.contract_number && <span className="ml-1 text-[10px] text-[#e5e4e2]/40">{line.contract_number}</span>}</td>
        {fields.map((f) => <td key={f} className="py-1.5 pr-2 text-right text-[#e5e4e2]/70">{money(line[f])}</td>)}
        <td className="py-1.5 pr-2 text-right text-[#e5e4e2]">{money(line.amount)}</td>
        <td className="py-1.5 text-right">
          {canManage && (
            <span className="inline-flex gap-1.5">
              <button type="button" onClick={() => setEditing(true)} className="text-[#e5e4e2]/45 hover:text-[#d3bb73]" title="Edytuj"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" disabled={busy === `line-del:${line.id}`} onClick={onDelete} className="text-[#e5e4e2]/45 hover:text-red-300" title="Usuń"><Trash2 className="h-3.5 w-3.5" /></button>
            </span>
          )}
        </td>
      </tr>
    );
  }

  const total = fields.reduce((s, f) => s + num(draft[f]), 0);
  return (
    <tr className="border-t border-[#d3bb73]/5 align-top">
      <td className="py-1.5 pr-2"><input className={input} value={draft.person_name} placeholder="Imię i nazwisko" onChange={(e) => setDraft({ ...draft, person_name: e.target.value })} /></td>
      {fields.map((f) => (
        <td key={f} className="py-1.5 pr-2"><input className={`${input} text-right`} inputMode="decimal" value={draft[f]} placeholder="0,00" onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} /></td>
      ))}
      <td className="py-1.5 pr-2 pt-3 text-right text-[#e5e4e2]">{money(total)}</td>
      <td className="py-1.5 pt-2.5 text-right">
        <span className="inline-flex gap-1.5">
          <button type="button" disabled={!draft.person_name.trim() || busy === `line:${line?.id || 'new'}`}
            onClick={async () => {
              const ok = await onSave({
                id: line?.id, contract_id: line?.contract_id ?? null, person_name: draft.person_name.trim(), notes: line?.notes ?? null,
                social_insured: num(draft.social_insured), social_payer: num(draft.social_payer), health: num(draft.health),
                funds: num(draft.funds), pit: num(draft.pit),
              });
              if (ok && line) setEditing(false);
            }}
            className="rounded bg-[#d3bb73] px-2 py-0.5 text-[11px] font-medium text-[#0a0d1a] disabled:opacity-50">Zapisz</button>
          <button type="button" onClick={() => (line ? setEditing(false) : onDelete())} className="text-[#e5e4e2]/45 hover:text-[#e5e4e2]"><X className="h-3.5 w-3.5" /></button>
        </span>
      </td>
    </tr>
  );
}

const periodInputValue = (periodKind: DeclarationPeriodKind, start: string) => {
  if (periodKind === 'year') return start.slice(0, 4);
  if (periodKind === 'quarter') return `${start.slice(0, 4)}-Q${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1}`;
  return start.slice(0, 7);
};

const periodStartFromInput = (periodKind: DeclarationPeriodKind, value: string) => {
  if (periodKind === 'year') return /^\d{4}$/.test(value) ? `${value}-01-01` : null;
  if (periodKind === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(value);
    return m ? `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01` : null;
  }
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : null;
};

export function DeclarationFormModal({ companyId, declaration, initial, onClose, onSaved }: {
  companyId: string;
  declaration: FinanceDeclaration | null;
  initial?: { kind: DeclarationKind; form: string; periodKind: DeclarationPeriodKind; periodStart: string; amountDue?: number | null };
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [kind, setKind] = useState<DeclarationKind>(declaration?.kind || initial?.kind || 'zus');
  const [formSymbol, setFormSymbol] = useState(declaration?.form || initial?.form || 'DRA');
  const [periodKind, setPeriodKind] = useState<DeclarationPeriodKind>(declaration?.period_kind || initial?.periodKind || 'month');
  const [period, setPeriod] = useState(declaration ? periodInputValue(declaration.period_kind, declaration.period_start)
    : initial ? periodInputValue(initial.periodKind, initial.periodStart) : lastMonth);
  const [amount, setAmount] = useState(declaration?.amount_due != null ? String(declaration.amount_due) : initial?.amountDue != null ? String(initial.amountDue) : '');
  const [dueDate, setDueDate] = useState(declaration?.due_date || '');
  const [notes, setNotes] = useState(declaration?.notes || '');
  const [saving, setSaving] = useState(false);

  const pickForm = (value: string) => {
    setFormSymbol(value);
    const preset = DECLARATION_FORMS.find((f) => f.form === value.toUpperCase().trim());
    if (preset) {
      setKind(preset.kind);
      if (preset.periodKind !== periodKind) {
        setPeriodKind(preset.periodKind);
        setPeriod(periodInputValue(preset.periodKind, `${(periodStartFromInput(periodKind, period) || `${lastMonth}-01`)}`));
      }
    }
  };

  const save = async () => {
    const start = periodStartFromInput(periodKind, period);
    if (!start) { showSnackbar('Podaj okres deklaracji.', 'warning'); return; }
    if (!formSymbol.trim()) { showSnackbar('Podaj symbol deklaracji.', 'warning'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('save_finance_declaration', {
      p_id: declaration?.id || null, p_company_id: companyId, p_kind: kind, p_form: formSymbol.trim(), p_period_kind: periodKind,
      p_period_start: start, p_amount_due: amount.trim() === '' ? null : num(amount), p_due_date: dueDate || null, p_notes: notes || null,
    });
    setSaving(false);
    if (error) { showSnackbar(error.message || 'Nie udało się zapisać deklaracji.', 'error'); return; }
    showSnackbar('Deklaracja zapisana.', 'success');
    await onSaved(data as string);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-light text-[#e5e4e2]">{declaration ? `Deklaracja ${declaration.label}` : 'Nowa deklaracja'}</h4>
          <button type="button" onClick={onClose} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[#e5e4e2]/60">Symbol
            <input list="declaration-forms" className={`${input} mt-1`} value={formSymbol} onChange={(e) => pickForm(e.target.value)} />
            <datalist id="declaration-forms">{DECLARATION_FORMS.map((f) => <option key={f.form} value={f.form}>{f.hint}</option>)}</datalist>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Rodzaj
            <select className={`${input} mt-1`} value={kind} onChange={(e) => setKind(e.target.value as DeclarationKind)}>
              {(Object.keys(DECLARATION_KIND_LABELS) as DeclarationKind[]).map((k) => <option key={k} value={k}>{DECLARATION_KIND_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Okres
            <select className={`${input} mt-1`} value={periodKind} onChange={(e) => {
              const next = e.target.value as DeclarationPeriodKind;
              setPeriod(periodInputValue(next, periodStartFromInput(periodKind, period) || `${lastMonth}-01`));
              setPeriodKind(next);
            }}>
              <option value="month">Miesiąc</option>
              <option value="quarter">Kwartał</option>
              <option value="year">Rok</option>
            </select>
          </label>
          <label className="text-xs text-[#e5e4e2]/60">{periodKind === 'year' ? 'Rok' : periodKind === 'quarter' ? 'Kwartał (RRRR-Q1)' : 'Miesiąc'}
            {periodKind === 'month'
              ? <input type="month" className={`${input} mt-1`} value={period} onChange={(e) => setPeriod(e.target.value)} />
              : <input className={`${input} mt-1`} value={period} placeholder={periodKind === 'year' ? '2025' : '2026-Q1'} onChange={(e) => setPeriod(e.target.value.toUpperCase())} />}
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Kwota do zapłaty z deklaracji (zł)
            <input className={`${input} mt-1`} inputMode="decimal" value={amount} placeholder="np. 2829,86" onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="text-xs text-[#e5e4e2]/60">Termin płatności (opcjonalnie)
            <input type="date" className={`${input} mt-1`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Notatka
            <input className={`${input} mt-1`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. korekta 02, złożona przez PUE" />
          </label>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[#e5e4e2]/45">
          Kwotę przepisz z deklaracji (DRA: „kwota do zapłaty”; PIT-4R / VAT-7 / CIT-8: podatek do wpłaty). Na tej podstawie system pokaże
          niedopłatę albo nadpłatę względem przelewów z wyciągów.
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

/** Ręczne przypięcie przelewu do deklaracji (z ekranu uzgodnienia). */
export function DeclarationLinkModal({ companyId, transaction, onClose, onLinked }: {
  companyId: string;
  transaction: { id: string; date: string; amount: number; remaining: number; title: string };
  onClose: () => void;
  onLinked: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const [rows, setRows] = useState<FinanceDeclaration[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const year = Number(transaction.date.slice(0, 4));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all([year, year - 1].map((y) => supabase.rpc('get_finance_declarations', { p_company_id: companyId, p_year: y })));
      if (cancelled) return;
      const failed = results.find((r) => r.error);
      if (failed?.error) showSnackbar(failed.error.message || 'Nie udało się wczytać deklaracji.', 'error');
      setRows(results.flatMap((r) => (r.data || []) as FinanceDeclaration[]));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId, year, showSnackbar]);

  const link = async (declarationId: string) => {
    setBusy(declarationId);
    const { error } = await supabase.rpc('link_bank_transaction_to_declaration', {
      p_transaction_id: transaction.id, p_declaration_id: declarationId, p_amount: transaction.remaining,
    });
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Nie udało się przypisać przelewu.', 'error'); return; }
    showSnackbar('Przelew przypisany do deklaracji.', 'success');
    await onLinked();
  };

  const prevMonth = (() => { const d = new Date(`${transaction.date.slice(0, 10)}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
        <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-light text-[#e5e4e2]">Przypisz przelew do deklaracji</h4>
            <button type="button" onClick={onClose} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-1 text-xs text-[#e5e4e2]/55">{date(transaction.date)} · {money(transaction.remaining)} · {transaction.title}</p>
          <div className="mt-3 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wczytywanie…</div>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#e5e4e2]/50">Brak deklaracji w {year - 1}–{year}. Dodaj nową poniżej.</p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="text-[#e5e4e2]">{d.label}</div>
                      <div className="text-[10px] text-[#e5e4e2]/45">{d.amount_due == null ? 'bez kwoty' : `do zapłaty ${money(d.amount_due)}`} · zapłacono {money(d.paid)}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${DECLARATION_STATUS_META[d.status].chip}`}>{DECLARATION_STATUS_META[d.status].label}</span>
                    <button type="button" disabled={busy === d.id} onClick={() => void link(d.id)} className={ghost}><Link2 className="h-3.5 w-3.5" /> Przypisz</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-3 flex justify-between gap-2 border-t border-[#d3bb73]/10 pt-3">
            <button type="button" onClick={() => setCreating(true)} className={ghost}><Plus className="h-3.5 w-3.5" /> Nowa deklaracja</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Zamknij</button>
          </div>
        </div>
      </div>
      {creating && (
        <DeclarationFormModal
          companyId={companyId}
          declaration={null}
          initial={{ kind: 'zus', form: 'DRA', periodKind: 'month', periodStart: prevMonth }}
          onClose={() => setCreating(false)}
          onSaved={async (id) => { setCreating(false); await link(id); }}
        />
      )}
    </>
  );
}
