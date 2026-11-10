'use client';

import { Globe, Loader2, Mail, Phone, Search } from 'lucide-react';
import type { GUSCompanyData } from '@/lib/gus';
import { ContactValidationField } from '@/components/crm/contacts/contactValidation';
import { legalFormLabels } from '@/utils/labels/legalFormLabels';
import { requiresKrsForLegalForm } from '@/lib/organizations/organizationLegalForm';
import OrganizationRegistryLookupCard from './OrganizationRegistryLookupCard';
import {
  organizationStatusLabels,
  type OrganizationBusinessType,
  type OrganizationFormErrors,
  type OrganizationFormValues,
} from './organizationValidation';

export const organizationBusinessTypeLabels: Record<OrganizationBusinessType, string> = {
  company: 'Firma / instytucja',
  hotel: 'Hotel',
  restaurant: 'Restauracja',
  venue: 'Obiekt / sala eventowa',
  freelancer: 'Freelancer',
  other: 'Inny profil działalności',
};

/** Profile dostępne dla klienta — te same przy dodawaniu i edycji. */
export const clientBusinessTypes: OrganizationBusinessType[] = ['company', 'hotel', 'restaurant', 'venue', 'other'];

export const organizationInputClassName =
  'w-full rounded-lg bg-[#0f1119] px-4 py-2 text-white placeholder:text-white/30 outline-none transition-colors focus:bg-[#141826] focus:ring-1 focus:ring-[#d3bb73]/40 disabled:opacity-60';

type FieldName = keyof OrganizationFormValues;

interface Props {
  values: OrganizationFormValues;
  errors: OrganizationFormErrors;
  onChange: <K extends FieldName>(field: K, value: OrganizationFormValues[K]) => void;
  onFetchRegistry: () => void;
  loadingRegistry: boolean;
  registryLookup: GUSCompanyData | null;
  businessTypeOptions?: OrganizationBusinessType[];
  disabled?: boolean;
}

function Label({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-300">
      {children}
      {required && <span className="text-red-400">*</span>}
    </span>
  );
}

/**
 * Wspólne pola organizacji — ten sam zestaw i te same zasady Yup przy dodawaniu i edycji.
 * Sekcje dodatkowe (reprezentacja, lokalizacja, dane do faktury) dokładają strony.
 */
export default function OrganizationFormFields({
  values,
  errors,
  onChange,
  onFetchRegistry,
  loadingRegistry,
  registryLookup,
  businessTypeOptions = clientBusinessTypes,
  disabled = false,
}: Props) {
  const text = (field: FieldName) => {
    const value = values[field];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  };
  const input = (
    field: Extract<FieldName, keyof OrganizationFormErrors>,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <ContactValidationField field={field} error={errors[field]}>
      <input
        type="text"
        {...props}
        value={text(field)}
        disabled={disabled || props.disabled}
        onChange={(event) => onChange(field, event.target.value as never)}
        className={organizationInputClassName}
      />
    </ContactValidationField>
  );

  const legalFormRequiresKrs = requiresKrsForLegalForm(values.legal_form);
  const businessTypes = values.business_type && !businessTypeOptions.includes(values.business_type)
    ? [...businessTypeOptions, values.business_type]
    : businessTypeOptions;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm uppercase tracking-wide text-[#d3bb73]">Dane rejestrowe</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <Label required>Nazwa pełna</Label>
            {input('name', { placeholder: 'np. Szkoła Podstawowa nr 1 im. Mikołaja Kopernika w Olsztynie', maxLength: 512, autoComplete: 'organization' })}
          </label>

          <label className="block">
            <Label>Alias (krótka nazwa)</Label>
            {input('alias', { placeholder: 'np. SP 1 Olsztyn', maxLength: 256 })}
            <span className="mt-1 block text-xs text-gray-500">Wyświetlany w CRM zamiast pełnej nazwy.</span>
          </label>

          <div>
            <Label required>NIP</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                {input('nip', { placeholder: '0000000000', inputMode: 'numeric', maxLength: 20 })}
              </div>
              <button
                type="button"
                onClick={onFetchRegistry}
                disabled={disabled || loadingRegistry}
                className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[#d3bb73] px-4 text-sm text-[#0f1119] transition-colors hover:bg-[#c4a859] disabled:opacity-50"
              >
                {loadingRegistry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span>GUS / rejestry</span>
              </button>
            </div>
          </div>

          <div className="md:col-span-2">
            <OrganizationRegistryLookupCard data={registryLookup} />
          </div>

          <label className="block">
            <Label required>Profil działalności</Label>
            <ContactValidationField field="business_type" error={errors.business_type}>
              <select
                value={values.business_type || 'company'}
                disabled={disabled}
                onChange={(event) => onChange('business_type', event.target.value as OrganizationBusinessType)}
                className={organizationInputClassName}
              >
                {businessTypes.map((type) => (
                  <option key={type} value={type}>{organizationBusinessTypeLabels[type]}</option>
                ))}
              </select>
            </ContactValidationField>
          </label>

          <label className="block">
            <Label required>Forma prawna / typ podmiotu</Label>
            <ContactValidationField field="legal_form" error={errors.legal_form}>
              <select
                value={values.legal_form || ''}
                disabled={disabled}
                onChange={(event) => {
                  const legalForm = event.target.value;
                  onChange('legal_form', legalForm || null);
                  if (!requiresKrsForLegalForm(legalForm)) onChange('krs', null);
                }}
                className={organizationInputClassName}
              >
                <option value="">— wybierz formę prawną lub typ podmiotu —</option>
                {Object.entries(legalFormLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </ContactValidationField>
          </label>

          {legalFormRequiresKrs && (
            <label className="block">
              <Label required>KRS</Label>
              {input('krs', { placeholder: '0000000000', inputMode: 'numeric', maxLength: 14 })}
            </label>
          )}

          <label className="block">
            <Label>REGON</Label>
            {input('regon', { placeholder: '9 albo 14 cyfr', inputMode: 'numeric', maxLength: 17 })}
          </label>

          <label className="block">
            <Label>Numer identyfikacji wewnętrznej KSeF</Label>
            {input('ksef_internal_id', { placeholder: 'np. 5252228219-00145', maxLength: 16 })}
            <span className="mt-1 block text-xs text-gray-500">
              Tylko dla oddziału / jednostki wewnętrznej nabywcy. Szkoła rozliczana na gminę go nie potrzebuje.
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm uppercase tracking-wide text-[#d3bb73]">Adres i kontakt</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block md:col-span-3">
            <Label required>Adres (ulica i numer)</Label>
            {input('address', { placeholder: 'np. ul. Chmielna 85/87', maxLength: 512, autoComplete: 'street-address' })}
          </label>
          <label className="block">
            <Label required>Kod pocztowy</Label>
            {input('postal_code', { placeholder: '00-000', maxLength: 12, autoComplete: 'postal-code' })}
          </label>
          <label className="block">
            <Label required>Miasto</Label>
            {input('city', { placeholder: 'np. Olsztyn', maxLength: 256, autoComplete: 'address-level2' })}
          </label>
          <label className="block">
            <Label>Kraj</Label>
            {input('country', { placeholder: 'Polska', maxLength: 64 })}
          </label>
          <label className="block">
            <Label><Mail className="h-4 w-4" />E-mail</Label>
            {input('email', { type: 'email', placeholder: 'biuro@firma.pl', maxLength: 256, autoComplete: 'email' })}
          </label>
          <label className="block">
            <Label><Phone className="h-4 w-4" />Telefon</Label>
            {input('phone', { type: 'tel', placeholder: '+48 600 000 000', maxLength: 30, autoComplete: 'tel' })}
          </label>
          <label className="block">
            <Label><Globe className="h-4 w-4" />Strona www</Label>
            {input('website', { placeholder: 'firma.pl', maxLength: 512, autoComplete: 'url' })}
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm uppercase tracking-wide text-[#d3bb73]">Ocena i status</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <Label>Ocena</Label>
            <ContactValidationField field="rating" error={errors.rating}>
              <select
                value={values.rating ?? 0}
                disabled={disabled}
                onChange={(event) => onChange('rating', Number(event.target.value) || null)}
                className={organizationInputClassName}
              >
                <option value={0}>Brak oceny</option>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>{'★'.repeat(rating)} ({rating}/5)</option>
                ))}
              </select>
            </ContactValidationField>
          </label>
          <label className="block">
            <Label>Status</Label>
            <ContactValidationField field="status" error={errors.status}>
              <select
                value={values.status || 'active'}
                disabled={disabled}
                onChange={(event) => onChange('status', event.target.value)}
                className={organizationInputClassName}
              >
                {Object.entries(organizationStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </ContactValidationField>
          </label>
        </div>
      </section>
    </div>
  );
}
