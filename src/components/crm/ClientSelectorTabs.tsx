'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { User, Building2, Plus, Trash2, Briefcase, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface ClientSelectorTabsProps {
  initialClientType: 'individual' | 'business';
  initialOrganizationId: string | null;
  initialContactPersonId: string | null;
  eventId?: string;
  onChange: (data: {
    client_type: 'individual' | 'business';
    organization_id: string | null;
    contact_person_id: string | null;
  }) => void;
  showEventContactPersons?: boolean;
  initialContact?: Contact;
}

export interface Contact {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  position?: string;
  contact_type: string; // 'individual' | 'contact'
  role?: string;
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

const normalize = (s: string) =>
  (s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const mergeUniqueById = <T extends { id: string }>(a: T[], b: T[]) => {
  const map = new Map<string, T>();
  [...a, ...b].forEach((x) => map.set(x.id, x));
  return Array.from(map.values());
};

export default function ClientSelectorTabs({
  initialClientType,
  initialOrganizationId,
  initialContactPersonId,
  eventId,
  onChange,
  showEventContactPersons = false,
  initialContact,
}: ClientSelectorTabsProps) {
  const { showSnackbar } = useSnackbar();

  const [activeTab, setActiveTab] = useState<'individual' | 'business'>(initialClientType);

  // SEARCH
  const [individualSearch, setIndividualSearch] = useState('');
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [businessSearch, setBusinessSearch] = useState(''); // zostaje tylko do "dodaj istniejącą osobę do eventu" jeśli zechcesz

  // Dropdowny
  const [showIndividualSuggestions, setShowIndividualSuggestions] = useState(false);
  const [showOrganizationSuggestions, setShowOrganizationSuggestions] = useState(false);

  const individualWrapRef = useRef<HTMLDivElement | null>(null);
  const organizationWrapRef = useRef<HTMLDivElement | null>(null);

  // Individual
  const [individualContactId, setIndividualContactId] = useState(
    initialClientType === 'individual'
      ? initialContact?.id || initialContactPersonId || ''
      : '',
  );
  const [individualContacts, setIndividualContacts] = useState<Contact[]>(() => {
    if (initialContact?.id && initialContact.contact_type === 'individual') return [initialContact];
    return [];
  });

  const [showNewIndividualForm, setShowNewIndividualForm] = useState(false);
  const [newIndividualData, setNewIndividualData] = useState({
    first_name: initialContact?.first_name || '',
    last_name: initialContact?.last_name || '',
    email: initialContact?.email || '',
    phone: initialContact?.phone || '',
  });

  // Business
  const [organizationId, setOrganizationId] = useState(
    initialClientType === 'business' ? initialOrganizationId || '' : '',
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [businessContacts, setBusinessContacts] = useState<Contact[]>([]);

  /**
   * ✅ DRAFT: kontaktowa osoba (wybrana) – NIE zapisujemy do bazy
   * To jest jedyne źródło do `contact_person_id` dla business.
   */
  const [selectedBusinessContactId, setSelectedBusinessContactId] = useState<string>(
    initialClientType === 'business' ? initialContactPersonId || '' : '',
  );

  /**
   * ✅ DRAFT: osoby eventowe (jeśli chcesz listę w UI) – nadal pobieramy, ale nie zapisujemy w trakcie edycji.
   * Używamy tego tylko do pokazania i ustawiania "Główna" lokalnie.
   */
  const [eventContactPersons, setEventContactPersons] = useState<EventContactPerson[]>([]);


  const [showNewBusinessContactForm, setShowNewBusinessContactForm] = useState(false);
  const [newBusinessContactData, setNewBusinessContactData] = useState({
    first_name: initialContact?.first_name || '',
    last_name: initialContact?.last_name || '',
    email: initialContact?.email || '',
    phone: initialContact?.phone || '',
    position: initialContact?.position || '',
    role: initialContact?.role || '',
  });

  // ✅ seed z initialContact
  useEffect(() => {
    if (!initialContact?.id) return;

    if (initialContact.contact_type === 'individual') {
      setActiveTab('individual');
      setIndividualContacts((prev) => mergeUniqueById(prev, [initialContact]));
      setIndividualContactId(initialContact.id);
      setIndividualSearch(
        `${initialContact.full_name}${initialContact.email ? ` (${initialContact.email})` : ''}`,
      );

      setNewIndividualData({
        first_name: initialContact.first_name || '',
        last_name: initialContact.last_name || '',
        email: initialContact.email || '',
        phone: initialContact.phone || '',
      });
    }

    if (initialContact.contact_type === 'contact') {
      setNewBusinessContactData({
        first_name: initialContact.first_name || '',
        last_name: initialContact.last_name || '',
        email: initialContact.email || '',
        phone: initialContact.phone || '',
        position: initialContact.position || '',
        role: initialContact.role || '',
      });
    }
  }, [initialContact?.id]);

  // click-outside dla dropdownów
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;

      if (individualWrapRef.current && !individualWrapRef.current.contains(t)) {
        setShowIndividualSuggestions(false);
      }
      if (organizationWrapRef.current && !organizationWrapRef.current.contains(t)) {
        setShowOrganizationSuggestions(false);
      }
    };

    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Fetch organizations
  useEffect(() => {
    fetchOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch individual contacts
  useEffect(() => {
    fetchIndividualContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch business contacts po org + auto-select primary contact dla org
  useEffect(() => {
    if (!organizationId) {
      setBusinessContacts([]);
      setSelectedBusinessContactId('');
      return;
    }

    fetchBusinessContacts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  // Pobieramy event_contact_persons tylko do podglądu (opcjonalnie)
  useEffect(() => {
    if (showEventContactPersons && eventId && activeTab === 'business') {
      fetchEventContactPersons();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, eventId, showEventContactPersons]);

  /**
   * ✅ Notify parent
   * Business: używamy selectedBusinessContactId, a NIE DB insertów.
   */
  useEffect(() => {
    if (activeTab === 'individual') {
      onChange({
        client_type: 'individual',
        organization_id: null,
        contact_person_id: individualContactId || null,
      });
    } else {
      onChange({
        client_type: 'business',
        organization_id: organizationId && organizationId.trim() !== '' ? organizationId : null,
        contact_person_id:
          selectedBusinessContactId && selectedBusinessContactId.trim() !== ''
            ? selectedBusinessContactId
            : null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, individualContactId, organizationId, selectedBusinessContactId]);

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

    if (data) {
      setIndividualContacts((prev) => mergeUniqueById(prev, data as any));
    }
  };

  /**
   * ✅ fetchBusinessContacts(autoPickPrimary)
   * - pobiera osoby kontaktowe firmy
   * - JEŚLI autoPickPrimary: wybiera automatycznie główną (is_primary w contact_organizations)
   *
   * Jeśli nie masz contact_organizations.is_primary -> podmień logikę "pickPrimaryId" na swoją.
   */
  const fetchBusinessContacts = async (autoPickPrimary: boolean) => {
    if (!organizationId) return;

    const { data } = await supabase
      .from('contacts')
      .select(
        `
        *,
        contact_organizations!inner(
          organization_id,
          is_primary
        )
      `,
      )
      .eq('contact_organizations.organization_id', organizationId)
      .eq('contact_type', 'contact')
      .order('full_name');

    const contacts = (data as any as Contact[]) || [];
    setBusinessContacts(contacts);

    if (!autoPickPrimary) return;

    // ✅ auto pick primary contact for this organization
    // Zakładam pole: contact_organizations.is_primary = true
    const pickPrimaryId =
      (contacts as any[]).find((c) => c.contact_organizations?.[0]?.is_primary)?.id ||
      contacts[0]?.id ||
      '';

    // ustaw jako wybraną osobę kontaktową (draft)
    setSelectedBusinessContactId(pickPrimaryId);

    // jeśli pokazujesz listę event_contact_persons, to:
    // - NIE zapisujemy do bazy
    // - tylko lokalnie ustawimy, że primary = pickPrimaryId (jeżeli w ogóle chcesz to widzieć w UI)
    if (showEventContactPersons) {
      setEventContactPersons((prev) => {
        // jeśli event już miał osoby — nie nadpisuj bez sensu,
        // ale jeśli lista jest pusta, to wypełnij draftem z primary z organizacji
        if (prev.length > 0) return prev;

        if (!pickPrimaryId) return prev;

        return [
          {
            id: `draft-${pickPrimaryId}`,
            contact_id: pickPrimaryId,
            is_primary: true,
            role: '',
            notes: '',
            contact: contacts.find((c) => c.id === pickPrimaryId),
          } as any,
        ];
      });
    }
  };

  const fetchEventContactPersons = async () => {
    if (!eventId) return;

    const { data } = await supabase
      .from('event_contact_persons')
      .select(
        `
        *,
        contact:contacts(*)
      `,
      )
      .eq('event_id', eventId);

    if (data) {
      setEventContactPersons(data as any);

      // ✅ jeśli event ma już primary kontakt, ustaw go w draft selection
      const primary = (data as any[]).find((p) => p.is_primary);
      if (primary?.contact_id) setSelectedBusinessContactId(primary.contact_id);
    }
  };

  /**
   * ❌ UWAGA: poniższe 3 funkcje PRZESTAJĄ pisać do bazy
   * Zmieniamy je na "draft only"
   */

  const handleAddExistingContact = async (contactId: string) => {
    // DRAFT ONLY: dodaj lokalnie (bez insert)
    const contact = businessContacts.find((c) => c.id === contactId);

    setEventContactPersons((prev) => {
      const exists = prev.find((p) => p.contact_id === contactId);
      if (exists) return prev;

      const next = [
        ...prev,
        {
          id: `draft-${contactId}`,
          contact_id: contactId,
          is_primary: prev.length === 0, // jeśli pusto -> nowa jest primary
          role: '',
          notes: '',
          contact,
        } as any,
      ];

      // jeśli to pierwsza osoba - ustaw draft selection
      if (prev.length === 0) setSelectedBusinessContactId(contactId);

      return next;
    });

    showSnackbar('Dodano (wersja robocza) – zapisze się po "Zapisz zmiany"', 'success');
  };

  const handleRemoveContactPerson = async (id: string) => {
    // DRAFT ONLY: usuń lokalnie
    setEventContactPersons((prev) => {
      const toRemove = prev.find((p) => p.id === id);
      const next = prev.filter((p) => p.id !== id);

      // jeśli usunięto aktualnie wybraną kontaktową -> wyczyść selection
      if (toRemove?.contact_id && toRemove.contact_id === selectedBusinessContactId) {
        setSelectedBusinessContactId('');
      }

      // jeśli usunięto primary -> ustaw pierwszą jako primary (jeśli jest)
      if (toRemove?.is_primary && next.length > 0) {
        const first = next[0];
        const fixed = next.map((p) => ({ ...p, is_primary: p.id === first.id }));
        setSelectedBusinessContactId(first.contact_id);
        return fixed as any;
      }

      return next;
    });

    showSnackbar('Usunięto (wersja robocza) – zapisze się po "Zapisz zmiany"', 'success');
  };

  const handleSetPrimary = async (id: string) => {
    // DRAFT ONLY: ustaw primary lokalnie
    setEventContactPersons((prev) => {
      const next = prev.map((p) => ({ ...p, is_primary: p.id === id })) as any;
      const primary = next.find((p: any) => p.id === id);
      if (primary?.contact_id) setSelectedBusinessContactId(primary.contact_id);
      return next;
    });

    showSnackbar('Ustawiono główną (wersja robocza) – zapisze się po "Zapisz zmiany"', 'success');
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

      setIndividualContacts((prev) => mergeUniqueById(prev, [data as any]));
      setIndividualContactId((data as any).id);

      const created = data as any as Contact;
      setIndividualSearch(`${created.full_name}${created.email ? ` (${created.email})` : ''}`);

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

      const { error: orgError } = await supabase.from('contact_organizations').insert([
        {
          contact_id: (contact as any).id,
          organization_id: organizationId,
          // jeśli masz is_primary -> możesz tu ustawić is_primary: false
        },
      ]);

      if (orgError) throw orgError;

      // odśwież kontakty firmy i auto-pick primary (niech zostanie primary z bazy)
      await fetchBusinessContacts(false);

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

  // INDIVIDUAL suggestions
  const filteredIndividuals = useMemo(() => {
    const q = normalize(individualSearch);
    if (!q) return individualContacts;
    return individualContacts.filter((c) => {
      const hay = normalize(
        `${c.full_name} ${c.first_name} ${c.last_name} ${c.email || ''} ${c.phone || ''}`,
      );
      return hay.includes(q);
    });
  }, [individualContacts, individualSearch]);

  // ORGANIZATION suggestions
  const filteredOrganizations = useMemo(() => {
    const q = normalize(organizationSearch);
    if (!q) return organizations;
    return organizations.filter((o) => {
      const hay = normalize(`${o.alias || ''} ${o.name || ''}`);
      return hay.includes(q);
    });
  }, [organizations, organizationSearch]);

  const availableBusinessContacts = useMemo(() => {
    // W business chcemy wybierać osobę kontaktową z listy kontaktów firmy
    return businessContacts;
  }, [businessContacts]);

  const selectedBusinessContact = useMemo(() => {
    return businessContacts.find((c) => c.id === selectedBusinessContactId) || null;
  }, [businessContacts, selectedBusinessContactId]);

  return (
    <div className="space-y-4">
      {/* Taby */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('individual')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
            activeTab === 'individual'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#d3bb73]/10'
          }`}
          type="button"
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
          type="button"
        >
          <Building2 className="h-4 w-4" />
          Business
        </button>
      </div>

      {activeTab === 'individual' ? (
        // === INDIVIDUAL (zostaje jak było) ===
        <div className="space-y-4">
          <div ref={individualWrapRef}>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Osoba kontaktowa / Klient indywidualny *
            </label>

            <div className="relative">
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={individualSearch}
                  onChange={(e) => {
                    setIndividualSearch(e.target.value);
                    setShowIndividualSuggestions(true);
                  }}
                  onFocus={() => setShowIndividualSuggestions(true)}
                  placeholder="Szukaj (imię, nazwisko, email, tel...)"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                {individualSearch && (
                  <button
                    onClick={() => {
                      setIndividualSearch('');
                      setShowIndividualSuggestions(false);
                    }}
                    className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/5"
                    title="Wyczyść"
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {showIndividualSuggestions && (
                <div className="absolute z-30 w-full overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] shadow-xl">
                  {filteredIndividuals.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setIndividualContactId(c.id);
                        setIndividualSearch(`${c.full_name}${c.email ? ` (${c.email})` : ''}`);
                        setShowIndividualSuggestions(false);
                        setShowNewIndividualForm(false);
                      }}
                      className="flex w-full flex-col px-4 py-3 text-left hover:bg-[#d3bb73]/10"
                    >
                      <span className="text-sm text-[#e5e4e2]">{c.full_name}</span>
                      <span className="text-xs text-[#e5e4e2]/50">
                        {c.email || '—'} {c.phone ? ` • ${c.phone}` : ''}
                      </span>
                    </button>
                  ))}

                  {filteredIndividuals.length === 0 && (
                    <div className="px-4 py-3 text-sm text-[#e5e4e2]/50">Brak wyników</div>
                  )}
                </div>
              )}
            </div>

            {individualContactId && (
              <div className="mt-2 text-xs text-[#e5e4e2]/60">
                Wybrano ID: <span className="text-[#d3bb73]">{individualContactId}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowNewIndividualForm(!showNewIndividualForm)}
            className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
            type="button"
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
                type="button"
              >
                Dodaj klienta
              </button>
            </div>
          )}
        </div>
      ) : (
        // === BUSINESS (POPRAWIONE) ===
        <div className="space-y-4">
          {/* ORGANIZACJA: search + podpowiedzi */}
          <div ref={organizationWrapRef}>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Organizacja (Firma) *</label>

            <div className="relative">
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={organizationSearch}
                  onChange={(e) => {
                    setOrganizationSearch(e.target.value);
                    setShowOrganizationSuggestions(true);
                  }}
                  onFocus={() => setShowOrganizationSuggestions(true)}
                  placeholder="Szukaj organizacji (nazwa / alias...)"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                {organizationSearch && (
                  <button
                    onClick={() => {
                      setOrganizationSearch('');
                      setShowOrganizationSuggestions(false);
                    }}
                    className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/5"
                    title="Wyczyść"
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {showOrganizationSuggestions && (
                <div className="absolute z-30 w-full overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] shadow-xl">
                  {filteredOrganizations.slice(0, 8).map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => {
                        setOrganizationId(org.id);
                        setOrganizationSearch(org.alias || org.name);
                        setShowOrganizationSuggestions(false);

                        // reset selection, ale fetchBusinessContacts(autopick) zaraz ustawi primary
                        setSelectedBusinessContactId('');
                      }}
                      className="flex w-full flex-col px-4 py-3 text-left hover:bg-[#d3bb73]/10"
                    >
                      <span className="text-sm text-[#e5e4e2]">{org.alias || org.name}</span>
                      {org.alias && <span className="text-xs text-[#e5e4e2]/50">{org.name}</span>}
                    </button>
                  ))}

                  {filteredOrganizations.length === 0 && (
                    <div className="px-4 py-3 text-sm text-[#e5e4e2]/50">Brak wyników</div>
                  )}
                </div>
              )}
            </div>

            {organizationId && (
              <div className="mt-2 text-xs text-[#e5e4e2]/60">
                Wybrano ID: <span className="text-[#d3bb73]">{organizationId}</span>
              </div>
            )}
          </div>

          {/* ✅ Po wybraniu organizacji: pokaż prosty selector osoby kontaktowej (bez wyszukiwarki) */}
          {organizationId && (
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
              <div className="mb-2 text-sm text-[#e5e4e2]/60">Osoba kontaktowa (z firmy)</div>

              {/* Jeśli jest ustawiona (auto primary lub manual) */}
              {selectedBusinessContact ? (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-[#1c1f33] px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[#e5e4e2]">{selectedBusinessContact.full_name}</div>
                    <div className="truncate text-xs text-[#e5e4e2]/50">
                      {selectedBusinessContact.position ? `${selectedBusinessContact.position} • ` : ''}
                      {selectedBusinessContact.email || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      // usuń draft selection -> pokaże się selector poniżej (bez search)
                      setSelectedBusinessContactId('');
                    }}
                    className="rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10"
                    title="Usuń wybór"
                  >
                    Usuń
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      setSelectedBusinessContactId(id);
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="">Wybierz osobę kontaktową</option>
                    {availableBusinessContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name} {c.position ? `(${c.position})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-[#e5e4e2]/40">
                    Wybór jest roboczy — zapisze się dopiero po „Zapisz zmiany”.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* (opcjonalnie) Lista event_contact_persons – ale DRAFT ONLY */}
          {organizationId && showEventContactPersons && eventId && (
            <div className="border-t border-[#d3bb73]/10 pt-4">
              <h3 className="mb-3 text-lg font-light text-[#e5e4e2]">Osoby kontaktowe (podgląd)</h3>

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
                          <div className="mt-1 text-xs text-[#e5e4e2]/40">Rola: {person.role}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!person.is_primary && (
                          <button
                            onClick={() => handleSetPrimary(person.id)}
                            className="text-xs text-[#d3bb73] hover:underline"
                            type="button"
                          >
                            Ustaw główną
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveContactPerson(person.id)}
                          className="rounded p-1 text-red-400 hover:bg-red-400/10"
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-4 text-sm text-[#e5e4e2]/40">Brak przypisanych osób kontaktowych</p>
              )}

              <button
                onClick={() => setShowNewBusinessContactForm(!showNewBusinessContactForm)}
                className="mb-4 flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                type="button"
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
                    type="button"
                  >
                    Dodaj osobę
                  </button>
                </div>
              )}

              {/* Jeśli chcesz dalej "dodaj istniejącą osobę do eventu" – zostawiam draft-only */}
              {eventContactPersons.length === 0 && availableBusinessContacts.length > 0 && (
                <div className="mt-3">
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Dodaj osobę do listy (roboczo)
                  </label>

                  <div className="mb-2 flex items-center gap-2">
                    <input
                      value={businessSearch}
                      onChange={(e) => setBusinessSearch(e.target.value)}
                      placeholder="Szukaj osoby (imię, stanowisko, email...)"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    {businessSearch && (
                      <button
                        onClick={() => setBusinessSearch('')}
                        className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/5"
                        title="Wyczyść"
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddExistingContact(e.target.value);
                        e.target.value = '';
                        setBusinessSearch('');
                      }
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="">Wybierz osobę</option>
                    {availableBusinessContacts
                      .filter((c) => {
                        const q = normalize(businessSearch);
                        if (!q) return true;
                        const hay = normalize(
                          `${c.full_name} ${c.first_name} ${c.last_name} ${c.position || ''} ${c.email || ''} ${c.phone || ''}`,
                        );
                        return hay.includes(q);
                      })
                      .map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.full_name} {contact.position ? `(${contact.position})` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}