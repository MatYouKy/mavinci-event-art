'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ChevronDown, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  parseContractClauseEntries,
  serializeContractClauseEntries,
  type ContractClauseCategory,
} from '@/lib/CRM/contracts/contractClauseContent';
import { proposeContractClauseCleanup, type ClauseCleanupResult } from '@/lib/CRM/contracts/contractClauseCleanup';
import { summarizeContractRequirement } from '@/lib/CRM/contracts/contractRequirements';

/*
 * Porządkowanie klauzul produktów: dla każdego produktu (i wariantu z własnymi klauzulami) propozycja z
 * `proposeContractClauseCleanup` — ogólne zdania zastąpione wymaganiami z parametrami i wspólnymi zasadami, szczegóły
 * usług przeredagowane. Zapis po zatwierdzeniu, z kopią poprzedniej treści (`contract_clause_cleanup_backups`) do przywrócenia.
 * Wystawione umowy mają zapisaną treść i się nie zmieniają; szkice umów pokażą „Odśwież szablon i dane”.
 */

type Row = {
  key: string;
  table: 'offer_products' | 'offer_product_variants';
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  raw: string;
  category: string;
  proposal: ClauseCleanupResult;
};

type Backup = { id: string; product_id: string; variant_id: string | null; previous_clauses: string | null; created_at: string };

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export default function ContractClauseCleanupPage() {
  const { isAdmin, canManageModule, loading: employeeLoading } = useCurrentEmployee();
  const allowed = isAdmin || canManageModule('offers');
  const { showSnackbar } = useSnackbar();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [missingBackups, setMissingBackups] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [productsRes, variantsRes, backupsRes] = await Promise.all([
        supabase.from('offer_products').select('id, name, recommended_contract_clauses, recommended_contract_clause_category')
          .not('recommended_contract_clauses', 'is', null).order('name'),
        supabase.from('offer_product_variants').select('id, product_id, name, recommended_contract_clauses, recommended_contract_clause_category')
          .eq('overrides_contract_clauses', true).not('recommended_contract_clauses', 'is', null),
        supabase.from('contract_clause_cleanup_backups').select('id, product_id, variant_id, previous_clauses, created_at')
          .is('restored_at', null).order('created_at', { ascending: false }).limit(200),
      ]);
      if (productsRes.error) throw productsRes.error;
      setMissingBackups(Boolean(backupsRes.error));
      setBackups((backupsRes.data || []) as Backup[]);
      const productNames = new Map<string, string>(((productsRes.data || []) as any[]).map((product) => [String(product.id), String(product.name || '')]));
      setNames(productNames);
      const toRow = (record: any, table: Row['table']): Row | null => {
        const raw = String(record.recommended_contract_clauses || '');
        if (!raw.trim()) return null;
        const category = String(record.recommended_contract_clause_category || 'requirements');
        const proposal = proposeContractClauseCleanup(parseContractClauseEntries(raw, category as ContractClauseCategory));
        if (!proposal.changes.length && !proposal.skipped.length) return null;
        const variant = table === 'offer_product_variants';
        return {
          key: `${table}:${record.id}`, table, id: record.id,
          productId: variant ? record.product_id : record.id, variantId: variant ? record.id : null,
          name: variant ? `${productNames.get(record.product_id) || 'Produkt'} — wariant ${record.name || ''}`.trim() : String(record.name || 'Produkt'),
          raw, category, proposal,
        };
      };
      const next = [
        ...((productsRes.data || []) as any[]).map((record) => toRow(record, 'offer_products')),
        ...((variantsRes.data || []) as any[]).map((record) => toRow(record, 'offer_product_variants')),
      ].filter((row): row is Row => Boolean(row));
      setRows(next);
      setSelected(new Set(next.filter((row) => row.proposal.changes.length).map((row) => row.key)));
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się wczytać klauzul produktów', 'error');
    } finally {
      setLoading(false);
    }
  }, [showSnackbar]);

  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  const withChanges = useMemo(() => rows.filter((row) => row.proposal.changes.length), [rows]);
  const totalChanges = useMemo(() => withChanges.reduce((sum, row) => sum + row.proposal.changes.length, 0), [withChanges]);

  const apply = async () => {
    const chosen = withChanges.filter((row) => selected.has(row.key));
    if (!chosen.length || applying) return;
    if (missingBackups) {
      showSnackbar('Najpierw uruchom migrację 20261116190000_contract_clause_cleanup_backups — bez kopii zapis jest zablokowany.', 'error');
      return;
    }
    setApplying(true);
    let done = 0;
    const failed: string[] = [];
    for (const row of chosen) {
      const backup = await supabase.from('contract_clause_cleanup_backups').insert({
        product_id: row.productId, variant_id: row.variantId, previous_clauses: row.raw, previous_category: row.category,
      }).select('id').single();
      if (backup.error) { failed.push(row.name); continue; }
      const { data, error } = await supabase.from(row.table)
        .update({ recommended_contract_clauses: serializeContractClauseEntries(row.proposal.entries) })
        .eq('id', row.id).eq('recommended_contract_clauses', row.raw).select('id');
      if (error || !data?.length) {
        failed.push(row.name);
        await supabase.from('contract_clause_cleanup_backups').delete().eq('id', backup.data.id);
        continue;
      }
      done += 1;
    }
    setApplying(false);
    if (failed.length) showSnackbar(`Uporządkowano ${done}. Nie zapisano (zmienione w międzyczasie albo brak uprawnień): ${failed.join(', ')}`, 'warning');
    else showSnackbar(`Uporządkowano klauzule: ${done}`, 'success');
    await load();
  };

  const restore = async (backup: Backup) => {
    const table = backup.variant_id ? 'offer_product_variants' : 'offer_products';
    const { error } = await supabase.from(table).update({ recommended_contract_clauses: backup.previous_clauses })
      .eq('id', backup.variant_id || backup.product_id);
    if (error) { showSnackbar(error.message, 'error'); return; }
    await supabase.from('contract_clause_cleanup_backups').update({ restored_at: new Date().toISOString() }).eq('id', backup.id);
    showSnackbar('Przywrócono poprzednie klauzule', 'success');
    await load();
  };

  if (!employeeLoading && !allowed) {
    return <p className="p-6 text-[#e5e4e2]/70">Porządkowanie klauzul wymaga uprawnienia do zarządzania ofertami i produktami.</p>;
  }

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6 text-[#e5e4e2]">
      <Link href="/crm/contract-templates" className="mb-4 inline-flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
        <ArrowLeft className="h-4 w-4" /> Szablony umów
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-light"><Sparkles className="h-6 w-6 text-[#d3bb73]" /> Porządkowanie klauzul</h1>
          <p className="max-w-3xl text-sm text-[#e5e4e2]/60">
            Ogólne zapisy produktów („sprawne zasilanie”, „bezpieczne, suche stanowisko”, „w terminie dostarczenia materiałów”)
            zostaną zastąpione wymaganiami z parametrami i wspólnymi zasadami — w umowie pojawią się raz, a mocniejsze wymaganie
            pokryje słabsze. Szczegóły konkretnych usług zostają. Przed zapisem zapisujemy kopię, którą można przywrócić.
          </p>
        </div>
        <button
          type="button"
          disabled={applying || loading || !withChanges.some((row) => selected.has(row.key))}
          onClick={() => void apply()}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-40"
        >
          {applying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
          Uporządkuj zaznaczone ({withChanges.filter((row) => selected.has(row.key)).length})
        </button>
      </div>

      {missingBackups && (
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          Brak tabeli kopii — uruchom migrację <code>20261116190000_contract_clause_cleanup_backups.sql</code>. Do tego czasu zapis jest zablokowany.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[#e5e4e2]/60"><Loader2 className="h-5 w-5 animate-spin" /> Analizuję klauzule produktów…</div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[#e5e4e2]/70">
            <span>Produkty do uporządkowania: <strong className="text-[#e5e4e2]">{withChanges.length}</strong></span>
            <span>Zmiany: <strong className="text-[#e5e4e2]">{totalChanges}</strong></span>
            <button type="button" onClick={() => setSelected(new Set(withChanges.map((row) => row.key)))} className="text-[#d3bb73] hover:underline">Zaznacz wszystkie</button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-[#d3bb73] hover:underline">Odznacz</button>
          </div>
          <div className="space-y-2">
            {rows.map((row) => {
              const expanded = open === row.key;
              return (
                <div key={row.key} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
                  <div className="flex items-center gap-3 px-4 py-3">
                    {row.proposal.changes.length > 0
                      ? <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} className="h-4 w-4" aria-label={`Uporządkuj ${row.name}`} />
                      : <span className="h-4 w-4" />}
                    <button type="button" onClick={() => setOpen(expanded ? null : row.key)} className="flex flex-1 items-center justify-between gap-3 text-left">
                      <span className="font-medium">{row.name}</span>
                      <span className="flex items-center gap-3 text-xs text-[#e5e4e2]/60">
                        {row.proposal.changes.length > 0 && <span>{row.proposal.changes.length} zmian</span>}
                        {row.proposal.skipped.length > 0 && <span className="text-amber-200/80">do ręcznego przejrzenia: {row.proposal.skipped.length}</span>}
                        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="grid gap-4 border-t border-white/5 px-4 py-4 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#d3bb73]">Zmiany</div>
                        <ul className="space-y-1.5 text-sm text-[#e5e4e2]/80">
                          {row.proposal.changes.map((change, index) => <li key={index}>• {change.text}</li>)}
                          {row.proposal.skipped.map((title) => <li key={title} className="text-amber-200/80">• Bez zmian (lista lub formatowanie): {title}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#d3bb73]">Po uporządkowaniu</div>
                        <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
                          {row.proposal.entries.map((entry) => (
                            <li key={entry.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                              <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/45">
                                {entry.requirement ? `Wymaganie: ${summarizeContractRequirement(entry.requirement)}` : entry.sharedKey ? 'Wspólna zasada' : entry.title}
                              </div>
                              <div className="line-clamp-3">{plain(entry.content)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {!rows.length && <p className="text-sm text-[#e5e4e2]/60">Klauzule produktów są uporządkowane.</p>}
          </div>

          {backups.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-2 text-lg font-light">Kopie sprzed porządkowania</h2>
              <div className="space-y-1.5">
                {backups.map((backup) => (
                  <div key={backup.id} className="flex items-center justify-between rounded-lg bg-[#1c1f33] px-4 py-2 text-sm">
                    <span className="text-[#e5e4e2]/70">
                      {names.get(backup.product_id) || 'Produkt'}{backup.variant_id ? ' (wariant)' : ''} — {new Date(backup.created_at).toLocaleString('pl-PL')}
                    </span>
                    <button type="button" onClick={() => void restore(backup)} className="flex items-center gap-1 text-[#d3bb73] hover:underline">
                      <RotateCcw className="h-4 w-4" /> Przywróć
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
