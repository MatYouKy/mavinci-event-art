'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import type { BrochureClient } from '@/lib/brochures/recipient';

type OrganizationOption = { id: string; name: string };
type Result = { id: string; name: string; email: string; organizations: OrganizationOption[] };
type SearchContact = {
  id: string; full_name: string; email: string | null;
  links: { is_current: boolean; organization: OrganizationOption | OrganizationOption[] | null }[];
};
const field = 'w-full rounded-lg border border-white/5 bg-black/15 px-3 py-2.5 text-sm text-white outline-none focus:bg-white/5';

export default function BrochureClientPicker({ value, onChange, disabled }: {
  value: BrochureClient | null;
  onChange: (value: BrochureClient | null, suggestedEmail?: string) => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<'contact' | 'organization'>('contact');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const term = query.trim().replace(/[,%()"\\]/g, ' ').trim().slice(0, 100);
    setResults([]); setError(''); setLoading(false);
    if (disabled || value || term.length < 2) return;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (mode === 'organization') {
            const response = await supabase.from('organizations').select('id,name,email')
              .or(`name.ilike.%${term}%,email.ilike.%${term}%`).order('name').limit(15);
            if (response.error) throw response.error;
            if (active) setResults((response.data || []).map(row => ({ ...row, email: row.email || '', organizations: [] })));
          } else {
            const response = await supabase.from('contacts')
              .select('id,full_name,email,links:contact_organizations(is_current,organization:organizations(id,name))')
              .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).order('full_name').limit(15);
            if (response.error) throw response.error;
            if (active) setResults(((response.data || []) as unknown as SearchContact[]).map(row => {
              const linked = row.links.filter(link => link.is_current)
                .flatMap(link => link.organization ? Array.isArray(link.organization) ? link.organization : [link.organization] : []);
              return { id: row.id, name: row.full_name, email: row.email || '',
                organizations: [...new Map(linked.map(org => [org.id, org])).values()] };
            }));
          }
        } catch {
          if (active) setError('Nie udało się wyszukać klientów. Zmień zapytanie, aby spróbować ponownie.');
        } finally {
          if (active) setLoading(false);
        }
      })();
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, mode, disabled, value]);

  const choose = (row: Result) => {
    const org = mode === 'organization' ? row : row.organizations.length === 1 ? row.organizations[0] : undefined;
    setOrganizations(row.organizations); setQuery(''); setResults([]);
    onChange({
      name: row.name,
      ...(mode === 'contact' ? { contactId: row.id } : {}),
      ...(org ? { organizationId: org.id, organizationName: org.name } : {}),
    }, row.email);
  };

  return <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
    <legend className="mb-2 text-sm text-white/80">Powiąż tę wersję PDF z klientem — opcjonalnie</legend>
    {value ? <div className="space-y-3 rounded-lg bg-[#d3bb73]/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm text-[#d3bb73]" href={`/crm/contacts/${value.contactId || value.organizationId}?tab=brochures`}>
          {value.name} → Broszury klienta
        </Link>
        <button type="button" onClick={() => { onChange(null, ''); setOrganizations([]); }} className="text-xs text-white/60">
          Zmień / usuń powiązanie
        </button>
      </div>
      {value.contactId && organizations.length > 0 && <label className="block text-xs text-white/60">
        Organizacja, dla której przygotowujesz tę wersję
        <select className={`${field} mt-2`} value={value.organizationId || ''} onChange={event => {
          const org = organizations.find(item => item.id === event.target.value);
          onChange({ contactId: value.contactId, name: value.name, ...(org ? { organizationId: org.id, organizationName: org.name } : {}) });
        }}>
          <option value="">Tylko kontakt — bez organizacji</option>
          {organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </label>}
      <p className="text-xs leading-5 text-white/55">
        Po wygenerowaniu plik pojawi się przy {value.contactId && value.organizationId ? 'kontakcie oraz wybranej organizacji' : value.contactId ? 'tym kontakcie' : 'tej organizacji'}.
        {' '}Powiązanie nie zmienia treści ani ustawień broszury bazowej.
      </p>
    </div> : <>
      <div className="flex gap-2">
        {([{ key: 'contact', label: 'Kontakt' }, { key: 'organization', label: 'Organizacja' }] as const).map(item =>
          <button key={item.key} type="button" aria-pressed={mode === item.key}
            onClick={() => { setMode(item.key); setQuery(''); }}
            className={`rounded-lg px-3 py-2 text-sm ${mode === item.key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-white/60'}`}>
            {item.label}
          </button>)}
      </div>
      <input type="search" className={field} value={query} maxLength={100}
        aria-label={mode === 'contact' ? 'Wyszukaj kontakt do broszury' : 'Wyszukaj organizację do broszury'}
        placeholder={mode === 'contact' ? 'Imię, nazwisko lub e-mail — minimum 2 znaki' : 'Nazwa organizacji lub e-mail — minimum 2 znaki'}
        onChange={event => setQuery(event.target.value)} />
      {loading && <p role="status" className="text-xs text-white/50">Wyszukiwanie klientów…</p>}
      {!loading && query.trim().length >= 2 && !error && !results.length && <p className="text-xs text-white/50">Brak pasujących klientów.</p>}
      {results.length > 0 && <div className="max-h-60 overflow-y-auto rounded-lg bg-black/15">
        {results.map(row => <button key={row.id} type="button" onClick={() => choose(row)}
          className="block w-full px-3 py-3 text-left text-sm hover:bg-white/5 focus:bg-white/5">
          {row.name}
          <span className="mt-1 block text-xs text-white/50">{row.email || 'Brak e-maila — nadal możesz podpiąć PDF'}
            {row.organizations.length > 0 ? ` · ${row.organizations.map(org => org.name).join(', ')}` : ''}
          </span>
        </button>)}
      </div>}
      <p className="text-xs text-white/45">Bez wyboru klienta możesz nadal wygenerować PDF ogólny lub podać sam adres e-mail.</p>
    </>}
    {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
  </fieldset>;
}
