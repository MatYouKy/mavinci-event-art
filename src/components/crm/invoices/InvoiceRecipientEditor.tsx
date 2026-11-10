'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {
  createEmptyInvoiceRecipientDraft,
  type InvoiceRecipientDraft,
  type InvoiceRecipientFields,
} from '@/lib/invoices/ksefRecipient';
import type { FA3RecipientRole } from '@/lib/ksef/generateFA3XML';

type OrganizationOption = { id: string; name: string; nip: string | null; city: string | null };

const inputClass = 'mt-1 w-full rounded-lg border border-[#d3bb73]/15 bg-black/20 px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/35 focus:outline-none focus:border-[#d3bb73]/40 disabled:opacity-65';

function countryCode(value: unknown): string {
  const country = String(value || '').trim().toUpperCase();
  const known: Record<string, string> = { POLSKA: 'PL', POLAND: 'PL', NIEMCY: 'DE', GERMANY: 'DE', CZECHY: 'CZ', SŁOWACJA: 'SK', 'WIELKA BRYTANIA': 'GB' };
  return known[country] || country || 'PL';
}

/** Edits the new document only. Values already copied from a source invoice are never reloaded automatically. */
export default function InvoiceRecipientEditor({ value, onChange, disabled = false, autoLoadOrganization = false }: {
  value: InvoiceRecipientDraft;
  onChange: (draft: InvoiceRecipientDraft) => void;
  disabled?: boolean;
  autoLoadOrganization?: boolean;
}) {
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const explicitlySelectedOrganization = useRef<string | null>(null);
  const callbackRef = useRef(onChange);
  const valueRef = useRef(value);
  callbackRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    if (disabled || value.mode !== 'organization') return;
    let active = true;
    void (async () => {
      const { data, error: readError } = await supabase.from('organizations')
        .select('id,name,nip,city').order('name');
      if (!active) return;
      if (readError) setError('Nie udało się wczytać organizacji. Możesz wprowadzić dane odbiorcy ręcznie.');
      else setOrganizations((data || []) as OrganizationOption[]);
    })();
    return () => { active = false; };
  }, [disabled, value.mode]);

  const loadOrganization = async (organizationId: string) => {
    if (disabled || !organizationId) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: readError } = await (supabase.from as any)('organizations')
        .select('id,name,nip,address,postal_code,city,country,ksef_internal_id,invoice_recipient_role')
        .eq('id', organizationId).maybeSingle();
      if (request !== requestRef.current || valueRef.current.mode !== 'organization'
        || valueRef.current.organizationId !== organizationId) return;
      if (readError || !data) throw new Error('Nie udało się odczytać danych odbiorcy. Wybierz organizację ponownie albo wpisz dane ręcznie.');
      // Jednostka podrzędna JST (np. szkoła rozliczana na gminę) ma w karcie rolę 8: własny NIP, bez IDWew.
      const role: FA3RecipientRole = data.invoice_recipient_role === 8 ? 8 : 2;
      callbackRef.current({ mode: 'organization', organizationId, data: {
        name: data.name || '', nip: role === 8 ? String(data.nip || '').replace(/\D/g, '') : data.nip || '',
        internalId: role === 8 ? '' : data.ksef_internal_id || '',
        street: data.address || '', postalCode: data.postal_code || '', city: data.city || '',
        countryCode: countryCode(data.country), role,
      } });
    } catch (readError) {
      if (request === requestRef.current) setError(readError instanceof Error ? readError.message : 'Nie udało się odczytać odbiorcy.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (disabled || value.mode !== 'organization' || !value.organizationId || value.data.name.trim()
      || (!autoLoadOrganization && explicitlySelectedOrganization.current !== value.organizationId)) return;
    void loadOrganization(value.organizationId);
    return () => { requestRef.current += 1; };
    // Intentionally not dependent on the editable fields: editing a snapshot must never reload CRM data.
  }, [disabled, value.mode, value.organizationId, autoLoadOrganization]);

  useEffect(() => () => { requestRef.current += 1; }, []);

  const change = (next: InvoiceRecipientDraft) => {
    requestRef.current += 1;
    setLoading(false);
    setError(null);
    onChange(next);
  };
  const updateField = (field: Exclude<keyof InvoiceRecipientFields, 'role'>, text: string) => {
    change({ ...value, data: { ...value.data, [field]: text } });
  };
  const isJstUnit = value.data.role === 8;
  const changeRole = (role: FA3RecipientRole) => {
    change({ ...value, data: { ...value.data, role, internalId: role === 8 ? '' : value.data.internalId } });
  };
  const fields: Array<{ key: Exclude<keyof InvoiceRecipientFields, 'role'>; label: string; wide?: boolean; maxLength?: number }> = [
    { key: 'name', label: 'Nazwa odbiorcy *', wide: true, maxLength: 512 },
    { key: 'nip', label: isJstUnit ? 'NIP jednostki *' : 'NIP odbiorcy — opcjonalnie', maxLength: 16 },
    ...(isJstUnit ? [] : [{ key: 'internalId' as const, label: 'IDWew KSeF — opcjonalnie', maxLength: 16 }]),
    { key: 'street', label: 'Ulica i numer *', wide: true, maxLength: 512 },
    { key: 'postalCode', label: 'Kod pocztowy *', maxLength: 20 },
    { key: 'city', label: 'Miejscowość *', maxLength: 256 },
    { key: 'countryCode', label: 'Kod kraju *', maxLength: 2 },
  ];
  const query = search.trim().toLocaleLowerCase('pl-PL');
  const visibleOrganizations = organizations.filter((organization) => !query || organization.id === value.organizationId
    || [organization.name, organization.nip, organization.city].some((part) => part?.toLocaleLowerCase('pl-PL').includes(query)));

  return (
    <section className="rounded-xl bg-[#d3bb73]/5 p-4 text-sm">
      <label className="flex items-center gap-3 font-medium text-[#e5e4e2]">
        <input type="checkbox" checked={value.mode === 'same_as_buyer'} disabled={disabled}
          onChange={(event) => change(event.target.checked ? createEmptyInvoiceRecipientDraft() : {
            ...createEmptyInvoiceRecipientDraft(), mode: 'organization',
          })} className="h-4 w-4 accent-[#d3bb73]" />
        Nabywca i odbiorca są tacy sami
      </label>
      {value.mode === 'same_as_buyer' ? (
        <p className="mt-2 text-xs text-[#e5e4e2]/60">Na fakturze będą dane nabywcy wybranego powyżej, bez osobnego odbiorcy.</p>
      ) : <>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-[#d3bb73]">Odbiorca — osobno od nabywcy</h3>
          <label className="text-xs text-[#e5e4e2]/65">Źródło danych
            <select value={value.mode} disabled={disabled} className={inputClass}
              onChange={(event) => change({ ...createEmptyInvoiceRecipientDraft(), mode: event.target.value as 'organization' | 'manual' })}>
              <option value="organization">Z organizacji CRM</option>
              <option value="manual">Wpisz ręcznie</option>
            </select>
          </label>
        </div>
        {value.mode === 'organization' && !disabled && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[#e5e4e2]/65">Szukaj organizacji
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nazwa, NIP lub miejscowość" className={inputClass} />
            </label>
            <label className="text-xs text-[#e5e4e2]/65">Organizacja odbiorcy *
              <select value={value.organizationId} onChange={(event) => {
                explicitlySelectedOrganization.current = event.target.value;
                change({ ...createEmptyInvoiceRecipientDraft(), mode: 'organization', organizationId: event.target.value });
              }} className={inputClass}>
                <option value="">Wybierz odbiorcę</option>
                {value.organizationId && !organizations.some((organization) => organization.id === value.organizationId)
                  && <option value={value.organizationId}>{value.data.name || 'Odbiorca przypisany do dokumentu'}</option>}
                {visibleOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.city ? ` · ${organization.city}` : ''}{organization.nip ? ` · ${organization.nip}` : ''}</option>)}
              </select>
            </label>
          </div>
        )}
        <label className="mt-3 block text-xs text-[#e5e4e2]/65">Rodzaj odbiorcy w KSeF
          <select value={value.data.role} disabled={disabled || loading} className={inputClass}
            onChange={(event) => changeRole(event.target.value === '8' ? 8 : 2)}>
            <option value={2}>Odbiorca — oddział lub jednostka wewnętrzna nabywcy</option>
            <option value={8}>Jednostka podrzędna JST — np. szkoła, przedszkole (nabywcą jest gmina)</option>
          </select>
        </label>
        {isJstUnit && <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/60">
          Nabywcą na fakturze jest JST (np. gmina) — w KSeF dostanie oznaczenie JST, a ta jednostka trafi jako odbiorca (rola 8) i zobaczy fakturę po swoim NIP-ie.
        </p>}
        {loading && <p role="status" className="mt-3 text-xs text-[#e5e4e2]/60">Wczytywanie danych odbiorcy…</p>}
        {error && <p role="alert" className="mt-3 text-xs text-[#d3bb73]">{error}</p>}
        {value.mode === 'organization' && value.organizationId && !disabled && !loading && (
          <button type="button" onClick={() => void loadOrganization(value.organizationId)}
            className="mt-3 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15">
            Pobierz aktualne dane z CRM
          </button>
        )}
        <fieldset disabled={disabled || loading} className="mt-4 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => <label key={field.key} className={`text-xs text-[#e5e4e2]/65 ${field.wide ? 'sm:col-span-2' : ''}`}>
            {field.label}
            <input value={value.data[field.key]} maxLength={field.maxLength} className={inputClass}
              onChange={(event) => updateField(field.key, field.key === 'countryCode' ? event.target.value.toUpperCase() : event.target.value)} />
          </label>)}
        </fieldset>
        <p className="mt-3 text-xs leading-5 text-[#e5e4e2]/60">Te dane odbiorcy zostaną zapisane przy fakturze i użyte w PDF oraz KSeF. Nie zastępują nabywcy. Edycja dotyczy tej faktury, nie karty organizacji.</p>
      </>}
    </section>
  );
}
