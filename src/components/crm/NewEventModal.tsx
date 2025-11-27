'use client';

import { X, Plus, Building2, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface NewEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (event: any) => void;
  initialDate?: Date;
}

interface Organization {
  id: string;
  name: string;
  alias?: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  organization_id?: string | null;
  contact_type: 'individual' | 'organization_contact';
}

interface EventCategory {
  id: string;
  name: string;
  color: string;
}

export default function NewEventModal({
  isOpen,
  onClose,
  onSave,
  initialDate,
}: NewEventModalProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [showNewOrgForm, setShowNewOrgForm] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [clientType, setClientType] = useState<'organization' | 'individual'>('organization');
  const [contactInputType, setContactInputType] = useState<'select' | 'manual'>('select');
  const [manualContactName, setManualContactName] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    organization_id: '',
    contact_person_id: '',
    category_id: '',
    event_date: initialDate?.toISOString().slice(0, 16) || '',
    event_end_date: '',
    location: '',
    budget: '',
    description: '',
    status: 'inquiry',
  });

  useEffect(() => {
    if (isOpen) {
      fetchOrganizations();
      fetchContacts();
      fetchCategories();
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialDate) {
      setFormData(prev => ({
        ...prev,
        event_date: initialDate.toISOString().slice(0, 16),
      }));
    }
  }, [initialDate]);

  // Filtruj kontakty na podstawie wybranej organizacji
  useEffect(() => {
    if (formData.organization_id) {
      const filtered = contacts.filter(
        c => c.organization_id === formData.organization_id || c.contact_type === 'individual'
      );
      setFilteredContacts(filtered);
    } else {
      setFilteredContacts(contacts);
    }
  }, [formData.organization_id, contacts]);

  const fetchOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, alias')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching organizations:', error);
        return;
      }

      if (data) {
        setOrganizations(data);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, full_name, contact_type')
        .in('contact_type', ['contact', 'individual'])
        .order('full_name', { ascending: true });

      if (error) {
        console.error('Error fetching contacts:', error);
        return;
      }

      if (data) {
        const formattedContacts = data.map(c => ({
          id: c.id,
          full_name: c.full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Brak nazwy',
          organization_id: null,
          contact_type: c.contact_type as 'contact' | 'individual'
        }));
        setContacts(formattedContacts);
        setFilteredContacts(formattedContacts);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('event_categories')
        .select('id, name, color')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching categories:', error);
        return;
      }

      if (data) {
        setCategories(data);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const handleAddNewOrganization = async () => {
    if (!newOrgName.trim()) {
      alert('Wprowadź nazwę organizacji');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('organizations')
        .insert([
          {
            name: newOrgName.trim(),
          },
        ])
        .select();

      if (error) {
        console.error('Error adding organization:', error);
        alert('Błąd podczas dodawania organizacji: ' + error.message);
        return;
      }

      if (data && data[0]) {
        setOrganizations([...organizations, data[0]]);
        setFormData({ ...formData, organization_id: data[0].id });
        setNewOrgName('');
        setShowNewOrgForm(false);
        alert('Organizacja została dodana!');
      }
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas dodawania organizacji');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let contactPersonId = formData.contact_person_id;

    if (contactInputType === 'manual' && manualContactName.trim()) {
      try {
        const nameParts = manualContactName.trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const { data: newContact, error } = await supabase
          .from('contacts')
          .insert([
            {
              first_name: firstName,
              last_name: lastName,
              contact_type: clientType === 'individual' ? 'individual' : 'contact',
            },
          ])
          .select()
          .single();

        if (error) {
          console.error('Error creating contact:', error);
          alert('Błąd podczas tworzenia kontaktu: ' + error.message);
          return;
        }

        if (newContact) {
          contactPersonId = newContact.id;
        }
      } catch (err) {
        console.error('Error:', err);
        alert('Wystąpił błąd podczas tworzenia kontaktu');
        return;
      }
    }

    const eventData = {
      name: formData.name,
      organization_id: clientType === 'organization' ? (formData.organization_id || null) : null,
      contact_person_id: contactPersonId || null,
      category_id: formData.category_id || null,
      event_date: formData.event_date,
      event_end_date: formData.event_end_date || null,
      location: formData.location || null,
      budget: formData.budget ? parseFloat(formData.budget) : null,
      description: formData.description || null,
      status: formData.status,
    };

    onSave(eventData);

    setFormData({
      name: '',
      organization_id: '',
      contact_person_id: '',
      category_id: '',
      event_date: '',
      event_end_date: '',
      location: '',
      budget: '',
      description: '',
      status: 'inquiry',
    });
    setClientType('organization');
    setContactInputType('select');
    setManualContactName('');

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/10 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-light text-[#e5e4e2]">Nowe wydarzenie</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/70 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Nazwa wydarzenia *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Konferencja Tech Summit 2025"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Typ klienta
              </label>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setClientType('organization');
                    setFormData({ ...formData, organization_id: '', contact_person_id: '' });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                    clientType === 'organization'
                      ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                      : 'bg-[#0f1119] border-[#d3bb73]/10 text-[#e5e4e2]/70 hover:border-[#d3bb73]/30'
                  }`}
                >
                  <Building2 className="w-4 h-4 inline mr-2" />
                  Organizacja / Firma
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClientType('individual');
                    setFormData({ ...formData, organization_id: '', contact_person_id: '' });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                    clientType === 'individual'
                      ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                      : 'bg-[#0f1119] border-[#d3bb73]/10 text-[#e5e4e2]/70 hover:border-[#d3bb73]/30'
                  }`}
                >
                  <User className="w-4 h-4 inline mr-2" />
                  Klient indywidualny
                </button>
              </div>

              {clientType === 'organization' && (
                <>
                  <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                    <Building2 className="w-4 h-4 inline mr-1" />
                    Organizacja / Firma
                  </label>

                  {!showNewOrgForm ? (
                    <div className="flex gap-2">
                      <select
                        value={formData.organization_id}
                        onChange={(e) =>
                          setFormData({ ...formData, organization_id: e.target.value, contact_person_id: '' })
                        }
                        className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                      >
                        <option value="">Wybierz organizację</option>
                        {organizations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.alias || org.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowNewOrgForm(true)}
                        className="px-4 py-2 bg-[#d3bb73]/10 hover:bg-[#d3bb73]/20 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Nowa
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newOrgName}
                          onChange={(e) => setNewOrgName(e.target.value)}
                          placeholder="Nazwa organizacji"
                          className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                        />
                        <button
                          type="button"
                          onClick={handleAddNewOrganization}
                          className="px-4 py-2 bg-[#d3bb73] hover:bg-[#d3bb73]/80 text-[#0f1119] rounded-lg transition-colors"
                        >
                          Dodaj
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewOrgForm(false);
                            setNewOrgName('');
                          }}
                          className="px-4 py-2 bg-[#e5e4e2]/10 hover:bg-[#e5e4e2]/20 text-[#e5e4e2] rounded-lg transition-colors"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                <User className="w-4 h-4 inline mr-1" />
                Osoba kontaktowa
              </label>

              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setContactInputType('select');
                    setManualContactName('');
                  }}
                  className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    contactInputType === 'select'
                      ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                      : 'bg-[#0f1119] border-[#d3bb73]/10 text-[#e5e4e2]/70 hover:border-[#d3bb73]/30'
                  }`}
                >
                  Wybierz z bazy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContactInputType('manual');
                    setFormData({ ...formData, contact_person_id: '' });
                  }}
                  className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    contactInputType === 'manual'
                      ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                      : 'bg-[#0f1119] border-[#d3bb73]/10 text-[#e5e4e2]/70 hover:border-[#d3bb73]/30'
                  }`}
                >
                  Wpisz ręcznie
                </button>
              </div>

              {contactInputType === 'select' ? (
                <>
                  <select
                    value={formData.contact_person_id}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_person_id: e.target.value })
                    }
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="">Wybierz osobę kontaktową</option>
                    {filteredContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name}
                        {contact.contact_type === 'individual' ? ' (Prywatny)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    {clientType === 'organization' && formData.organization_id
                      ? 'Wyświetlane są osoby z wybranej organizacji'
                      : 'Wybierz organizację aby zawęzić listę kontaktów'}
                  </p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={manualContactName}
                    onChange={(e) => setManualContactName(e.target.value)}
                    placeholder="np. Jan Kowalski"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Kontakt zostanie automatycznie dodany do bazy
                  </p>
                </>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Kategoria
              </label>
              <select
                value={formData.category_id}
                onChange={(e) =>
                  setFormData({ ...formData, category_id: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              >
                <option value="">Wybierz kategorię</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                  Data rozpoczęcia *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.event_date}
                  onChange={(e) =>
                    setFormData({ ...formData, event_date: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                  Data zakończenia
                </label>
                <input
                  type="datetime-local"
                  value={formData.event_end_date}
                  onChange={(e) =>
                    setFormData({ ...formData, event_end_date: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Lokalizacja
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Centrum Konferencyjne, Warszawa"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Budżet (PLN)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.budget}
                onChange={(e) =>
                  setFormData({ ...formData, budget: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              >
                <option value="inquiry">Zapytanie</option>
                <option value="offer_to_send">Oferta do wysłania</option>
                <option value="offer_sent">Oferta wysłana</option>
                <option value="offer_accepted">Oferta zaakceptowana</option>
                <option value="in_preparation">W przygotowaniu</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończone</option>
                <option value="cancelled">Anulowane</option>
                <option value="invoiced">Rozliczone</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Opis
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={4}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30 resize-none"
                placeholder="Dodatkowe informacje o wydarzeniu..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#d3bb73]/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[#e5e4e2]/70 hover:text-[#e5e4e2] transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-[#d3bb73] hover:bg-[#d3bb73]/80 text-[#0f1119] rounded-lg transition-colors font-medium"
            >
              Utwórz wydarzenie
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
