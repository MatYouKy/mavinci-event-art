'use client';

import { useState, useEffect } from 'react';
import { X, User, Building2, Plus, Trash2, Briefcase } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface EditEventClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  currentClientType: 'individual' | 'business';
  currentOrganizationId: string | null;
  currentContactPersonId: string | null;
  onSuccess: () => void;
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

export default function EditEventClientModal({
  isOpen,
  onClose,
  eventId,
  currentClientType,
  currentOrganizationId,
  currentContactPersonId,
  onSuccess,
}: EditEventClientModalProps) {
  const { showSnackbar } = useSnackbar();
  const [activeTab, setActiveTab] = useState<'individual' | 'business'>(currentClientType);
  const [loading, setLoading] = useState(false);

  // Individual
  const [individualContactId, setIndividualContactId] = useState(
    currentClientType === 'individual' ? currentContactPersonId : '',
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
    currentClientType === 'business' ? currentOrganizationId : '',
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
    if (isOpen) {
      fetchOrganizations();
      fetchIndividualContacts();
      if (activeTab === 'business' && eventId) {
        fetchEventContactPersons();
      }
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (organizationId) {
      fetchBusinessContacts();
    }
  }, [organizationId]);

  const fetchOrganizations = async () => {
    const { data } = await supabase.from('organizations').select('id, name, alias').order('name');
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

    const { data, error } = await supabase
      .from('contact_organizations')
      .select(
        `
        contact_id,
        contacts (
          id,
          full_name,
          first_name,
          last_name,
          email,
          phone,
          position,
          contact_type
        )
      `,
      )
      .eq('organization_id', organizationId);

    if (error) {
      console.error('Error fetching business contacts:', error);
      return;
    }

    if (data) {
      const contacts = data
        .map((item: any) => item.contacts)
        .filter((c: any) => c && c.contact_type === 'contact');
      setBusinessContacts(contacts);
    }
  };

  const fetchEventContactPersons = async () => {
    const { data } = await supabase
      .from('event_contact_persons')
      .select(
        `
        *,
        contact:contacts(*)
      `,
      )
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
        .insert([
          {
            first_name: newIndividualData.first_name,
            last_name: newIndividualData.last_name,
            email: newIndividualData.email,
            phone: newIndividualData.phone,
            contact_type: 'individual',
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setIndividualContacts((prev) => [...prev, data]);
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
      // Utwórz kontakt
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert([
          {
            first_name: newBusinessContactData.first_name,
            last_name: newBusinessContactData.last_name,
            email: newBusinessContactData.email,
            phone: newBusinessContactData.phone,
            position: newBusinessContactData.position,
            contact_type: 'contact',
          },
        ])
        .select()
        .single();

      if (contactError) throw contactError;

      // Przypisz do organizacji
      const { error: orgError } = await supabase.from('contact_organizations').insert([
        {
          contact_id: contact.id,
          organization_id: organizationId,
        },
      ]);

      if (orgError) throw orgError;

      // Dodaj do event_contact_persons
      const { error: eventError } = await supabase.from('event_contact_persons').insert([
        {
          event_id: eventId,
          contact_id: contact.id,
          role: newBusinessContactData.role,
          is_primary: eventContactPersons.length === 0,
        },
      ]);

      if (eventError) throw eventError;

      await fetchBusinessContacts();
      await fetchEventContactPersons();
      setShowNewBusinessContactForm(false);
      setNewBusinessContactData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        position: '',
        role: '',
      });
      showSnackbar('Osoba kontaktowa dodana', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania osoby', 'error');
    }
  };

  const handleAddExistingContact = async (contactId: string) => {
    try {
      const { error } = await supabase.from('event_contact_persons').insert([
        {
          event_id: eventId,
          contact_id: contactId,
          is_primary: eventContactPersons.length === 0,
        },
      ]);

      if (error) throw error;

      await fetchEventContactPersons();
      showSnackbar('Osoba dodana do eventu', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas dodawania osoby', 'error');
    }
  };

  const handleRemoveContactPerson = async (id: string) => {
    try {
      const { error } = await supabase.from('event_contact_persons').delete().eq('id', id);

      if (error) throw error;

      await fetchEventContactPersons();
      showSnackbar('Osoba usunięta', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas usuwania osoby', 'error');
    }
  };

  const handleSetPrimary = async (id: string) => {
    try {
      // Usuń is_primary z wszystkich
      await supabase
        .from('event_contact_persons')
        .update({ is_primary: false })
        .eq('event_id', eventId);

      // Ustaw is_primary dla wybranej osoby
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

  const handleSave = async () => {
    setLoading(true);
    try {
      if (activeTab === 'individual') {
        if (!individualContactId) {
          showSnackbar('Wybierz osobę kontaktową', 'error');
          setLoading(false);
          return;
        }

        const { error } = await supabase
          .from('events')
          .update({
            client_type: 'individual',
            organization_id: null,
            contact_person_id: individualContactId,
          })
          .eq('id', eventId);

        if (error) throw error;

        // Usuń wszystkie event_contact_persons
        await supabase.from('event_contact_persons').delete().eq('event_id', eventId);
      } else {
        // Business
        if (!organizationId) {
          showSnackbar('Wybierz organizację', 'error');
          setLoading(false);
          return;
        }

        if (eventContactPersons.length === 0) {
          showSnackbar('Dodaj przynajmniej jedną osobę kontaktową', 'error');
          setLoading(false);
          return;
        }

        const primaryContact = eventContactPersons.find((p) => p.is_primary);

        const { error } = await supabase
          .from('events')
          .update({
            client_type: 'business',
            organization_id: organizationId,
            contact_person_id: primaryContact?.contact_id || null,
          })
          .eq('id', eventId);

        if (error) throw error;
      }

      showSnackbar('Klient zapisany', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas zapisywania', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-light text-[#e5e4e2]">Edytuj klienta</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <X className="h-5 w-5 text-[#e5e4e2]" />
            </button>
          </div>

          {/* Taby */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('individual')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                activeTab === 'individual'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
            >
              <User className="h-4 w-4" />
              Impreza indywidualna
            </button>
            <button
              onClick={() => setActiveTab('business')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                activeTab === 'business'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Business
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'individual' ? (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Osoba kontaktowa / Klient indywidualny
                </label>
                <select
                  value={individualContactId || ''}
                  onChange={(e) => {
                    setIndividualContactId(e.target.value);
                    setShowNewIndividualForm(false);
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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
                className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
              >
                <Plus className="h-4 w-4" />
                {showNewIndividualForm ? 'Anuluj' : 'Dodaj nowego klienta'}
              </button>

              {showNewIndividualForm && (
                <div className="space-y-3 rounded-lg bg-[#0f1119] p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Imię *"
                      value={newIndividualData.first_name}
                      onChange={(e) =>
                        setNewIndividualData({ ...newIndividualData, first_name: e.target.value })
                      }
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                    <input
                      type="text"
                      placeholder="Nazwisko *"
                      value={newIndividualData.last_name}
                      onChange={(e) =>
                        setNewIndividualData({ ...newIndividualData, last_name: e.target.value })
                      }
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                  </div>
                  <input
                    type="email"
                    placeholder="Email"
                    value={newIndividualData.email}
                    onChange={(e) =>
                      setNewIndividualData({ ...newIndividualData, email: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                  />
                  <input
                    type="tel"
                    placeholder="Telefon"
                    value={newIndividualData.phone}
                    onChange={(e) =>
                      setNewIndividualData({ ...newIndividualData, phone: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                  />
                  <button
                    onClick={handleCreateIndividual}
                    className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                  >
                    Dodaj klienta
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Organizacja (Firma) *
                </label>
                <select
                  value={organizationId || ''}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="">Wybierz organizację</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.alias || org.name}
                    </option>
                  ))}
                </select>
              </div>

              {organizationId && (
                <>
                  <div className="border-t border-[#d3bb73]/10 pt-4">
                    <h3 className="mb-3 text-lg font-light text-[#e5e4e2]">Osoby kontaktowe</h3>

                    {eventContactPersons.length > 0 ? (
                      <div className="mb-4 space-y-2">
                        {eventContactPersons.map((person) => (
                          <div
                            key={person.id}
                            className="flex items-center justify-between rounded-lg bg-[#0f1119] p-3"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[#e5e4e2]">{person.contact?.full_name}</span>
                                {person.is_primary && (
                                  <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                    Główna
                                  </span>
                                )}
                              </div>
                              {person.contact?.position && (
                                <div className="mt-1 flex items-center gap-1 text-sm text-[#e5e4e2]/60">
                                  <Briefcase className="h-3 w-3" />
                                  {person.contact.position}
                                </div>
                              )}
                              {person.role && (
                                <div className="mt-1 text-xs text-[#e5e4e2]/40">
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
                                className="rounded p-1 text-red-400 hover:bg-red-400/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mb-4 text-sm text-[#e5e4e2]/40">
                        Brak przypisanych osób kontaktowych
                      </p>
                    )}

                    <button
                      onClick={() => setShowNewBusinessContactForm(!showNewBusinessContactForm)}
                      className="mb-4 flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                    >
                      <Plus className="h-4 w-4" />
                      {showNewBusinessContactForm ? 'Anuluj' : 'Dodaj nową osobę'}
                    </button>

                    {showNewBusinessContactForm && (
                      <div className="mb-4 space-y-3 rounded-lg bg-[#0f1119] p-4">
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="text"
                            placeholder="Imię *"
                            value={newBusinessContactData.first_name}
                            onChange={(e) =>
                              setNewBusinessContactData({
                                ...newBusinessContactData,
                                first_name: e.target.value,
                              })
                            }
                            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          />
                          <input
                            type="text"
                            placeholder="Nazwisko *"
                            value={newBusinessContactData.last_name}
                            onChange={(e) =>
                              setNewBusinessContactData({
                                ...newBusinessContactData,
                                last_name: e.target.value,
                              })
                            }
                            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Stanowisko (np. Dyrektor)"
                          value={newBusinessContactData.position}
                          onChange={(e) =>
                            setNewBusinessContactData({
                              ...newBusinessContactData,
                              position: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          value={newBusinessContactData.email}
                          onChange={(e) =>
                            setNewBusinessContactData({
                              ...newBusinessContactData,
                              email: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                        <input
                          type="tel"
                          placeholder="Telefon"
                          value={newBusinessContactData.phone}
                          onChange={(e) =>
                            setNewBusinessContactData({
                              ...newBusinessContactData,
                              phone: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                        <input
                          type="text"
                          placeholder="Rola w evencie (np. Decydent)"
                          value={newBusinessContactData.role}
                          onChange={(e) =>
                            setNewBusinessContactData({
                              ...newBusinessContactData,
                              role: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                        <button
                          onClick={handleCreateBusinessContact}
                          className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                        >
                          Dodaj osobę
                        </button>
                      </div>
                    )}

                    {businessContacts.length > 0 && (
                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                          Lub dodaj istniejącą osobę z firmy
                        </label>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAddExistingContact(e.target.value);
                              e.target.value = '';
                            }
                          }}
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        >
                          <option value="">Wybierz osobę</option>
                          {businessContacts
                            .filter((c) => !eventContactPersons.find((p) => p.contact_id === c.id))
                            .map((contact) => (
                              <option key={contact.id} value={contact.id}>
                                {contact.full_name}{' '}
                                {contact.position ? `(${contact.position})` : ''}
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

        <div className="flex gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
