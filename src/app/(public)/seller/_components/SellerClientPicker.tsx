'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import SearchCombobox from '@/components/crm/SearchCombobox';

export type SellerClientData = { name: string; company: string; email: string; phone: string };
type SavedClient = SellerClientData & { id: string };

export default function SellerClientPicker({ companyId, client, onSelect }: {
  companyId: string;
  client: SellerClientData;
  onSelect: (client: SellerClientData) => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SavedClient[]>([]);
  const [selected, setSelected] = useState<SavedClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    setLoadError('');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('search_seller_portal_clients', { p_company_id: companyId, p_query: query });
          if (cancelled) return;
          if (error) throw error;
          setRows((data || []) as SavedClient[]);
        } catch {
          if (!cancelled) setLoadError('Nie udało się pobrać klientów. Spróbuj ponownie.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [companyId, query, refresh]);

  useEffect(() => { setSelected(null); setMessage(''); }, [companyId]);
  useEffect(() => {
    const refreshContacts = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', refreshContacts);
    return () => window.removeEventListener('focus', refreshContacts);
  }, []);

  // A manual edit is a draft for this offer, not a silent update of the saved contact.
  useEffect(() => {
    if (selected && (['name', 'company', 'email', 'phone'] as const).some(key => client[key] !== selected[key])) setSelected(null);
  }, [client.name, client.company, client.email, client.phone, selected]);

  const search = (next: string) => {
    if (next === query) return;
    setQuery(next); setLoading(true); setRows([]); setLoadError('');
  };
  const choices = selected && !query && !rows.some(row => row.id === selected.id) ? [selected, ...rows] : rows;

  const save = async () => {
    if (saving || selected || (!client.name.trim() && !client.company.trim())) return;
    setSaving(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('save_seller_portal_client', { p_company_id: companyId, p_client: client });
      if (error) throw error;
      setMessage('Klient jest zapisany w Twojej bazie. Osoby i organizacje możesz edytować oraz powiązać w zakładce Kontakty.');
      setQuery(''); setLoading(true); setRows([]);
      setRefresh(value => value + 1);
    } catch (error) {
      setMessage(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Nie udało się zapisać klienta.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg bg-white/[0.025] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Twoi zapisani klienci</p><Link href="/seller/contacts" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">Zarządzaj kontaktami<span className="sr-only"> — otwiera nową kartę</span><ExternalLink className="h-3.5 w-3.5" /></Link></div>
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <SearchCombobox
          value={selected?.id || ''} loading={loading} onSearchChange={search}
          ariaLabel="Wyszukaj i wybierz zapisanego klienta" placeholder="Szukaj po nazwisku, firmie, e-mailu…"
          emptyLabel={loadError ? 'Nie udało się pobrać klientów' : query ? 'Brak pasujących klientów' : 'Brak zapisanych klientów'}
          filterOption={() => true}
          options={choices.map(row => ({
            id: row.id, label: [row.name, row.company].filter(Boolean).join(' · ') || row.email || row.phone || 'Zapisany klient',
            description: [row.name ? (row.company ? 'Osoba · firma' : 'Osoba') : 'Organizacja', row.email, row.phone].filter(Boolean).join(' · '),
          }))}
          onChange={id => {
            const found = choices.find(row => row.id === id);
            setSelected(found || null);
            if (found) { onSelect(found); setMessage('Dane klienta zostały uzupełnione w ofercie.'); }
            else setMessage('Wybór wyczyszczony. Dane wpisane w ofercie pozostają bez zmian.');
          }}
        />
        <button type="button" onClick={() => void save()} disabled={saving || Boolean(selected) || Boolean(loadError) || (!client.name.trim() && !client.company.trim())} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Zapisz klienta do mojej bazy
        </button>
      </div>
      {loadError && <p role="alert" className="mt-2 text-xs text-amber-200">{loadError} Dane klienta nadal możesz wpisać ręcznie. <button type="button" onClick={() => { setLoading(true); setRefresh(value => value + 1); }} className="ml-1 underline">Ponów wyszukiwanie</button></p>}
      {message && <p role="status" className="mt-2 text-xs text-[#d3bb73]">{message}</p>}
    </div>
  );
}
