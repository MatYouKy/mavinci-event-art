import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X } from 'lucide-react';

import LocationSelector from '@/components/crm/LocationSelector';
import { IEvent } from '../../../type';

export function EditEventModal({
  isOpen,
  onClose,
  event,
  onSave,
  organizations,
  contacts,
}: {
  isOpen: boolean;
  onClose: () => void;
  event: IEvent;
  onSave: (data: any) => void;
  organizations: any[];
  contacts: any[];
}) {
  const [categories, setCategories] = useState<any[]>([]);
  const [clientData, setClientData] = useState({
    client_type: event.client_type || 'business' as 'business' | 'individual',
    organization_id: event.organization_id || null,
    contact_person_id: event.contact_person_id || null,
  });
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientData, setNewClientData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });
  const [sameAsOrganization, setSameAsOrganization] = useState(false);
  const [formData, setFormData] = useState({
    name: event.name || '',
    category_id: event.category_id || null,
    event_date: event.event_date || null,
    event_end_date: event.event_end_date || null,
    location: event.location || '',
    location_id: event.location_id || null,
    budget: event.budget?.toString() || '',
    status: event.status || '',
  });

  const handleContactChange = (value: string) => {
    setClientData({ ...clientData, contact_person_id: value });
    if (value === 'NEW_CLIENT') {
      setShowNewClientForm(true);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
    }
  }, [isOpen]);

  const handleSameAsOrganization = (value: boolean) => {
    setSameAsOrganization(value);
    if (value) {
      setClientData({ ...clientData, contact_person_id: clientData.organization_id });
    }
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('event_categories')
      .select('id, name, color')
      .eq('is_active', true)
      .order('name');
    if (data) setCategories(data);
  };

  const handleCreateNewClient = async () => {
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        first_name: newClientData.first_name,
        last_name: newClientData.last_name,
        email: newClientData.email,
        phone: newClientData.phone,
        contact_type: 'individual',
      })
      .select('*')
      .single();
    if (data) {
      setClientData({ ...clientData, contact_person_id: data.id });
      setShowNewClientForm(false);
    }
  };

  const toLocalDatetimeString = (utcDate: string | null): string => {
    if (!utcDate) return '';
    const date = new Date(utcDate);
    return date.toISOString().slice(0, 16);
  };

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      alert('Nazwa eventu jest wymagana');
      return;
    }
    if (!formData.event_date) {
      alert('Data rozpoczęcia jest wymagana');
      return;
    }

    const dataToSave = {
      name: formData.name,
      client_type: clientData.client_type,
      organization_id: clientData.organization_id && clientData.organization_id.trim() !== '' ? clientData.organization_id : null,
      contact_person_id: clientData.contact_person_id || null,
      category_id: formData.category_id || null,
      event_date: formData.event_date ? new Date(formData.event_date).toISOString() : null,
      event_end_date: formData.event_end_date
        ? new Date(formData.event_end_date).toISOString()
        : null,
      location: formData.location,
      location_id: formData.location_id || null,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      status: formData.status,
    };
    onSave(dataToSave);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj event</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Organizacja (Firma)</label>
              <select
                value={clientData.organization_id}
                onChange={(e) => setClientData({ ...clientData, organization_id: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz organizację</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.alias || org.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Osoba kontaktowa / Klient indywidualny
              </label>
              <select
                value={showNewClientForm ? 'NEW_CLIENT' : clientData.contact_person_id}
                onChange={(e) => handleContactChange(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz osobę</option>
                <option value="NEW_CLIENT" className="font-medium text-[#d3bb73]">
                  + Nowy klient jednorazowy
                </option>
                {contacts.map((contact) => {
                  const displayName =
                    contact.full_name ||
                    `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
                  const suffix =
                    contact.contact_type === 'individual'
                      ? ' (Klient indywidualny)'
                      : contact.organization_name
                        ? ` (${contact.organization_name})`
                        : '';
                  return (
                    <option key={contact.id} value={contact.id}>
                      {displayName}
                      {suffix}
                    </option>
                  );
                })}
              </select>
              {clientData.organization_id && !showNewClientForm && (
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sameAsOrganization}
                    onChange={(e) => handleSameAsOrganization(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
                  />
                  <span className="text-sm text-[#e5e4e2]/60">
                    Osoba kontaktowa z wybranej firmy
                  </span>
                </label>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz kategorię</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Formularz nowego klienta */}
          {showNewClientForm && (
            <div className="space-y-3 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-[#e5e4e2]">Nowy klient jednorazowy</h3>
                <button
                  onClick={() => {
                    setShowNewClientForm(false);
                    setNewClientData({ first_name: '', last_name: '', email: '', phone: '' });
                  }}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Imię *</label>
                  <input
                    type="text"
                    value={newClientData.first_name}
                    onChange={(e) =>
                      setNewClientData({ ...newClientData, first_name: e.target.value })
                    }
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Jan"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Nazwisko *</label>
                  <input
                    type="text"
                    value={newClientData.last_name}
                    onChange={(e) =>
                      setNewClientData({ ...newClientData, last_name: e.target.value })
                    }
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Kowalski"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Email</label>
                  <input
                    type="email"
                    value={newClientData.email}
                    onChange={(e) => setNewClientData({ ...newClientData, email: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="jan@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Telefon</label>
                  <input
                    type="tel"
                    value={newClientData.phone}
                    onChange={(e) => setNewClientData({ ...newClientData, phone: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="+48 123 456 789"
                  />
                </div>
              </div>
              <button
                onClick={handleCreateNewClient}
                className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Dodaj klienta
              </button>
            </div>
          )}

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
              value={formData.location as unknown as string}
              onChange={(value, locationData) =>
                setFormData({
                  ...formData,
                  location: value,
                  location_id: locationData?.id || null,
                })
              }
              placeholder="Wybierz z listy lub wyszukaj nową lokalizację..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Budżet (PLN)</label>
              <input
                type="number"
                step="0.01"
                value={formData.budget}
                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="offer_sent">Oferta wysłana</option>
                <option value="offer_accepted">Oferta zaakceptowana</option>
                <option value="in_preparation">W przygotowaniu</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończony</option>
                <option value="cancelled">Anulowany</option>
                <option value="invoiced">Rozliczony</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 border-t border-[#d3bb73]/10 pt-6">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Zapisz zmiany
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
