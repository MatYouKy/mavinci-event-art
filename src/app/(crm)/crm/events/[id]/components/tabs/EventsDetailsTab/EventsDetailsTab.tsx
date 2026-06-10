import {
  Building2,
  Calendar,
  Clock,
  Edit,
  EditIcon,
  Mail,
  MapPin,
  Phone,
  Save,
  Tag,
  User,
  UserCheck,
} from 'lucide-react';
import React, { FC, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EditEventClientModal from '@/components/crm/EditEventClientModal';

import { logChange } from '../../../helpers/logChange';
import { EventDestailsDescription } from './EventDetailsDescription';
import { EventDetailsNotes } from './EventDetailsNotes';
import { useEvent } from '@/app/(crm)/crm/events/hooks/useEvent';
import { ContactRow, OrganizationRow } from '@/app/(crm)/crm/contacts/types';
import { ISimpleContact, ISimpleLocation } from '../../../EventDetailPageClient';
import { IEvent } from '../../../../type';
import Image from 'next/image';
import { EditRealizationCompanyModal } from './EditRealizationCompanyModal';
import { supabase } from '@/lib/supabase/browser';

interface EventsDetailsTabProps {
  hasLimitedAccess: boolean;
  canManageTeam: boolean;
  isAdmin: boolean;
  isCreator: boolean;
  canEventManage: boolean;
  contact: ISimpleContact | null;
  organization: OrganizationRow | null;
  location: ISimpleLocation | null;
  initialEvent: IEvent;
}

export const EventsDetailsTab: FC<EventsDetailsTabProps> = ({
  hasLimitedAccess,
  contact,
  organization,
  location,
  initialEvent,
  isAdmin,
  canEventManage,
  isCreator,
}) => {
  const { updateEvent, refetch } = useEvent();

  const [event, setEvent] = useState<IEvent>(initialEvent);
  const [realizationCompany, setRealizationCompany] = useState<any>(
    () => (initialEvent as any).my_company ?? null,
  );
  const [showEditCompanyModal, setShowEditCompanyModal] = useState(false);

  useEffect(() => {
    setEvent(initialEvent);

    const initialCompany = (initialEvent as any).my_company;

    if (initialCompany) {
      setRealizationCompany(initialCompany);
    }
  }, [initialEvent]);

  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const router = useRouter();
  const canSeeFullDetails = isAdmin || isCreator || !hasLimitedAccess;
  const canEditEventDetails = isAdmin || isCreator || canEventManage;

  const handleUpdateDescription = async (description: string) => {
    // optimistic UI
    setEvent((prev) => ({ ...prev, description }));

    try {
      await updateEvent({ description });
      await refetch(); // opcjonalnie, jak chcesz dociągnąć całość z bazy
    } catch (err) {
      console.error('Error updating description:', err);
      // opcjonalnie rollback:
      // setEvent(initialEvent);
    }
  };

  const handleUpdateNotes = async (notes: string) => {
    setEvent((prev) => ({ ...prev, notes }));

    try {
      await updateEvent({ notes });
      await refetch();
    } catch (err) {
      console.error('Error updating notes:', err);
    }
  };

  const handleChangeRealizationCompany = async (companyId: string) => {
    const { error } = await supabase
      .from('events')
      .update({ my_company_id: companyId })
      .eq('id', event.id);

    if (error) {
      console.error('Error updating realization company:', error);
      return;
    }

    setEvent((prev) => ({
      ...prev,
      my_company_id: companyId,
    }));

    setShowEditCompanyModal(false);
    await refetch();
  };

  useEffect(() => {
    const loadRealizationCompany = async () => {
      if (!event.my_company_id) {
        setRealizationCompany(null);
        return;
      }

      const { data: companyData, error: companyError } = await supabase
        .from('my_companies')
        .select('*')
        .eq('id', event.my_company_id)
        .maybeSingle();

      if (companyError) {
        console.error('Error loading realization company:', companyError);
        return;
      }

      const { data: brandLogo, error: brandLogoError } = await supabase
        .from('company_brandbook_logos')
        .select('url')
        .eq('company_id', event.my_company_id)
        .eq('label', 'signature')
        .maybeSingle();

      if (brandLogoError) {
        console.error('Error loading brandbook logo:', brandLogoError);
      }

      const logoPath = brandLogo?.url || companyData?.logo_url || null;

      const resolvedLogoUrl =
        logoPath && !/^https?:\/\//i.test(logoPath) && !logoPath.startsWith('data:')
          ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${logoPath}`
          : logoPath;

      setRealizationCompany({
        ...companyData,
        logo_url: resolvedLogoUrl,
      });
    };

    loadRealizationCompany();
  }, [event.my_company_id]);

  return (
    <>
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm text-[#e5e4e2]/60">Firma realizująca</p>

                {canEditEventDetails && (
                  <button
                    onClick={() => setShowEditCompanyModal(true)}
                    className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <EditIcon className="h-3 w-3" />
                    Edytuj
                  </button>
                )}
              </div>

              <div className="mt-1 flex items-center gap-3">
                {realizationCompany?.logo_url && (
                  <Image
                    width={32}
                    height={32}
                    src={realizationCompany.logo_url}
                    alt={realizationCompany.name || 'Logo'}
                    className="h-8 w-8 shrink-0 object-contain"
                  />
                )}

                <div className="min-w-0">
                  <p className="text-[#e5e4e2]">
                    {realizationCompany?.legal_name ||
                      realizationCompany?.name ||
                      'Brak przypisanej firmy'}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
            <div>
              <p className="text-sm text-[#e5e4e2]/60">Data rozpoczęcia</p>
              <p className="text-[#e5e4e2]">
                {new Date(event.event_date).toLocaleString('pl-PL', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </p>
            </div>
          </div>

          {event.event_end_date && (
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div>
                <p className="text-sm text-[#e5e4e2]/60">Data zakończenia</p>
                <p className="text-[#e5e4e2]">
                  {new Date(event.event_end_date).toLocaleString('pl-PL', {
                    dateStyle: 'full',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
            <div className="flex-1">
              <p className="text-sm text-[#e5e4e2]/60">Lokalizacja</p>
              {location?.name ? (
                <div className="group relative inline-block">
                  <button
                    onClick={() => location.id && router.push(`/crm/locations/${location.id}`)}
                    className="text-left text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
                  >
                    {location.name}
                  </button>
                  <div className="invisible absolute left-0 top-full z-50 mt-1 min-w-[300px] max-w-md rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33] p-4 shadow-xl before:absolute before:-top-1 before:left-0 before:right-0 before:h-1 before:content-[''] group-hover:visible">
                    <p className="mb-2 text-sm font-medium text-[#e5e4e2]">{location.name}</p>
                    {location.formatted_address && (
                      <p className="mb-3 text-xs text-[#e5e4e2]/60">{location.formatted_address}</p>
                    )}
                    {location.google_maps_url && location.google_maps_url !== '' && (
                      <a
                        href={location.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"
                      >
                        Zobacz na mapie
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[#e5e4e2]">Brak lokalizacji</p>
              )}
            </div>
          </div>

          {/* {!hasLimitedAccess && (canManageTeam || isUserAdmin) && (
            <div className="flex items-start gap-3">
              <UserCheck className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
              <div className="flex-1">
                <label className="group flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={event.requires_subcontractors}
                    onChange={async (e) => {
                      const newValue = e.target.checked;
                      try {
                        const { error } = await supabase
                          .from('events')
                          .update({ requires_subcontractors: newValue })
                          .eq('id', event.id);

                        if (error) throw error;

                        // setEvent({ ...event, requires_subcontractors: newValue });
                        // setHasSubcontractors(newValue);

                        await logChange(
                          event.id,
                          'updated',
                          newValue
                            ? 'Włączono zapotrzebowanie na podwykonawców'
                            : 'Wyłączono zapotrzebowanie na podwykonawców',
                          'requires_subcontractors',
                          String(!newValue),
                          String(newValue),
                        );
                      } catch (err) {
                        console.error('Error updating requires_subcontractors:', err);
                        alert('Błąd podczas aktualizacji');
                      }
                    }}
                    className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0"
                  />
                  <div>
                    <p className="text-sm text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                      Wymaga podwykonawców
                    </p>
                    <p className="text-xs text-[#e5e4e2]/60">
                      Pokaż zakładkę "Podwykonawcy" w tym wydarzeniu
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}  */}

          {/* Ukryj klienta dla użytkowników z ograniczonym dostępem */}
          {canSeeFullDetails && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-[#e5e4e2]">Informacje o kliencie</h3>

                {canEventManage && (
                  <button
                    onClick={() => setShowEditClientModal(true)}
                    className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <EditIcon className="h-3 w-3" />
                    Edytuj
                  </button>
                )}
              </div>
              {event.client_type === 'business' ? (
                <>
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          organization?.id && router.push(`/crm/contacts/${organization.id}`)
                        }
                        className="text-left text-[#e5e4e2] hover:text-[#d3bb73]"
                      >
                        {organization ? organization.alias || organization.name : 'Brak klienta'}
                      </button>

                      {organization?.email && (
                        <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                          <Mail className="h-3 w-3" />
                          <a
                            href={`mailto:${organization.email}`}
                            className="text-[#e5e4e2] hover:text-[#d3bb73]"
                          >
                            {organization.email}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                  {contact && (
                    <div className="flex items-start gap-3">
                      <User className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                      <div>
                        <p className="text-sm text-[#e5e4e2]/60">Osoba kontaktowa</p>
                        <p className="text-[#e5e4e2]">
                          <a
                            href={`/crm/contacts/${contact.id}`}
                            className="text-[#e5e4e2] hover:text-[#d3bb73]"
                          >
                            {contact.full_name || `${contact.first_name} ${contact.last_name}`}
                          </a>
                        </p>
                        {contact.email && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Mail className="h-3 w-3" />
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-[#e5e4e2] hover:text-[#d3bb73]"
                            >
                              {contact.email}
                            </a>
                          </div>
                        )}
                        {(contact.business_phone || contact.phone) && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Phone className="h-3 w-3" />
                            <a
                              href={`tel:${contact.business_phone || contact.phone}`}
                              className="text-[#e5e4e2] hover:text-[#d3bb73]"
                            >
                              {contact.business_phone || contact.phone}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <User className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                    {contact ? (
                      <>
                        <p className="text-[#e5e4e2]">
                          <a
                            href={`/crm/contacts/${contact.id}`}
                            className="text-[#e5e4e2] hover:text-[#d3bb73]"
                          >
                            {contact.full_name || `${contact.first_name} ${contact.last_name}`}
                          </a>
                        </p>
                        {contact.email && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Mail className="h-3 w-3" />
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-[#e5e4e2] hover:text-[#d3bb73]"
                            >
                              {contact.email}
                            </a>
                          </div>
                        )}
                        {contact.business_phone ||
                          (contact.phone && (
                            <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                              <Phone className="h-3 w-3" />
                              <a
                                href={`tel:${contact.business_phone || contact.phone}`}
                                className="text-[#e5e4e2] hover:text-[#d3bb73]"
                              >
                                {contact.business_phone || contact.phone}
                              </a>
                            </div>
                          ))}
                      </>
                    ) : (
                      <p className="text-[#e5e4e2]">Brak klienta</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {showEditClientModal && event && (
          <EditEventClientModal
            isOpen={showEditClientModal}
            onClose={() => setShowEditClientModal(false)}
            eventId={event.id}
            currentClientType={(event as any).client_type || 'business'}
            currentOrganizationId={event.organization_id || ''}
            currentContactPersonId={event.contact_person_id || ''}
            onSuccess={async () => {
              setShowEditClientModal(false);

              const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('id', event.id)
                .single();

              if (!error && data) setEvent(data as IEvent);
            }}
          />
        )}
      </div>
      {showEditCompanyModal && (
        <EditRealizationCompanyModal
          currentCompanyId={event.my_company_id}
          onClose={() => setShowEditCompanyModal(false)}
          onSave={handleChangeRealizationCompany}
        />
      )}
      <EventDestailsDescription
        eventId={event.id}
        handleSaveDescription={handleUpdateDescription}
        eventDescription={event.description || ''}
        hasLimitedAccess={hasLimitedAccess}
        // onSaved={async () => {
        //   await refetch();
        // }}
      />
      <EventDetailsNotes
        eventDetailsNotes={event.notes || ''}
        handleUpdateNotes={handleUpdateNotes}
      />
    </>
  );
};
