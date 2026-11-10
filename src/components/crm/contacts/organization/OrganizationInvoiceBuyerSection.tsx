'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Landmark, Loader2, ReceiptText } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import SearchCombobox from '@/components/crm/SearchCombobox';
import {
  fetchInvoiceUnits,
  invoiceRecipientRoleLabels,
  type InvoiceUnitOrganization,
} from '@/lib/organizations/invoiceBuyer';
import type {
  OrganizationFormErrors,
  OrganizationInvoiceRecipientRole,
} from './organizationValidation';
import { organizationInputClassName } from './OrganizationFormFields';

type BuyerOption = {
  id: string;
  name: string;
  alias: string | null;
  nip: string | null;
  city: string | null;
  invoice_buyer_organization_id: string | null;
};

export type InvoiceBuyerValue = {
  invoice_buyer_organization_id: string | null;
  invoice_recipient_role: OrganizationInvoiceRecipientRole | null;
};

interface Props extends InvoiceBuyerValue {
  /** Brak przy dodawaniu nowej organizacji. */
  organizationId?: string | null;
  editMode: boolean;
  errors?: OrganizationFormErrors;
  onChange?: (value: InvoiceBuyerValue) => void;
}

/**
 * „Dane do faktury”: na kogo wystawiamy faktury za tę organizację.
 * Przykład: klientem i stroną umowy jest szkoła, nabywcą na fakturze — gmina (osobna organizacja w CRM).
 */
export default function OrganizationInvoiceBuyerSection({
  organizationId = null,
  invoice_buyer_organization_id: buyerId,
  invoice_recipient_role: role,
  editMode,
  errors = {},
  onChange,
}: Props) {
  const [options, setOptions] = useState<BuyerOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [units, setUnits] = useState<InvoiceUnitOrganization[]>([]);
  const [buyer, setBuyer] = useState<BuyerOption | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const separateBuyer = buyerId !== null || role !== null;

  useEffect(() => {
    let active = true;
    fetchInvoiceUnits(organizationId)
      .then((rows) => { if (active) setUnits(rows); })
      .catch(() => { if (active) setUnits([]); });
    return () => { active = false; };
  }, [organizationId]);

  useEffect(() => {
    if (!editMode) return;
    let active = true;
    setOptionsLoading(true);
    (supabase.from as any)('organizations')
      .select('id,name,alias,nip,city,invoice_buyer_organization_id')
      .eq('organization_type', 'client')
      .order('name')
      .then(({ data, error }: { data: BuyerOption[] | null; error: { message: string } | null }) => {
        if (!active) return;
        setOptionsLoading(false);
        if (error) setLoadError('Nie udało się wczytać organizacji. Odśwież stronę i spróbuj ponownie.');
        else setOptions(data || []);
      });
    return () => { active = false; };
  }, [editMode]);

  useEffect(() => {
    if (!buyerId) { setBuyer(null); return; }
    const known = options.find((option) => option.id === buyerId);
    if (known) { setBuyer(known); return; }
    let active = true;
    (supabase.from as any)('organizations')
      .select('id,name,alias,nip,city,invoice_buyer_organization_id')
      .eq('id', buyerId)
      .maybeSingle()
      .then(({ data }: { data: BuyerOption | null }) => { if (active) setBuyer(data); });
    return () => { active = false; };
  }, [buyerId, options]);

  const buyerOptions = useMemo(() => options
    .filter((option) => option.id !== organizationId && (!option.invoice_buyer_organization_id || option.id === buyerId))
    .map((option) => ({
      id: option.id,
      label: option.alias ? `${option.alias} — ${option.name}` : option.name,
      description: [option.nip ? `NIP ${option.nip}` : 'brak NIP', option.city].filter(Boolean).join(' · '),
      keywords: [option.name, option.alias, option.nip, option.city].filter(Boolean).join(' '),
    })), [options, organizationId, buyerId]);

  const isBuyerForOthers = units.length > 0;
  const setValue = (next: InvoiceBuyerValue) => onChange?.(next);
  const buyerLabel = buyer ? buyer.alias || buyer.name : null;
  const effectiveRole: OrganizationInvoiceRecipientRole = role === 2 ? 2 : 8;

  return (
    <section className="rounded-lg bg-[#1a1d2e] p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-[#d3bb73]/10 p-2"><ReceiptText className="h-5 w-5 text-[#d3bb73]" /></div>
        <div>
          <h2 className="text-lg uppercase text-white">Dane do faktury</h2>
          <p className="mt-1 text-sm text-gray-400">
            Na kogo wystawiamy faktury za tę organizację. Umowę i wydarzenia nadal prowadzisz z nią samą.
          </p>
        </div>
      </div>

      {editMode ? (
        <div className="space-y-4">
          {isBuyerForOthers ? (
            <p className="rounded-lg bg-white/5 p-3 text-sm text-gray-300">
              Ta organizacja jest nabywcą faktur dla innych jednostek, więc faktury wystawiamy na nią samą.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Na kogo wystawiamy faktury">
              {[
                { value: false, title: 'Na tę organizację', text: 'Ona jest nabywcą na fakturze.' },
                { value: true, title: 'Na inną organizację', text: 'Np. szkoła lub przedszkole → gmina.' },
              ].map((choice) => (
                <button
                  key={String(choice.value)}
                  type="button"
                  role="radio"
                  aria-checked={separateBuyer === choice.value}
                  onClick={() => setValue(choice.value
                    ? { invoice_buyer_organization_id: buyerId, invoice_recipient_role: role ?? 8 }
                    : { invoice_buyer_organization_id: null, invoice_recipient_role: null })}
                  className={`rounded-lg p-3 text-left transition-colors ${separateBuyer === choice.value
                    ? 'bg-[#d3bb73]/15 text-[#d3bb73]'
                    : 'bg-[#0f1119] text-gray-300 hover:bg-white/5'}`}
                >
                  <span className="block text-sm font-medium">{choice.title}</span>
                  <span className="mt-0.5 block text-xs opacity-70">{choice.text}</span>
                </button>
              ))}
            </div>
          )}

          {separateBuyer && !isBuyerForOthers && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-gray-300">
                  Nabywca na fakturach <span className="text-red-400">*</span>
                </span>
                <SearchCombobox
                  value={buyerId || ''}
                  options={buyerOptions}
                  loading={optionsLoading}
                  name="invoice_buyer_organization_id"
                  ariaLabel="Nabywca na fakturach"
                  error={Boolean(errors.invoice_buyer_organization_id)}
                  placeholder="Wyszukaj gminę lub inną organizację…"
                  emptyLabel="Brak organizacji — dodaj najpierw nabywcę (np. gminę) jako organizację"
                  onChange={(id) => setValue({ invoice_buyer_organization_id: id || null, invoice_recipient_role: effectiveRole })}
                />
                {errors.invoice_buyer_organization_id && (
                  <p className="mt-1 text-sm text-red-400">{errors.invoice_buyer_organization_id}</p>
                )}
                {buyer && !buyer.nip && (
                  <p className="mt-1 text-sm text-amber-300">Wybrana organizacja nie ma NIP — uzupełnij go w jej karcie, inaczej nie zapiszesz powiązania.</p>
                )}
                {loadError && <p className="mt-1 text-sm text-amber-300">{loadError}</p>}
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-300">Ta organizacja na fakturze</span>
                <select
                  value={effectiveRole}
                  onChange={(event) => setValue({ invoice_buyer_organization_id: buyerId, invoice_recipient_role: event.target.value === '2' ? 2 : 8 })}
                  className={organizationInputClassName}
                >
                  <option value={8}>Jednostka podrzędna JST (szkoła, przedszkole…)</option>
                  <option value={2}>Oddział / jednostka wewnętrzna nabywcy</option>
                </select>
              </label>
              <p className="text-xs leading-5 text-gray-400 md:col-span-2">
                {effectiveRole === 8
                  ? 'Na fakturze: nabywca — wybrana organizacja (w KSeF z oznaczeniem JST), odbiorca — ta jednostka (rola 8, po jej własnym NIP-ie). Jednostka musi mieć własny NIP.'
                  : 'Na fakturze: nabywca — wybrana organizacja, odbiorca — ta jednostka (rola 2). Wpisz wyżej jej numer identyfikacji wewnętrznej KSeF — zaczyna się od NIP-u nabywcy.'}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {buyerId ? (
            <div className="flex items-start gap-3 rounded-lg bg-[#0f1119] p-4">
              <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-[#d3bb73]/70">Nabywca na fakturach</p>
                {buyer ? (
                  <Link href={`/crm/contacts/${buyer.id}`} className="mt-1 block truncate text-white hover:text-[#d3bb73]">
                    {buyerLabel}{buyer.nip ? ` · NIP ${buyer.nip}` : ''}
                  </Link>
                ) : <Loader2 className="mt-1 h-4 w-4 animate-spin text-gray-400" />}
                <p className="mt-1 text-xs text-gray-400">Ta organizacja na fakturze jako odbiorca — {invoiceRecipientRoleLabels[effectiveRole]}.</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-300">Faktury wystawiamy na tę organizację.</p>
          )}
        </div>
      )}

      {isBuyerForOthers && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Jednostki rozliczane na tę organizację</p>
          <ul className="space-y-1">
            {units.map((unit) => (
              <li key={unit.id}>
                <Link href={`/crm/contacts/${unit.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#0f1119] px-3 py-2 text-sm text-white hover:bg-white/5">
                  <span className="truncate">{unit.alias || unit.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">{unit.invoice_recipient_role === 2 ? 'jednostka wewnętrzna' : 'JST'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
