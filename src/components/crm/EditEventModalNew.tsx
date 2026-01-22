'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import LocationSelector from './LocationSelector';
import ClientSelectorTabs from './ClientSelectorTabs';
import ParticipantsAutocomplete from './ParticipantsAutocomplete';
import { useEventCategories } from '@/app/(crm)/crm/event-categories/hook/useEventCategories';
import { useDialog } from '@/contexts/DialogContext';
import { ILocation } from '@/app/(crm)/crm/locations/type';
import { useEmployees } from '@/app/(crm)/crm/employees/hooks/useEmployees';
import { useEventTeam } from '@/app/(crm)/crm/events/hooks';

interface EditEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: any;
  location?: ILocation | null;
  onSave: (data: any) => void;
}

const toLocalDatetimeString = (utcDate: string | null): string => {
  if (!utcDate) return '';
  const date = new Date(utcDate);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

export default function EditEventModalNew({
  isOpen,
  onClose,
  event,
  location,
  onSave,
}: EditEventModalProps) {
  const { categories } = useEventCategories();
  const { showAlert } = useDialog();

  const { list: employeesList, loading: employeesLoading } = useEmployees({ activeOnly: true });
  const { employees: eventTeam, addEmployee, isAdding } = useEventTeam(event.id);

  const [quickEmployeeId, setQuickEmployeeId] = useState('');

  const [clientData, setClientData] = useState({
    client_type: event.client_type || 'business',
    organization_id: event.organization_id,
    contact_person_id: event.contact_person_id,
  });

  const [formData, setFormData] = useState({
    name: event.name,
    category_id: event.category_id || '',
    event_date: event.event_date,
    event_end_date: event.event_end_date || '',
    location: event.location || '',
    location_id: event.location_id || null,
    budget: event.budget?.toString() || '',
    status: event.status,
  });

  const availableEmployeesToAssign = useMemo(() => {
    const assignedIds = new Set(
      (eventTeam || []).map((a: any) => a.employee_id ?? a.employee?.id).filter(Boolean),
    );

    return (employeesList || []).filter((emp: any) => {
      if (!emp?.id) return false;
      if (emp.id === event.created_by) return false; // autor
      if (assignedIds.has(emp.id)) return false; // już przypisany
      return true;
    });
  }, [employeesList, eventTeam, event.created_by]);

  const [participants, setParticipants] = useState<any[]>(event.participants || []);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!formData.name.trim()) return showAlert('Nazwa eventu jest wymagana');
    if (!formData.event_date) return showAlert('Data rozpoczęcia jest wymagana');
    if (!formData.location) return showAlert('Lokalizacja jest wymagana');

    const dataToSave = {
      name: formData.name,
      client_type: clientData.client_type,
      organization_id:
        clientData.organization_id && clientData.organization_id.trim() !== ''
          ? clientData.organization_id
          : null,
      contact_person_id:
        clientData.contact_person_id && clientData.contact_person_id.trim() !== ''
          ? clientData.contact_person_id
          : null,
      category_id:
        formData.category_id && formData.category_id.trim() !== '' ? formData.category_id : null,
      event_date: formData.event_date ? new Date(formData.event_date).toISOString() : null,
      event_end_date: formData.event_end_date
        ? new Date(formData.event_end_date).toISOString()
        : null,
      location: formData.location || '',
      location_id: formData.location_id || null,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      status: formData.status,
      participants: participants.length > 0 ? participants : [],
    };

    onSave(dataToSave);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // klik w tło zamyka (klik w kartę nie)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* SCROLL CONTAINER */}
      <div className="h-full w-full overflow-y-auto">
        {/* CENTERING WRAPPER */}
        <div className="flex min-h-full w-full items-start justify-center p-4 sm:p-6">
          {/* MODAL CARD (ma własny scroll) */}
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] shadow-2xl">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0f1119]/95 px-6 py-4 backdrop-blur">
              <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj event</h2>
              <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa eventu *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Nazwa eventu"
                />
              </div>

              <ClientSelectorTabs
                initialClientType={clientData.client_type as 'individual' | 'business'}
                initialOrganizationId={clientData.organization_id}
                initialContactPersonId={clientData.contact_person_id}
                eventId={event.id}
                onChange={(data) => setClientData(data)}
                showEventContactPersons={true}
              />

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
                <select
                  value={formData.category_id}
                  onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="">Wybierz kategorię</option>
                  {categories.map((category: any) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data rozpoczęcia *</label>
                  <input
                    type="datetime-local"
                    value={toLocalDatetimeString(formData.event_date)}
                    onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data zakończenia</label>
                  <input
                    type="datetime-local"
                    value={toLocalDatetimeString(formData.event_end_date)}
                    onChange={(e) => setFormData({ ...formData, event_end_date: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Lokalizacja *</label>
                <LocationSelector
                  value={formData.location}
                  onChange={(value, locationData) =>
                    setFormData({
                      ...formData,
                      location: value,
                      location_id: locationData?.id || null,
                    })
                  }
                  placeholder="Wpisz lub wybierz lokalizację"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Budżet (PLN)</label>
                  <input
                    type="number"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="inquiry">Zapytanie</option>
                    <option value="planning">Planowanie</option>
                    <option value="confirmed">Potwierdzone</option>
                    <option value="in_progress">W trakcie</option>
                    <option value="completed">Zakończone</option>
                    <option value="cancelled">Anulowane</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Uczestnicy</label>
                <ParticipantsAutocomplete
                  value={participants}
                  onChange={setParticipants}
                  eventId={event.id}
                  placeholder="Dodaj uczestników (pracownicy, kontakty lub wpisz nazwę)..."
                />
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Wybierz pracowników, kontakty lub wpisz imię i nazwisko ręcznie
                </p>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="sticky bottom-0 z-10 border-t border-[#d3bb73]/10 bg-[#0f1119]/95 px-6 py-4 backdrop-blur">
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  Zapisz zmiany
                </button>
              </div>
            </div>
          </div>
          {/* /card */}
        </div>
      </div>
    </div>
  );
}
