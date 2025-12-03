'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import LocationSelector from './LocationSelector';
import ClientSelectorTabs from './ClientSelectorTabs';

interface EditEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: any;
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
  onSave,
}: EditEventModalProps) {
  const [categories, setCategories] = useState<any[]>([]);
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
    location: event.location,
    location_id: event.location_id || null,
    budget: event.budget?.toString() || '',
    status: event.status,
  });

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
    }
  }, [isOpen]);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('event_categories')
      .select('id, name, color')
      .eq('is_active', true)
      .order('name');
    if (data) setCategories(data);
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
    if (!formData.location.trim()) {
      alert('Lokalizacja jest wymagana');
      return;
    }

    const dataToSave = {
      name: formData.name,
      client_type: clientData.client_type,
      organization_id: clientData.organization_id || null,
      contact_person_id: clientData.contact_person_id || null,
      category_id: formData.category_id || null,
      event_date: formData.event_date ? new Date(formData.event_date).toISOString() : null,
      event_end_date: formData.event_end_date ? new Date(formData.event_end_date).toISOString() : null,
      location: formData.location,
      location_id: formData.location_id || null,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      status: formData.status,
    };
    onSave(dataToSave);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-3xl w-full my-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj event</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa eventu *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              placeholder="Nazwa eventu"
            />
          </div>

          {/* Wybór klienta - Individual lub Business */}
          <ClientSelectorTabs
            initialClientType={clientData.client_type as 'individual' | 'business'}
            initialOrganizationId={clientData.organization_id}
            initialContactPersonId={clientData.contact_person_id}
            eventId={event.id}
            onChange={(data) => setClientData(data)}
            showEventContactPersons={true}
          />

          {/* Kategoria */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Kategoria
            </label>
            <select
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz kategorię</option>
              {categories.map((category: any) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Data rozpoczęcia *
              </label>
              <input
                type="datetime-local"
                value={toLocalDatetimeString(formData.event_date)}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Data zakończenia
              </label>
              <input
                type="datetime-local"
                value={toLocalDatetimeString(formData.event_end_date)}
                onChange={(e) => setFormData({ ...formData, event_end_date: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Lokalizacja *
            </label>
            <LocationSelector
              value={formData.location_id}
              onChange={(locationId, locationName) => {
                setFormData({
                  ...formData,
                  location_id: locationId,
                  location: locationName,
                });
              }}
              placeholder="Wpisz lub wybierz lokalizację"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Budżet (PLN)
              </label>
              <input
                type="number"
                value={formData.budget}
                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                placeholder="0.00"
                step="0.01"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
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

          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
            >
              Anuluj
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
            >
              Zapisz zmiany
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
