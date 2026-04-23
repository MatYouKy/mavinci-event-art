'use client';

import { Mail, Phone, Globe, Search, Loader2 } from 'lucide-react';
import OrganizationLocationPicker from '@/components/crm/contacts/organization/OrganizationLocationPicker';
import OrganizationRepresentatives from '@/components/crm/contacts/organization/OrganizationRepresentatives';
import type { OrganizationFormErrors } from './organizationValidation';
import { getOrganizationInputClassName } from './organizationForm.helpers';

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
}

const legalFormLabels = {
  jdg: 'Jednoosobowa działalność gospodarcza (JDG)',
  sp_zoo: 'Spółka z ograniczoną odpowiedzialnością (sp. z o.o.)',
  sp_jawna: 'Spółka jawna',
  sp_komandytowa: 'Spółka komandytowa',
  sp_komandytowo_akcyjna: 'Spółka komandytowo-akcyjna',
  sp_akcyjna: 'Spółka akcyjna (S.A.)',
  spoldzielnia: 'Spółdzielnia',
  fundacja: 'Fundacja',
  stowarzyszenie: 'Stowarzyszenie',
  other: 'Inna',
};

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
  handleFetchFromGUS: () => void;
  onOpenAddLocation: () => void;
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
  handleFetchFromGUS,
  onOpenAddLocation,
  primaryContact,
  legalRepresentative,
  decisionMakers,
  contactPersons,
  onRepresentativesUpdate,
}: OrganizationDetailsSectionProps) {
  const renderFieldError = (field: keyof OrganizationFormErrors) => {
    if (!formErrors[field]) return null;
    return <p className="mt-1 text-sm text-red-400">{formErrors[field]}</p>;
  };

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

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-700 bg-[#1a1d2e] p-6">
        <h2 className="mb-4 text-xl font-semibold text-white">Informacje podstawowe</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Nazwa pełna *</label>
            {editMode ? (
              <>
                <input
                  type="text"
                  value={editedData.name || ''}
                  onChange={(e) => updateField('name', e.target.value)}
                  className={getOrganizationInputClassName(formErrors, 'name')}
                />
                {renderFieldError('name')}
              </>
            ) : (
              <p className="text-white">{organization.name}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">
              Alias (krótka nazwa)
            </label>
            {editMode ? (
              <input
                type="text"
                value={editedData.alias || ''}
                onChange={(e) => updateField('alias', e.target.value)}
                className={getOrganizationInputClassName(formErrors)}
                placeholder="np. OMEGA HOTEL"
              />
            ) : (
              <p className="text-white">{organization.alias || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">NIP *</label>
            {editMode ? (
              <>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={editedData.nip || ''}
                    onChange={(e) => updateField('nip', e.target.value)}
                    className={getOrganizationInputClassName(formErrors, 'nip')}
                  />
                  <button
                    type="button"
                    onClick={handleFetchFromGUS}
                    disabled={loadingGUS}
                    className="flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859] disabled:opacity-50"
                  >
                    {loadingGUS ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Search className="h-5 w-5" />
                    )}
                    <span>GUS</span>
                  </button>
                </div>
                {renderFieldError('nip')}
              </>
            ) : (
              <p className="text-white">{organization.nip || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Forma prawna</label>
            {editMode ? (
              <select
                value={editedData.legal_form || ''}
                onChange={(e) => updateField('legal_form', e.target.value)}
                className={getOrganizationInputClassName(formErrors)}
              >
                <option value="">-- Wybierz formę prawną --</option>
                {Object.entries(legalFormLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-white">
                {organization.legal_form
                  ? legalFormLabels[organization.legal_form as keyof typeof legalFormLabels] ||
                    organization.legal_form
                  : '-'}
              </p>
            )}
          </div>

          {(!editMode || (editedData.legal_form || organization.legal_form) !== 'jdg') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-400">KRS</label>
              {editMode ? (
                <input
                  type="text"
                  value={editedData.krs || ''}
                  onChange={(e) => updateField('krs', e.target.value)}
                  disabled={(editedData.legal_form || organization.legal_form) === 'jdg'}
                  className={`${getOrganizationInputClassName(formErrors)} disabled:opacity-50`}
                />
              ) : (
                <p className="text-white">{organization.krs || '-'}</p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">REGON</label>
            {editMode ? (
              <input
                type="text"
                value={editedData.regon || ''}
                onChange={(e) => updateField('regon', e.target.value)}
                className={getOrganizationInputClassName(formErrors)}
              />
            ) : (
              <p className="text-white">{organization.regon || '-'}</p>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-400">Adres (ulica) *</label>
            {editMode ? (
              <>
                <input
                  type="text"
                  value={editedData.address || ''}
                  onChange={(e) => updateField('address', e.target.value)}
                  className={getOrganizationInputClassName(formErrors, 'address')}
                  placeholder="np. ul. Chmielna 85/87"
                />
                {renderFieldError('address')}
              </>
            ) : (
              <p className="text-white">{organization.address || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Kod pocztowy *</label>
            {editMode ? (
              <>
                <input
                  type="text"
                  value={editedData.postal_code || ''}
                  onChange={(e) => updateField('postal_code', e.target.value)}
                  className={getOrganizationInputClassName(formErrors, 'postal_code')}
                  placeholder="00-000"
                />
                {renderFieldError('postal_code')}
              </>
            ) : (
              <p className="text-white">{organization.postal_code || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Miasto *</label>
            {editMode ? (
              <>
                <input
                  type="text"
                  value={editedData.city || ''}
                  onChange={(e) => updateField('city', e.target.value)}
                  className={getOrganizationInputClassName(formErrors, 'city')}
                  placeholder="np. Warszawa"
                />
                {renderFieldError('city')}
              </>
            ) : (
              <p className="text-white">{organization.city || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 flex items-center space-x-1 text-sm font-medium text-gray-400">
              <Mail className="h-4 w-4" />
              <span>Email</span>
            </label>
            {editMode ? (
              <>
                <input
                  type="email"
                  value={editedData.email || ''}
                  onChange={(e) => updateField('email', e.target.value)}
                  className={getOrganizationInputClassName(formErrors, 'email')}
                />
                {renderFieldError('email')}
              </>
            ) : (
              <p className="text-white">{organization.email || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 flex items-center space-x-1 text-sm font-medium text-gray-400">
              <Phone className="h-4 w-4" />
              <span>Telefon</span>
            </label>
            {editMode ? (
              <input
                type="tel"
                value={editedData.phone || ''}
                onChange={(e) => updateField('phone', e.target.value)}
                className={getOrganizationInputClassName(formErrors)}
              />
            ) : (
              <p className="text-white">{organization.phone || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-1 flex items-center space-x-1 text-sm font-medium text-gray-400">
              <Globe className="h-4 w-4" />
              <span>Strona www</span>
            </label>
            {editMode ? (
              <>
                <input
                  type="url"
                  value={editedData.website || ''}
                  onChange={(e) => updateField('website', e.target.value)}
                  className={getOrganizationInputClassName(formErrors, 'website')}
                />
                {renderFieldError('website')}
              </>
            ) : organization.website ? (
              <a
                href={organization.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#d3bb73] hover:underline"
              >
                {organization.website}
              </a>
            ) : (
              <p className="text-white">-</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Ocena</label>
            {editMode ? (
              <select
                value={editedData.rating ?? 0}
                onChange={(e) => updateField('rating', Number(e.target.value) || null)}
                className={getOrganizationInputClassName(formErrors)}
              >
                <option value="0">Brak oceny</option>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r} ⭐
                  </option>
                ))}
              </select>
            ) : (
              <div>{renderRating(organization.rating)}</div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-400">Status</label>
            {editMode ? (
              <select
                value={editedData.status || 'active'}
                onChange={(e) => updateField('status', e.target.value)}
                className={getOrganizationInputClassName(formErrors)}
              >
                <option value="active">Aktywny</option>
                <option value="inactive">Nieaktywny</option>
                <option value="potential">Potencjalny</option>
                <option value="archived">Zarchiwizowany</option>
              </select>
            ) : (
              <p className="text-white">{organization.status}</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-[#1a1d2e] p-6">
        <OrganizationLocationPicker
          organizationId={organization.id}
          currentLocationId={organization.location_id}
          onLocationChange={(locationId) => updateField('location_id', locationId)}
          editMode={editMode}
          onOpenAddLocation={onOpenAddLocation}
        />
      </div>

      <div className="rounded-lg border border-gray-700 bg-[#1a1d2e] p-6">
        <h2 className="mb-4 text-xl font-semibold text-white">Reprezentanci i osoby decyzyjne</h2>

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
