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
  User,
  UserCheck,
} from 'lucide-react';
import React, { FC, useState } from 'react';
import { useRouter } from 'next/navigation';
import EditEventClientModal from '@/components/crm/EditEventClientModal';
import { supabase } from '@/lib/supabase';
import { logChange } from '../../../helpers/logChange';
import { EventDestailsDescription } from './EventDetailsDescription';
import { EventDetailsNotes } from './EventDetailsNotes';
import { useEvent } from '@/app/crm/events/hooks/useEvent';

interface EventsDetailsTabProps {
  hasLimitedAccess: boolean;
  canManageTeam: boolean;
  isUserAdmin: boolean;
}

export const EventsDetailsTab: FC<EventsDetailsTabProps> = ({
  hasLimitedAccess,
  canManageTeam,
  isUserAdmin,
}) => {
  const { event, updateEvent } = useEvent();
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const router = useRouter();

  const handleUpdateDescription = async (description: string) => {
    try {
      await updateEvent({ description });
    } catch (err) {
      console.error('Error updating description:', err);
    }
  };

  const handleUpdateNotes = async (notes: string) => {
    try {
      await updateEvent({ notes });
    } catch (err) {
      console.error('Error updating notes:', err);
    }
  };

  console.log('event.location_details', event.location_details);
  console.log('event.location', event.location);

  return (
    <>
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>
        <div className="space-y-4">
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
              {event.location_details ? (
                <div className="group relative inline-block">
                  <button
                    onClick={() =>
                      event.location_details?.id &&
                      router.push(`/crm/locations/${event.location_details.id}`)
                    }
                    className="text-left text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
                  >
                    {event.location_details.name}
                  </button>
                  <div className="invisible absolute left-0 top-full z-50 mt-1 min-w-[300px] max-w-md rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33] p-4 shadow-xl before:absolute before:-top-1 before:left-0 before:right-0 before:h-1 before:content-[''] group-hover:visible">
                    <p className="mb-2 text-sm font-medium text-[#e5e4e2]">
                      {event.location_details.name}
                    </p>
                    {event.location_details.formatted_address && (
                      <p className="mb-3 text-xs text-[#e5e4e2]/60">
                        {event.location_details.formatted_address}
                      </p>
                    )}
                    {event.location_details.google_maps_url && (
                      <a
                        href={event.location_details.google_maps_url}
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
                <p className="text-[#e5e4e2]">{event.location || 'Brak lokalizacji'}</p>
              )}
            </div>
          </div>
{/* 
          {!hasLimitedAccess && (canManageTeam || isUserAdmin) && (
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
          )} */}

          {/* Ukryj klienta dla użytkowników z ograniczonym dostępem */}
          {!hasLimitedAccess && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[#e5e4e2]">Informacje o kliencie</h3>
                <button
                  onClick={() => setShowEditClientModal(true)}
                  className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  <EditIcon className="h-3 w-3" />
                  Edytuj
                </button>
              </div>
              {event.client_type === 'business' ? (
                <>
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Klient (Firma)</p>
                      <p className="text-[#e5e4e2]">
                        {event.organization
                          ? event.organization.alias || event.organization.name
                          : 'Brak klienta'}
                      </p>
                    </div>
                  </div>
                  {event.contact_person && (
                    <div className="flex items-start gap-3">
                      <User className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                      <div>
                        <p className="text-sm text-[#e5e4e2]/60">Osoba kontaktowa</p>
                        <p className="text-[#e5e4e2]">
                          {event.contact_person.full_name ||
                            `${event.contact_person.first_name} ${event.contact_person.last_name}`}
                        </p>
                        {event.contact_person.email && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Mail className="h-3 w-3" />
                            <span>{event.contact_person.email}</span>
                          </div>
                        )}
                        {event.contact_person.phone && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Phone className="h-3 w-3" />
                            <span>{event.contact_person.phone}</span>
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
                    {event.contact_person ? (
                      <>
                        <p className="text-[#e5e4e2]">
                          {event.contact_person.full_name ||
                            `${event.contact_person.first_name} ${event.contact_person.last_name}`}
                        </p>
                        {event.contact_person.email && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Mail className="h-3 w-3" />
                            <span>{event.contact_person.email}</span>
                          </div>
                        )}
                        {event.contact_person.phone && (
                          <div className="mt-1 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                            <Phone className="h-3 w-3" />
                            <span>{event.contact_person.phone}</span>
                          </div>
                        )}
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
            currentOrganizationId={event.organization_id}
            currentContactPersonId={event.contact_person_id}
            onSuccess={() => {
              setShowEditClientModal(false);
            }}
          />
        )}
      </div>
      <EventDestailsDescription
        handleSaveDescription={handleUpdateDescription}
        eventDescription={event.description}
        hasLimitedAccess={hasLimitedAccess}
      />
      <EventDetailsNotes eventDetailsNotes={event.notes} handleUpdateNotes={handleUpdateNotes} />
    </>
  );
};
