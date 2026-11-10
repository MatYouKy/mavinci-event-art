'use client';

import SystemBadge from '@/components/UI/SystemBadge';

import OrganizationLocationPicker from '@/components/crm/contacts/organization/OrganizationLocationPicker';
import OrganizationRepresentatives from '@/components/crm/contacts/organization/OrganizationRepresentatives';
import type { OrganizationFormErrors, OrganizationFormValues } from './organizationValidation';
import { legalFormLabels } from '@/utils/labels/legalFormLabels';
import { requiresKrsForLegalForm } from '@/lib/organizations/organizationLegalForm';
import type { GUSCompanyData } from '@/lib/gus';
import OrganizationFormFields, { organizationBusinessTypeLabels } from './OrganizationFormFields';
import OrganizationInvoiceBuyerSection from './OrganizationInvoiceBuyerSection';

type BusinessType = 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';
type OrganizationType = 'client' | 'subcontractor';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  position: string | null;
  email: string | null;
  phone: string | null;
}

interface DecisionMaker {
  id: string;
  organization_id: string;
  contact_id: string;
  title: string | null;
  can_sign_contracts: boolean;
  notes: string | null;
  created_at: string;
  contact?: any;
}

interface Organization {
  id: string;
  organization_type: OrganizationType;
  business_type: BusinessType;
  name: string;
  alias: string | null;
  nip: string | null;
  legal_form: string | null;
  krs: string | null;
  regon: string | null;
  ksef_internal_id?: string | null;
  invoice_buyer_organization_id?: string | null;
  invoice_recipient_role?: 2 | 8 | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  rating: number | null;
  location_id: string | null;
  primary_contact_id: string | null;
  legal_representative_id: string | null;
  legal_representative_title: string | null;
  contact_is_representative: boolean;
  representation_type: 'sole' | 'joint' | 'joint_with_proxy' | 'proxy' | 'other' | null;
  representation_rule: string | null;
  representation_basis: string | null;
  representation_verified_at: string | null;
}

const renderRating = (rating: number | null) => {
  if (!rating) return <span className="text-gray-400">Brak oceny</span>;

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: rating }, (_, i) => (
        <span key={i} className="text-yellow-400">
          ⭐
        </span>
      ))}
      <span className="ml-2 text-gray-400">({rating}/5)</span>
    </div>
  );
};

interface OrganizationDetailsSectionProps {
  organization: Organization;
  editedData: Partial<Organization>;
  setEditedData: React.Dispatch<React.SetStateAction<Partial<Organization>>>;
  editMode: boolean;
  formErrors: OrganizationFormErrors;
  setFormErrors: React.Dispatch<React.SetStateAction<OrganizationFormErrors>>;
  loadingGUS: boolean;
  registryLookup: GUSCompanyData | null;
  handleFetchFromGUS: () => void;
  onOpenAddLocation?: () => void;
  onOpenHotelSpaces?: () => void;
  onStartEdit?: () => void;
  onOpenContacts?: () => void;
  primaryContact: any;
  legalRepresentative: any;
  decisionMakers: DecisionMaker[];
  contactPersons: Contact[];
  onRepresentativesUpdate: () => void;
}


export default function OrganizationDetailsSection({
  organization,
  editedData,
  setEditedData,
  editMode,
  formErrors,
  setFormErrors,
  loadingGUS,
  registryLookup,
  handleFetchFromGUS,
  onOpenAddLocation,
  onOpenHotelSpaces,
  onStartEdit,
  onOpenContacts,
  primaryContact,
  legalRepresentative,
  decisionMakers,
  contactPersons,
  onRepresentativesUpdate,
}: OrganizationDetailsSectionProps) {
  const currentLegalForm = editedData.legal_form ?? organization.legal_form ?? '';
  const isHotel = (editMode ? editedData.business_type ?? organization.business_type : organization.business_type) === 'hotel';
  const legalFormRequiresKrs = requiresKrsForLegalForm(currentLegalForm);
  const updateField = <K extends keyof Organization>(field: K, value: Organization[K]) => {
    setEditedData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (formErrors[field as keyof OrganizationFormErrors]) {
      setFormErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  };

  const formValues = { ...organization, ...editedData } as OrganizationFormValues;
  const viewRow = (label: string, value: React.ReactNode, wide = false) => (
    <div className={wide ? 'md:col-span-2' : ''}>
      <p className="mb-1 text-sm font-medium text-gray-400">{label}</p>
      <div className="break-words text-white">{value || '—'}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-[#1a1d2e] p-6">
        <h2 className="mb-4 text-lg uppercase text-white">Informacje podstawowe</h2>

        {editMode ? (
          <OrganizationFormFields
            values={formValues}
            errors={formErrors}
            onChange={(field, value) => updateField(field as keyof Organization, value as never)}
            onFetchRegistry={handleFetchFromGUS}
            loadingRegistry={loadingGUS}
            registryLookup={registryLookup}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {viewRow('Nazwa pełna', organization.name, true)}
            {viewRow('Alias (krótka nazwa)', organization.alias)}
            {viewRow('NIP', organization.nip)}
            {viewRow('Profil działalności', organizationBusinessTypeLabels[organization.business_type] || organization.business_type)}
            {viewRow('Forma prawna / typ podmiotu', organization.legal_form
              ? legalFormLabels[organization.legal_form as keyof typeof legalFormLabels] || organization.legal_form
              : null)}
            {legalFormRequiresKrs && viewRow('KRS', organization.krs)}
            {viewRow('REGON', organization.regon)}
            {viewRow('Numer identyfikacji wewnętrznej KSeF', organization.ksef_internal_id)}
            {viewRow('Adres', [organization.address, [organization.postal_code, organization.city].filter(Boolean).join(' '), organization.country]
              .filter(Boolean).join(', '), true)}
            {viewRow('E-mail', organization.email)}
            {viewRow('Telefon', organization.phone)}
            {viewRow('Strona www', organization.website ? (
              <a href={organization.website} target="_blank" rel="noopener noreferrer" className="text-[#d3bb73] hover:underline">
                {organization.website}
              </a>
            ) : null)}
            {viewRow('Ocena', renderRating(organization.rating))}
            {viewRow('Status', <SystemBadge value={organization.status} />)}
          </div>
        )}
      </div>

      <OrganizationInvoiceBuyerSection
        organizationId={organization.id}
        editMode={editMode}
        errors={formErrors}
        invoice_buyer_organization_id={(editMode
          ? editedData.invoice_buyer_organization_id
          : organization.invoice_buyer_organization_id) ?? null}
        invoice_recipient_role={(editMode
          ? editedData.invoice_recipient_role
          : organization.invoice_recipient_role) ?? null}
        onChange={(value) => {
          updateField('invoice_buyer_organization_id', value.invoice_buyer_organization_id);
          updateField('invoice_recipient_role', value.invoice_recipient_role);
        }}
      />

      <div className="rounded-lg bg-[#1a1d2e] p-6">
        <h2 className="mb-3 text-lg uppercase">{isHotel ? 'Lokalizacja hotelu i przestrzenie' : 'Powiązana lokalizacja'}</h2>
        <OrganizationLocationPicker
          organizationId={organization.id}
          registryPeople={registryLookup?.representatives}
          onStartEdit={onStartEdit}
          onOpenContacts={onOpenContacts}
          currentLocationId={editMode && editedData.location_id !== undefined ? editedData.location_id : organization.location_id}
          onLocationChange={(locationId) => updateField('location_id', locationId)}
          editMode={editMode}
          onOpenAddLocation={onOpenAddLocation}
          required={isHotel}
          error={formErrors.location_id}
        />
        {isHotel && !editMode && <div className="mt-3 space-y-2 text-sm">
          <p className="text-white/60">Sale, wymiary, zasilanie, rzuty i zdjęcia pochodzą z powiązanej lokalizacji. Zmiany są wspólne dla CRM i portalu sprzedawcy.</p>
          {onOpenHotelSpaces && <button type="button" onClick={onOpenHotelSpaces} className="rounded-lg bg-white/5 px-4 py-2 text-[#d3bb73] hover:bg-white/10">Sale i przestrzenie hotelu →</button>}
        </div>}
      </div>

      <div className="rounded-lg bg-[#1a1d2e] p-6">
        <h2 className="mb-4 text-lg uppercase text-white">Reprezentanci i osoby decyzyjne</h2>

        <OrganizationRepresentatives
          organizationId={organization.id}
          primaryContact={primaryContact}
          legalRepresentative={legalRepresentative}
          editedPrimaryContactId={
            editedData.primary_contact_id ?? organization.primary_contact_id ?? null
          }
          editedLegalRepresentativeId={
            editedData.legal_representative_id ?? organization.legal_representative_id ?? null
          }
          legalRepresentativeTitle={
            editedData.legal_representative_title || organization.legal_representative_title
          }
          contactIsRepresentative={
            editedData.contact_is_representative !== undefined
              ? editedData.contact_is_representative
              : organization.contact_is_representative
          }
          representationType={
            editedData.representation_type ?? organization.representation_type ?? null
          }
          representationRule={
            editedData.representation_rule ?? organization.representation_rule ?? null
          }
          representationBasis={
            editedData.representation_basis ?? organization.representation_basis ?? null
          }
          representationVerifiedAt={
            editedData.representation_verified_at ??
            organization.representation_verified_at ??
            null
          }
          legalForm={currentLegalForm}
          decisionMakers={decisionMakers}
          availableContacts={contactPersons.map((cp) => ({
            id: cp.id,
            full_name: cp.full_name || `${cp.first_name} ${cp.last_name}`,
            first_name: cp.first_name,
            last_name: cp.last_name,
            email: cp.email,
            phone: cp.phone,
            position: cp.position,
          }))}
          editMode={editMode}
          onUpdate={onRepresentativesUpdate}
          onEditedDataChange={(field, value) =>
            setEditedData((prev) => ({
              ...prev,
              [field]: value,
            }))
          }
        />
      </div>
    </div>
  );
}
