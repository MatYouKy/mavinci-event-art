'use client';

import { useId, useRef, useState } from 'react';

export type InvoiceBuyerCorrectionDraft = {
  source: 'organization' | 'manual';
  organizationId: string;
  name: string;
  nip: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
};

export const normalizeCorrectionNip = (value: unknown) => String(value || '').trim().replace(/^PL/i, '').replace(/[\s-]/g, '');
export const normalizeCorrectionCountry = (value: unknown) => {
  const country = String(value || 'PL').trim().toUpperCase();
  return ['POLSKA', 'POLAND'].includes(country) ? 'PL' : country;
};

export function buyerCorrectionDraftFromInvoice(invoice: Record<string, any>): InvoiceBuyerCorrectionDraft {
  return {
    source: invoice.organization_id ? 'organization' : 'manual', organizationId: invoice.organization_id || '',
    name: invoice.buyer_name || '', nip: normalizeCorrectionNip(invoice.buyer_nip), street: invoice.buyer_street || '',
    postalCode: invoice.buyer_postal_code || '', city: invoice.buyer_city || '', countryCode: normalizeCorrectionCountry(invoice.buyer_country),
  };
}

const fieldClass = 'mt-1 w-full rounded-lg border border-[#d3bb73]/15 bg-black/20 px-3 py-2 text-sm text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40 disabled:opacity-65';
const searchText = (value: unknown) => String(value || '').toLocaleLowerCase('pl-PL')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').trim();

export default function InvoiceBuyerCorrectionEditor({ value, onChange, originalNip, organizations, disabled = false, organizationsLoading = false, organizationsError = null, onRetryOrganizations }: {
  value: InvoiceBuyerCorrectionDraft;
  onChange: (draft: InvoiceBuyerCorrectionDraft) => void;
  originalNip: string;
  organizations: Array<{ id: string; name: string; nip: string | null; street: string | null; postal_code: string | null; city: string | null; country?: string | null }>;
  disabled?: boolean;
  organizationsLoading?: boolean;
  organizationsError?: string | null;
  onRetryOrganizations?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchId = useId();
  const listId = `${searchId}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const taxpayerNip = normalizeCorrectionNip(originalNip);
  const sameTaxpayer = organizations.filter((organization) => taxpayerNip
    && normalizeCorrectionNip(organization.nip) === taxpayerNip);
  const query = searchText(search);
  const queryWords = query.split(/\s+/).filter(Boolean);
  const nipQuery = /^(PL)?[\d\s-]+$/i.test(search.trim()) ? normalizeCorrectionNip(search) : '';
  const visibleOrganizations = sameTaxpayer.filter((organization) => {
    const haystack = searchText([organization.name, organization.street, organization.postal_code, organization.city, organization.nip].filter(Boolean).join(' '));
    return !query || queryWords.every((word) => haystack.includes(word))
      || Boolean(nipQuery && taxpayerNip.includes(nipQuery));
  });
  const selectedOrganization = sameTaxpayer.find((organization) => organization.id === value.organizationId);
  const resultsAvailable = !organizationsLoading && !organizationsError;
  const activeOrganization = resultsAvailable ? visibleOrganizations[activeIndex] : undefined;
  const selectOrganization = (organization: typeof organizations[number]) => {
    if (disabled || normalizeCorrectionNip(organization.nip) !== taxpayerNip) return;
    onChange({ source: 'organization', organizationId: organization.id, name: organization.name, nip: taxpayerNip,
      street: organization.street || '', postalCode: organization.postal_code || '', city: organization.city || '', countryCode: normalizeCorrectionCountry(organization.country) });
    setSearch('');
    setIsOpen(false);
    setActiveIndex(-1);
  };
  const fields = [
    { key: 'name', label: 'Pełna nazwa nabywcy po korekcie *', wide: true, max: 512 },
    { key: 'street', label: 'Ulica i numer *', wide: true, max: 512 },
    { key: 'postalCode', label: 'Kod pocztowy *', max: 20 },
    { key: 'city', label: 'Miejscowość *', max: 256 },
    { key: 'countryCode', label: 'Kod kraju *', max: 2 },
  ] as const;

  return <fieldset disabled={disabled} className="rounded-xl bg-[#d3bb73]/5 p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-medium text-[#d3bb73]">Nabywca po korekcie</h3>
      <label className="text-xs text-[#e5e4e2]/65">Źródło danych
        <select className={fieldClass} value={value.source} onChange={(event) => {
          setSearch(''); setIsOpen(false); setActiveIndex(-1);
          onChange({ ...value, source: event.target.value as 'organization' | 'manual', organizationId: '' });
        }}>
          <option value="organization">Z organizacji CRM</option>
          <option value="manual">Wpisz ręcznie</option>
        </select>
      </label>
    </div>
    {value.source === 'organization' && <div className="mt-3">
      <div className="relative" onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
      }}>
        <label htmlFor={searchId} className="text-xs text-[#e5e4e2]/65">Wyszukaj organizację nabywcy *</label>
        <input id={searchId} ref={inputRef} value={search} className={fieldClass}
          role="combobox" aria-autocomplete="list" aria-expanded={isOpen}
          aria-controls={isOpen && resultsAvailable && visibleOrganizations.length ? listId : undefined}
          aria-activedescendant={isOpen && activeOrganization ? `${listId}-${activeOrganization.id}` : undefined}
          autoComplete="off" placeholder="Wpisz nazwę, NIP, miejscowość lub adres…"
          onFocus={() => { setIsOpen(true); setActiveIndex(-1); }}
          onChange={(event) => { setSearch(event.target.value); setIsOpen(true); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setIsOpen(false); return; }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (isOpen && activeOrganization) selectOrganization(activeOrganization);
              else setIsOpen(true);
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setIsOpen(true);
              if (!resultsAvailable || !visibleOrganizations.length) return;
              const count = visibleOrganizations.length;
              setActiveIndex((current) => !isOpen || current < 0
                ? (event.key === 'ArrowDown' ? 0 : count - 1)
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
            }
          }} />
        {isOpen && <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg bg-[var(--crm-card-bg,#421426)] shadow-xl">
          {organizationsLoading ? <p role="status" className="p-4 text-sm text-[#e5e4e2]/70">Pobieranie organizacji…</p>
            : organizationsError ? <p className="p-4 text-sm text-[#e5e4e2]/70">Lista organizacji jest niedostępna. Spróbuj ponownie poniżej.</p>
              : visibleOrganizations.length ? <div id={listId} role="listbox" aria-label="Organizacje z tym samym NIP" className="max-h-72 overflow-y-auto">
                {visibleOrganizations.map((organization, index) => <button
                  key={organization.id} id={`${listId}-${organization.id}`} type="button" role="option" tabIndex={-1}
                  aria-selected={organization.id === value.organizationId}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOrganization(organization)}
                  className={`block w-full px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10 ${activeIndex === index ? 'bg-[#d3bb73]/15' : ''}`}>
                  <span className="block text-sm font-medium text-[#e5e4e2]">{organization.name}</span>
                  <span className="mt-1 block text-xs text-[#e5e4e2]/65">{[organization.street, [organization.postal_code, organization.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Brak adresu w CRM'}</span>
                  <span className="mt-1 block text-xs text-[#d3bb73]">NIP: {taxpayerNip}{organization.id === value.organizationId ? ' · Obecnie wybrana' : ''}</span>
                </button>)}
              </div> : <p role="status" className="p-4 text-sm text-[#e5e4e2]/70">
                {sameTaxpayer.length ? 'Brak wyników dla wpisanej nazwy lub adresu. Spróbuj wpisać mniej słów.' : `Brak dostępnych organizacji z NIP ${taxpayerNip}. Możesz wpisać poprawione dane ręcznie.`}
              </p>}
        </div>}
      </div>
      {organizationsError ? <div role="alert" className="mt-2 rounded-lg bg-red-500/10 p-3 text-xs text-red-200">
        {organizationsError}
        {onRetryOrganizations && <button type="button" disabled={organizationsLoading} onClick={onRetryOrganizations}
          className="ml-2 rounded px-2 py-1 text-[#d3bb73] hover:bg-white/5 disabled:opacity-50">Pobierz ponownie</button>}
      </div> : <p className="mt-2 text-xs text-[#e5e4e2]/55">Wyniki obejmują organizacje z NIP {taxpayerNip}. Kliknij właściwą nazwę, aby uzupełnić dane poniżej.</p>}
      {value.organizationId && <div className="mt-3 rounded-lg bg-black/15 px-3 py-2 text-xs text-[#e5e4e2]/70">
        <span className="block text-[#d3bb73]">Wybrana organizacja CRM</span>
        <span className="mt-1 block">{selectedOrganization?.name || value.name || 'Organizacja z faktury pierwotnej'}</span>
        <span className="mt-1 block">{[selectedOrganization?.street || value.street, [selectedOrganization?.postal_code || value.postalCode, selectedOrganization?.city || value.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span>
      </div>}
    </div>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {fields.map((field) => <label key={field.key} className={`text-xs text-[#e5e4e2]/65 ${'wide' in field ? 'sm:col-span-2' : ''}`}>
        {field.label}
        <input className={fieldClass} maxLength={field.max} value={value[field.key]} onChange={(event) => onChange({ ...value, [field.key]: field.key === 'countryCode' ? event.target.value.toUpperCase() : event.target.value })} />
      </label>)}
      <label className="text-xs text-[#e5e4e2]/65">NIP — bez zmiany podatnika
        <input className={fieldClass} value={normalizeCorrectionNip(originalNip)} readOnly aria-readonly="true" />
      </label>
    </div>
    <p className="mt-3 text-xs leading-5 text-[#e5e4e2]/60">Możesz poprawić nazwę i adres tego samego podatnika. Dane zostaną zapisane na korekcie, bez zmieniania faktury pierwotnej ani karty organizacji.</p>
  </fieldset>;
}
