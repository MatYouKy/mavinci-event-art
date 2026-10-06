'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

export type SellerClientData = { name: string; company: string; email: string; phone: string };
type SavedClient = SellerClientData & { id: string };
const fieldClass = 'h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 text-sm text-[#e5e4e2] outline-none focus-visible:ring-2 focus-visible:ring-[#d3bb73]/30';

export default function SellerClientPicker({ companyId, client, onSelect }: {
  companyId: string;
  client: SellerClientData;
  onSelect: (client: SellerClientData) => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SavedClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('search_seller_portal_clients', { p_company_id: companyId, p_query: query });
          if (cancelled) return;
          setLoadError(error ? 'Nie udało się pobrać klientów. Jeśli funkcja nie jest jeszcze wdrożona, wymaga migracji 20260908220000.' : '');
          setRows(error ? [] : (data || []) as SavedClient[]);
        } catch {
          if (!cancelled) setLoadError('Nie udało się pobrać klientów. Spróbuj ponownie.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [companyId, query, refresh]);

  const save = async () => {
    if (saving || (!client.name.trim() && !client.company.trim())) return;
    setSaving(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('save_seller_portal_client', { p_company_id: companyId, p_client: client });
      if (error) throw error;
      setMessage('Klient jest zapisany w Twojej bazie. Identyczny wpis nie zostanie dodany ponownie.');
      setQuery('');
      setRefresh((value) => value + 1);
    } catch (error) {
      setMessage(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Nie udało się zapisać klienta.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg bg-white/[0.025] p-3">
      <p className="mb-2 text-xs text-white/50">Twoi zapisani klienci — tylko dla tej marki</p>
      <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input aria-label="Szukaj zapisanego klienta" placeholder="Szukaj po nazwisku, firmie, e-mailu..." value={query} onChange={(event) => setQuery(event.target.value)} className={fieldClass} />
        <select aria-label="Wybierz zapisanego klienta" value="" disabled={loading || Boolean(loadError)} onChange={(event) => {
          const selected = rows.find((row) => row.id === event.target.value);
          if (selected) { onSelect(selected); setMessage('Dane klienta zostały uzupełnione w ofercie.'); }
        }} className={`${fieldClass} disabled:opacity-50`}>
          <option value="">{loading ? 'Szukam...' : rows.length ? 'Wybierz klienta' : 'Brak zapisanych klientów'}</option>
          {rows.map((row) => <option key={row.id} value={row.id}>{[row.name, row.company, row.email || row.phone].filter(Boolean).join(' · ')}</option>)}
        </select>
        <button type="button" onClick={() => void save()} disabled={saving || Boolean(loadError) || (!client.name.trim() && !client.company.trim())} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Zapisz klienta do mojej bazy
        </button>
      </div>
      {loadError && <p role="alert" className="mt-2 text-xs text-amber-200">{loadError} Dane klienta nadal możesz wpisać ręcznie.</p>}
      {message && <p role="status" className="mt-2 text-xs text-[#d3bb73]">{message}</p>}
    </div>
  );
}
