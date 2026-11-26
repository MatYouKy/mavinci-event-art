'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, PackageOpen, Plus, RefreshCw, Search, Truck, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  listRentals,
  loadRentalAccess,
  rentalDateTime,
  rentalErrorMessage,
  rentalMoney,
  type RentalAccess,
  type RentalListRow,
  type RentalStatus,
} from '@/lib/CRM/rental/rental';
import RentalFormModal from '@/components/crm/rental/RentalFormModal';
import { RentalError, RentalStatusBadge, rentalInput, rentalPrimaryButton, rentalButton } from '@/components/crm/rental/rentalUi';

/*
 * Rental → Wypożyczenia klientom (`docs/rental.md`): lista wypożyczeń dostępnych dla osoby (`rental_list` — sprzedaż widzi
 * swoje / wszystkie, magazyn — od rezerwacji, bez kwot). Zakładki: w toku, szkice, do rozliczenia, archiwum.
 */

type Tab = 'active' | 'draft' | 'returned' | 'archive' | 'all';
const TABS: Array<{ id: Tab; label: string; statuses: RentalStatus[] | null }> = [
  { id: 'active', label: 'W toku', statuses: ['reserved', 'issued'] },
  { id: 'draft', label: 'Szkice', statuses: ['draft'] },
  { id: 'returned', label: 'Do rozliczenia', statuses: ['returned'] },
  { id: 'archive', label: 'Archiwum', statuses: ['settled', 'cancelled'] },
  { id: 'all', label: 'Wszystkie', statuses: null },
];
const TAB_KEY = 'crm-rental-tab';

export default function RentalListPage() {
  const router = useRouter();
  const [access, setAccess] = useState<RentalAccess | null>(null);
  const [rows, setRows] = useState<RentalListRow[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved && TABS.some((item) => item.id === saved)) setTab(saved);
    } catch {
      // pamięć przeglądarki niedostępna — domyślna zakładka
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rights, list] = await Promise.all([loadRentalAccess(supabase), listRentals(supabase, mine ? { mine: true } : {})]);
      setAccess(rights);
      setRows(list);
      setError(null);
    } catch (failure) {
      setError(rentalErrorMessage(failure, 'Nie udało się pobrać wypożyczeń.'));
    } finally {
      setLoading(false);
    }
  }, [mine]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseTab = (value: Tab) => {
    setTab(value);
    try {
      window.localStorage.setItem(TAB_KEY, value);
    } catch {
      // bez zapamiętania zakładki
    }
  };

  const counts = useMemo(() => Object.fromEntries(TABS.map((item) => [item.id, item.statuses ? rows.filter((row) => item.statuses!.includes(row.status)).length : rows.length])), [rows]);
  const visible = useMemo(() => {
    const statuses = TABS.find((item) => item.id === tab)?.statuses;
    const text = query.trim().toLowerCase();
    return rows.filter((row) => (!statuses || statuses.includes(row.status))
      && (!text || `${row.number} ${row.title} ${row.client_name}`.toLowerCase().includes(text)));
  }, [query, rows, tab]);

  const showSales = Boolean(access?.sales_view);

  return (
    <div className="min-h-screen space-y-5 bg-[#0a0d1a] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PackageOpen className="h-8 w-8 text-[#d3bb73]" />
          <div>
            <h1 className="text-2xl font-light uppercase tracking-wide text-[#e5e4e2]">Wypożyczenia klientom</h1>
            <p className="text-sm text-[#e5e4e2]/60">Sprzęt i dekoracje z magazynu wypożyczane bez eventu — rezerwacja stanu, protokoły wydania i odbioru, rozliczenie.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className={rentalButton} onClick={() => void load()} disabled={loading} aria-label="Odśwież"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          {access?.create && (
            <button type="button" className={rentalPrimaryButton} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nowe wypożyczenie</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Status">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => chooseTab(item.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === item.id ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:bg-white/5'}`}>
              {item.label} <span className="opacity-70">{counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po numerze, nazwie lub kliencie…" className={`${rentalInput} pl-9`} />
        </label>
        {showSales && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#e5e4e2]/80">
            <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />Tylko moje
          </label>
        )}
      </div>

      <RentalError message={error} />

      {loading && rows.length === 0 ? (
        <p className="text-sm text-[#e5e4e2]/60">Wczytywanie wypożyczeń…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1c1f33] p-10 text-center">
          <PackageOpen className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-sm text-[#e5e4e2]/60">{query ? 'Nie znaleziono wypożyczeń.' : 'Brak wypożyczeń w tej zakładce.'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33]">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
              <tr>
                <th className="px-4 py-3 font-normal">Wypożyczenie</th>
                <th className="px-4 py-3 font-normal">Klient</th>
                <th className="px-4 py-3 font-normal">Termin</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 text-right font-normal">Sprzęt</th>
                {showSales && <th className="px-4 py-3 text-right font-normal">Brutto</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} onClick={() => router.push(`/crm/rental/${row.id}`)} className="cursor-pointer border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#e5e4e2]">{row.number}</p>
                    {row.title && <p className="text-xs text-[#e5e4e2]/60">{row.title}</p>}
                  </td>
                  <td className="px-4 py-3 text-[#e5e4e2]">
                    {row.client_name}
                    {row.seller_name && <p className="text-xs text-[#e5e4e2]/50">Opiekun: {row.seller_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#e5e4e2]/80">
                    <p className="flex items-center gap-1">{row.handover === 'delivery' && <Truck className="h-3.5 w-3.5 text-[#d3bb73]" aria-label="Dostawa" />}{rentalDateTime(row.starts_at)}</p>
                    <p className={row.overdue ? 'text-red-200' : ''}>do {rentalDateTime(row.ends_at)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <RentalStatusBadge status={row.status} />
                      {row.overdue && <span className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2 py-0.5 text-xs text-red-200"><AlertTriangle className="h-3 w-3" />Po terminie</span>}
                      {row.open_issues > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-100"><Wrench className="h-3 w-3" />{row.open_issues}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-[#e5e4e2]/80">
                    {row.items_count} poz. · {row.quantity} szt.
                    {row.out_qty > 0 && <p className="text-[#d3bb73]">u klienta {row.out_qty}</p>}
                  </td>
                  {showSales && <td className="px-4 py-3 text-right text-[#e5e4e2]">{row.sales ? rentalMoney(row.sales.totals.gross) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && access && (
        <RentalFormModal access={access} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); router.push(`/crm/rental/${id}?pozycje=1`); }} />
      )}
    </div>
  );
}
