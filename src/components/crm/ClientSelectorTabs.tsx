'use client';

import { useState, useEffect } from 'react';
import { User, Building2, Plus, X, Trash2, Briefcase } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface ClientSelectorTabsProps {
  initialClientType: 'individual' | 'business';
  initialOrganizationId: string | null;
  initialContactPersonId: string | null;
  eventId?: string; // Optional - dla event_contact_persons
  onChange: (data: {
    client_type: 'individual' | 'business';
    organization_id: string | null;
    contact_person_id: string | null;
  }) => void;
  showEventContactPersons?: boolean; // Czy pokazywać listę osób dla eventu
}

interface Contact {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  position?: string;
  contact_type: string;
}

interface Organization {
  id: string;
  name: string;
  alias: string | null;
}

interface EventContactPerson {
  id: string;
  contact_id: string;
  is_primary: boolean;
  role: string;
  notes: string;
  contact?: Contact;
}

export default function ClientSelectorTabs({
  initialClientType,
  initialOrganizationId,
  initialContactPersonId,
  eventId,
  onChange,
  showEventContactPersons = false,
}: ClientSelectorTabsProps) {
  const { showSnackbar } = useSnackbar();
  const [activeTab, setActiveTab] = useState<'individual' | 'business'>(initialClientType);

  // Individual
  const [individualContactId, setIndividualContactId] = useState(
    initialClientType === 'individual' ? initialContactPersonId : ''
  );
  const [individualContacts, setIndividualContacts] = useState<Contact[]>([]);
  const [showNewIndividualForm, setShowNewIndividualForm] = useState(false);
  const [newIndividualData, setNewIndividualData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });

  // Business
  const [organizationId, setOrganizationId] = useState(
    initialClientType === 'business' ? initialOrganizationId : ''
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [businessContacts, setBusinessContacts] = useState<Contact[]>([]);
  const [eventContactPersons, setEventContactPersons] = useState<EventContactPerson[]>([]);
  const [showNewBusinessContactForm, setShowNewBusinessContactForm] = useState(false);
  const [newBusinessContactData, setNewBusinessContactData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    position: '',
    role: '',
  });

  useEffect(() => {
    fetchOrganizations();
    fetchIndividualContacts();
  }, []);

  useEffect(() => {
    if (organizationId) {
      fetchBusinessContacts();
    }
  }, [organizationId]);

  useEffect(() => {
    if (showEventContactPersons && eventId && activeTab === 'business') {
      fetchEventContactPersons();
    }
  }, [activeTab, eventId, showEventContactPersons]);

  useEffect(() => {
    // Notify parent of changes
    if (activeTab === 'individual') {
      onChange({
        client_type: 'individual',
        organization_id: null,
        contact_person_id: individualContactId || null,
      });
    } else {
      const primaryContact = eventContactPersons.find(p => p.is_primary);
      onChange({
        client_type: 'business',
        organization_id: organizationId && organizationId.trim() !== '' ? organizationId : null,
        contact_person_id: primaryContact?.contact_id && primaryContact.contact_id.trim() !== '' ? primaryContact.contact_id : null,
      });
    }
  }, [activeTab, individualContactId, organizationId, eventContactPersons]);

  const fetchOrganizations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, alias')
      .eq('organization_type', 'client')
      .order('name');
    if (data) setOrganizations(data);
  };

  const fetchIndividualContacts = async () => {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('contact_type', 'individual')
      .order('full_name');
    if (data) setIndividualContacts(data);
  };

  const fetchBusinessContacts = async () => {
    if (!organizationId) return;

    const { data } = await supabase
      .from('contacts')
      .select(`
        *,
        contact_organizations!inner(organization_id)
      `)
      .eq('contact_organizations.organization_id', organizationId)
      .eq('contact_type', 'contact')
      .order('full_name');

    if (data) setBusinessContacts(data);
  };

  const fetchEventContactPersons = async () => {
    if (!eventId) return;

    const { data } = await supabase
      .from('event_contact_persons')
      .select(`
        *,
        contact:contacts(*)
      `)
      .eq('event_id', eventId);

    if (data) setEventContactPersons(data as any);
  };

  const handleCreateIndividual = async () => {
    if (!newIndividualData.first_name || !newIndividualData.last_name) {
      showSnackbar('Imię i nazwisko są wymagane', 'error');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contacts')
        .insert([{
          first_name: newIndividualData.first_name,
          last_name: newIndividualData.last_name,
          full_name: `${newIndividualData.first_name} ${newIndividualData.last_name}`,
          email: newIndividualData.email,
          phone: newIndividualData.phone,
          contact_type: 'individual',
        }])
        .select()
        .single();

      if (error) throw error;

      setIndividualContacts(prev => [...prev, data]);
      setIndividualContactId(data.id);
      setShowNewIndividualForm(false);
      setNewIndividualData({ first_name: '', last_name: '', email: '', phone: '' });
      showSnackbar('Klient dodany', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania klienta', 'error');
    }
  };

  const handleCreateBusinessContact = async () => {
    if (!organizationId) {
      showSnackbar('Wybierz najpierw organizację', 'error');
      return;
    }
    if (!newBusinessContactData.first_name || !newBusinessContactData.last_name) {
      showSnackbar('Imię i nazwisko są wymagane', 'error');
      return;
    }

    try {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert([{
          first_name: newBusinessContactData.first_name,
          last_name: newBusinessContactData.last_name,
          full_name: `${newBusinessContactData.first_name} ${newBusinessContactData.last_name}`,
          email: newBusinessContactData.email,
          phone: newBusinessContactData.phone,
          position: newBusinessContactData.position,
          contact_type: 'contact',
        }])
        .select()
        .single();

      if (contactError) throw contactError;

      const { error: orgError } = await supabase
        .from('contact_organizations')
        .insert([{
          contact_id: contact.id,
          organization_id: organizationId,
        }]);

      if (orgError) throw orgError;

      if (showEventContactPersons && eventId) {
        const { error: eventError } = await supabase
          .from('event_contact_persons')
          .insert([{
            event_id: eventId,
            contact_id: contact.id,
            role: newBusinessContactData.role,
            is_primary: eventContactPersons.length === 0,
          }]);

        if (eventError) throw eventError;
        await fetchEventContactPersons();
      }

      await fetchBusinessContacts();
      setShowNewBusinessContactForm(false);
      setNewBusinessContactData({ first_name: '', last_name: '', email: '', phone: '', position: '', role: '' });
      showSnackbar('Osoba kontaktowa dodana', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania osoby', 'error');
    }
  };

  const handleAddExistingContact = async (contactId: string) => {
    if (!eventId || !showEventContactPersons) return;

    try {
      const { error } = await supabase
        .from('event_contact_persons')
        .insert([{
          event_id: eventId,
          contact_id: contactId,
          is_primary: eventContactPersons.length === 0,
        }]);

      if (error) throw error;

      await fetchEventContactPersons();
      showSnackbar('Osoba dodana do eventu', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania osoby', 'error');
    }
  };

  const handleRemoveContactPerson = async (id: string) => {
    if (!eventId || !showEventContactPersons) return;

    try {
      const { error } = await supabase
        .from('event_contact_persons')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchEventContactPersons();
      showSnackbar('Osoba usunięta', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas usuwania osoby', 'error');
    }
  };

  const handleSetPrimary = async (id: string) => {
    if (!eventId || !showEventContactPersons) return;

    try {
      await supabase
        .from('event_contact_persons')
        .update({ is_primary: false })
        .eq('event_id', eventId);

      const { error } = await supabase
        .from('event_contact_persons')
        .update({ is_primary: true })
        .eq('id', id);

      if (error) throw error;

      await fetchEventContactPersons();
      showSnackbar('Główna osoba kontaktowa ustawiona', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Taby */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('individual')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'individual'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/10'
          }`}
        >
          <User className="w-4 h-4" />
          Impreza indywidualna
        </button>
        <button
          onClick={() => setActiveTab('business')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'business'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/10'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Business
        </button>
      </div>

      {activeTab === 'individual' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Osoba kontaktowa / Klient indywidualny *
            </label>
            <select
              value={individualContactId || ''}
              onChange={(e) => {
                setIndividualContactId(e.target.value);
                setShowNewIndividualForm(false);
              }}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz klienta</option>
              {individualContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name} {contact.email ? `(${contact.email})` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowNewIndividualForm(!showNewIndividualForm)}
            className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
          >
            <Plus className="w-4 h-4" />
            {showNewIndividualForm ? 'Anuluj' : 'Dodaj nowego klienta'}
          </button>

          {showNewIndividualForm && (
            <div className="bg-[#0f1119] rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Imię *"
                  value={newIndividualData.first_name}
                  onChange={(e) => setNewIndividualData({ ...newIndividualData, first_name: e.target.value })}
                  className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                />
                <input
                  type="text"
                  placeholder="Nazwisko *"
                  value={newIndividualData.last_name}
                  onChange={(e) => setNewIndividualData({ ...newIndividualData, last_name: e.target.value })}
                  className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={newIndividualData.email}
                onChange={(e) => setNewIndividualData({ ...newIndividualData, email: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
              />
              <input
                type="tel"
                placeholder="Telefon"
                value={newIndividualData.phone}
                onChange={(e) => setNewIndividualData({ ...newIndividualData, phone: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
              />
              <button
                onClick={handleCreateIndividual}
                className="w-full bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
              >
                Dodaj klienta
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Organizacja (Firma) *
            </label>
            <select
              value={organizationId || ''}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            >
              <option value="">Wybierz organizację</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.alias || org.name}
                </option>
              ))}
            </select>
          </div>

          {organizationId && showEventContactPersons && eventId && (
            <>
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <h3 className="text-lg font-light text-[#e5e4e2] mb-3">Osoby kontaktowe</h3>

                {eventContactPersons.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {eventContactPersons.map((person) => (
                      <div
                        key={person.id}
                        className="bg-[#0f1119] rounded-lg p-3 flex items-center justify-between"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[#e5e4e2]">{person.contact?.full_name}</span>
                            {person.is_primary && (
                              <span className="text-xs bg-[#d3bb73]/20 text-[#d3bb73] px-2 py-0.5 rounded">
                                Główna
                              </span>
                            )}
                          </div>
                          {person.contact?.position && (
                            <div className="flex items-center gap-1 text-sm text-[#e5e4e2]/60 mt-1">
                              <Briefcase className="w-3 h-3" />
                              {person.contact.position}
                            </div>
                          )}
                          {person.role && (
                            <div className="text-xs text-[#e5e4e2]/40 mt-1">
                              Rola: {person.role}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!person.is_primary && (
                            <button
                              onClick={() => handleSetPrimary(person.id)}
                              className="text-xs text-[#d3bb73] hover:underline"
                            >
                              Ustaw główną
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveContactPerson(person.id)}
                            className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#e5e4e2]/40 mb-4">
                    Brak przypisanych osób kontaktowych
                  </p>
                )}

                <button
                  onClick={() => setShowNewBusinessContactForm(!showNewBusinessContactForm)}
                  className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm mb-4"
                >
                  <Plus className="w-4 h-4" />
                  {showNewBusinessContactForm ? 'Anuluj' : 'Dodaj nową osobę'}
                </button>

                {showNewBusinessContactForm && (
                  <div className="bg-[#0f1119] rounded-lg p-4 space-y-3 mb-4">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Imię *"
                        value={newBusinessContactData.first_name}
                        onChange={(e) => setNewBusinessContactData({ ...newBusinessContactData, first_name: e.target.value })}
                        className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Nazwisko *"
                        value={newBusinessContactData.last_name}
                        onChange={(e) => setNewBusinessContactData({ ...newBusinessContactData, last_name: e.target.value })}
                        className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Stanowisko (np. Dyrektor)"
                      value={newBusinessContactData.position}
                      onChange={(e) => setNewBusinessContactData({ ...newBusinessContactData, position: e.target.value })}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={newBusinessContactData.email}
                      onChange={(e) => setNewBusinessContactData({ ...newBusinessContactData, email: e.target.value })}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                    />
                    <input
                      type="tel"
                      placeholder="Telefon"
                      value={newBusinessContactData.phone}
                      onChange={(e) => setNewBusinessContactData({ ...newBusinessContactData, phone: e.target.value })}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Rola w evencie (np. Decydent)"
                      value={newBusinessContactData.role}
                      onChange={(e) => setNewBusinessContactData({ ...newBusinessContactData, role: e.target.value })}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                    />
                    <button
                      onClick={handleCreateBusinessContact}
                      className="w-full bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
                    >
                      Dodaj osobę
                    </button>
                  </div>
                )}

                {businessContacts.length > 0 && (
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                      Lub dodaj istniejącą osobę z firmy
                    </label>
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          handleAddExistingContact(e.target.value);
                          e.target.value = '';
                        }
                      }}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    >
                      <option value="">Wybierz osobę</option>
                      {businessContacts
                        .filter(c => !eventContactPersons.find(p => p.contact_id === c.id))
                        .map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.full_name} {contact.position ? `(${contact.position})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
