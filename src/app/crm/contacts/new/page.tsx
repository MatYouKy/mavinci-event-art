'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  UserCheck,
  User,
  ArrowLeft,
  Save,
  Hotel,
  UtensilsCrossed,
  Briefcase,
  Search,
  Loader2,
  Plus,
  X,
  MapPin,
  Trash2,
  Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { fetchCompanyDataFromGUS, parseGoogleMapsUrl } from '@/lib/gus';

type ContactType = 'organization' | 'contact' | 'subcontractor' | 'individual';
type BusinessType = 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';

interface ExistingContact {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
}

interface NewContactForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  businessPhone: string;
  nip: string;
  position: string;
  pesel: string;
  idNumber: string;
  eventType: string;
  eventDetails: string;
}

export default function NewContactPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [contactType, setContactType] = useState<ContactType | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGUS, setLoadingGUS] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    alias: '',
    businessType: 'company' as BusinessType,
    nip: '',
    regon: '',
    address: '',
    city: '',
    postalCode: '',
    email: '',
    phone: '',
    website: '',
    googleMapsUrl: '',
    latitude: '',
    longitude: '',
    locationNotes: '',
    notes: '',
    hourlyRate: '',
    specialization: [] as string[],
  });

  const [availableContacts, setAvailableContacts] = useState<ExistingContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewContactForm, setShowNewContactForm] = useState(false);
  const [newContact, setNewContact] = useState<NewContactForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    mobile: '',
    businessPhone: '',
    nip: '',
    position: '',
    pesel: '',
    idNumber: '',
    eventType: '',
    eventDetails: '',
  });

  const [specializationInput, setSpecializationInput] = useState('');

  useEffect(() => {
    if (contactType === 'organization' || contactType === 'subcontractor') {
      fetchAvailableContacts();
    }
  }, [contactType]);

  const fetchAvailableContacts = async () => {
    try {
      setLoadingContacts(true);
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('contact_type', 'contact')
        .eq('status', 'active')
        .order('full_name');

      if (error) throw error;
      setAvailableContacts(data || []);
    } catch (error: any) {
      console.error('Error fetching contacts:', error);
      showSnackbar('Błąd podczas ładowania kontaktów', 'error');
    } finally {
      setLoadingContacts(false);
    }
  };

  const toggleContactSelection = (contactId: string) => {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter((id) => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  };

  const handleAddNewContact = async () => {
    if (!newContact.firstName.trim() || !newContact.lastName.trim()) {
      showSnackbar('Wprowadź imię i nazwisko kontaktu', 'error');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('contacts')
        .insert([{
          contact_type: 'contact',
          first_name: newContact.firstName,
          last_name: newContact.lastName,
          email: newContact.email || null,
          phone: newContact.phone || null,
          mobile: newContact.mobile || null,
          status: 'active',
        }])
        .select()
        .single();

      if (error) throw error;

      setAvailableContacts([...availableContacts, data]);
      setSelectedContactIds([...selectedContactIds, data.id]);
      setShowNewContactForm(false);
      setNewContact({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        mobile: '',
      });
      showSnackbar('Kontakt dodany', 'success');
    } catch (error: any) {
      console.error('Error adding contact:', error);
      showSnackbar('Błąd podczas dodawania kontaktu', 'error');
    }
  };

  const handleFetchFromGUS = async () => {
    if (!formData.nip) {
      showSnackbar('Wprowadź NIP', 'error');
      return;
    }

    try {
      setLoadingGUS(true);
      const data = await fetchCompanyDataFromGUS(formData.nip);

      if (data) {
        setFormData({
          ...formData,
          name: data.name || formData.name,
          regon: data.regon || formData.regon,
          address: data.address || formData.address,
        });
        showSnackbar('Dane pobrane z GUS', 'success');
      }
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas pobierania danych z GUS', 'error');
    } finally {
      setLoadingGUS(false);
    }
  };

  const handleParseGoogleMaps = () => {
    if (!formData.googleMapsUrl) {
      showSnackbar('Wprowadź URL Google Maps', 'error');
      return;
    }

    try {
      const coords = parseGoogleMapsUrl(formData.googleMapsUrl);
      if (coords) {
        setFormData({
          ...formData,
          latitude: coords.latitude.toString(),
          longitude: coords.longitude.toString(),
        });
        showSnackbar('Współrzędne pobrane z URL', 'success');
      } else {
        showSnackbar('Nie udało się odczytać współrzędnych z URL. Sprawdź format linku.', 'error');
      }
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas parsowania URL', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contactType) {
      showSnackbar('Wybierz typ kontaktu', 'error');
      return;
    }

    if (contactType === 'organization' || contactType === 'subcontractor') {
      if (!formData.name) {
        showSnackbar('Wprowadź nazwę organizacji', 'error');
        return;
      }
    }

    if (contactType === 'contact' || contactType === 'individual') {
      if (!newContact.firstName.trim() || !newContact.lastName.trim()) {
        showSnackbar('Wprowadź dane osoby kontaktowej', 'error');
        return;
      }
    }

    try {
      setLoading(true);

      if (contactType === 'contact' || contactType === 'individual') {
        const contactData: any = {
          contact_type: contactType,
          first_name: newContact.firstName,
          last_name: newContact.lastName,
          email: newContact.email || formData.email || null,
          phone: newContact.phone || formData.phone || null,
          mobile: newContact.mobile || null,
          city: formData.city || null,
          address: formData.address || null,
          postal_code: formData.postalCode || null,
          notes: formData.notes || null,
          status: 'active' as const,
        };

        // Dodatkowe pola dla kontaktu
        if (contactType === 'contact') {
          contactData.nip = newContact.nip || null;
          contactData.position = newContact.position || null;
          contactData.business_phone = newContact.businessPhone || null;
        }

        // Dodatkowe pola dla osoby prywatnej
        if (contactType === 'individual') {
          contactData.pesel = newContact.pesel || null;
          contactData.id_number = newContact.idNumber || null;
          contactData.event_type = newContact.eventType || null;
          contactData.event_details = newContact.eventDetails || null;
        }

        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .insert([contactData])
          .select()
          .single();

        if (contactError) throw contactError;

        showSnackbar(
          contactType === 'contact' ? 'Kontakt dodany pomyślnie' : 'Osoba prywatna dodana pomyślnie',
          'success'
        );
        router.push(`/crm/contacts/${contact.id}`);
      } else {
        const orgData = {
          organization_type: contactType === 'subcontractor' ? 'subcontractor' : 'client',
          business_type: formData.businessType,
          name: formData.name,
          alias: formData.alias || null,
          nip: formData.nip || null,
          address: formData.address || null,
          city: formData.city || null,
          postal_code: formData.postalCode || null,
          email: formData.email || null,
          phone: formData.phone || null,
          website: formData.website || null,
          google_maps_url: formData.googleMapsUrl || null,
          latitude: formData.latitude ? parseFloat(formData.latitude) : null,
          longitude: formData.longitude ? parseFloat(formData.longitude) : null,
          location_notes: formData.locationNotes || null,
          notes: formData.notes || null,
          status: 'active' as const,
          specialization: contactType === 'subcontractor' ? formData.specialization : null,
          hourly_rate: contactType === 'subcontractor' && formData.hourlyRate
            ? parseFloat(formData.hourlyRate)
            : null,
        };

        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .insert([orgData])
          .select()
          .single();

        if (orgError) throw orgError;

        if (selectedContactIds.length > 0) {
          const contactOrgLinks = selectedContactIds.map((contactId) => ({
            contact_id: contactId,
            organization_id: org.id,
            is_current: true,
          }));

          const { error: linkError } = await supabase
            .from('contact_organizations')
            .insert(contactOrgLinks);

          if (linkError) throw linkError;
        }

        showSnackbar(
          contactType === 'organization'
            ? 'Organizacja dodana pomyślnie'
            : 'Podwykonawca dodany pomyślnie',
          'success'
        );
        router.push(`/crm/contacts/${org.id}`);
      }
    } catch (error: any) {
      console.error('Error creating contact:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania kontaktu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addSpecialization = () => {
    if (specializationInput.trim()) {
      setFormData({
        ...formData,
        specialization: [...formData.specialization, specializationInput.trim()],
      });
      setSpecializationInput('');
    }
  };

  const removeSpecialization = (index: number) => {
    setFormData({
      ...formData,
      specialization: formData.specialization.filter((_, i) => i !== index),
    });
  };

  const getBusinessTypeIcon = (type: BusinessType) => {
    switch (type) {
      case 'hotel':
        return <Hotel className="w-5 h-5" />;
      case 'restaurant':
        return <UtensilsCrossed className="w-5 h-5" />;
      case 'venue':
        return <Building2 className="w-5 h-5" />;
      case 'freelancer':
        return <User className="w-5 h-5" />;
      default:
        return <Briefcase className="w-5 h-5" />;
    }
  };

  const filteredContacts = availableContacts.filter((contact) =>
    contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-[#1a1d2e] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-400" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-[#d3bb73]">Dodaj kontakt</h1>
            <p className="text-gray-400">Wybierz typ kontaktu</p>
          </div>
        </div>

        {!contactType ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => setContactType('organization')}
              className="bg-[#1a1d2e] border-2 border-gray-700 hover:border-[#d3bb73] rounded-lg p-8 transition-all group"
            >
              <Building2 className="w-16 h-16 text-[#d3bb73] mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-semibold text-white mb-2">Organizacja</h3>
              <p className="text-gray-400 text-sm">Firma, hotel, restauracja, sala eventowa</p>
            </button>

            <button
              onClick={() => setContactType('contact')}
              className="bg-[#1a1d2e] border-2 border-gray-700 hover:border-[#d3bb73] rounded-lg p-8 transition-all group"
            >
              <User className="w-16 h-16 text-[#d3bb73] mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-semibold text-white mb-2">Kontakt</h3>
              <p className="text-gray-400 text-sm">Osoba w organizacji lub niezależna</p>
            </button>

            <button
              onClick={() => setContactType('subcontractor')}
              className="bg-[#1a1d2e] border-2 border-gray-700 hover:border-[#d3bb73] rounded-lg p-8 transition-all group"
            >
              <UserCheck className="w-16 h-16 text-[#d3bb73] mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-semibold text-white mb-2">Podwykonawca</h3>
              <p className="text-gray-400 text-sm">Firma lub freelancer współpracujący</p>
            </button>

            <button
              onClick={() => setContactType('individual')}
              className="bg-[#1a1d2e] border-2 border-gray-700 hover:border-[#d3bb73] rounded-lg p-8 transition-all group"
            >
              <User className="w-16 h-16 text-[#d3bb73] mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-semibold text-white mb-2">Osoba prywatna</h3>
              <p className="text-gray-400 text-sm">Klient indywidualny</p>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                {contactType === 'organization' && <Building2 className="w-8 h-8 text-[#d3bb73]" />}
                {contactType === 'contact' && <User className="w-8 h-8 text-[#d3bb73]" />}
                {contactType === 'subcontractor' && <UserCheck className="w-8 h-8 text-[#d3bb73]" />}
                {contactType === 'individual' && <User className="w-8 h-8 text-[#d3bb73]" />}
                <h2 className="text-2xl font-bold text-white">
                  {contactType === 'organization' && 'Nowa organizacja'}
                  {contactType === 'contact' && 'Nowy kontakt'}
                  {contactType === 'subcontractor' && 'Nowy podwykonawca'}
                  {contactType === 'individual' && 'Nowa osoba prywatna'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setContactType(null)}
                className="text-gray-400 hover:text-white transition-colors text-sm"
              >
                Zmień typ
              </button>
            </div>

            <div className="space-y-6">
              {(contactType === 'organization' || contactType === 'subcontractor') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nazwa pełna <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      placeholder="np. OMEGA HOTEL SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Alias (krótka nazwa)
                    </label>
                    <input
                      type="text"
                      value={formData.alias}
                      onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      placeholder="np. OMEGA HOTEL"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Krótka nazwa wyświetlana zamiast pełnej nazwy
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">NIP</label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={formData.nip}
                          onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                          className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          placeholder="0000000000"
                        />
                        <button
                          type="button"
                          onClick={handleFetchFromGUS}
                          disabled={loadingGUS}
                          className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 disabled:opacity-50"
                        >
                          {loadingGUS ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Search className="w-5 h-5" />
                          )}
                          <span>GUS</span>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">REGON</label>
                      <input
                        type="text"
                        value={formData.regon}
                        onChange={(e) => setFormData({ ...formData, regon: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        readOnly
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Typ działalności</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {contactType === 'organization'
                        ? ['company', 'hotel', 'restaurant', 'venue', 'other'].map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setFormData({ ...formData, businessType: type as BusinessType })}
                              className={`flex items-center space-x-2 px-4 py-2 rounded-lg border-2 transition-all ${
                                formData.businessType === type
                                  ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                                  : 'border-gray-700 text-gray-400 hover:border-gray-600'
                              }`}
                            >
                              {getBusinessTypeIcon(type as BusinessType)}
                              <span className="capitalize">
                                {type === 'company' && 'Firma'}
                                {type === 'hotel' && 'Hotel'}
                                {type === 'restaurant' && 'Restauracja'}
                                {type === 'venue' && 'Sala eventowa'}
                                {type === 'other' && 'Inna'}
                              </span>
                            </button>
                          ))
                        : ['company', 'freelancer'].map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setFormData({ ...formData, businessType: type as BusinessType })}
                              className={`flex items-center space-x-2 px-4 py-2 rounded-lg border-2 transition-all ${
                                formData.businessType === type
                                  ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                                  : 'border-gray-700 text-gray-400 hover:border-gray-600'
                              }`}
                            >
                              {getBusinessTypeIcon(type as BusinessType)}
                              <span>{type === 'company' ? 'Firma' : 'Freelancer'}</span>
                            </button>
                          ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Strona WWW</label>
                    <input
                      type="url"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      placeholder="https://"
                    />
                  </div>
                </>
              )}

              {(contactType === 'organization' || contactType === 'subcontractor') && (
                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
                    <User className="w-5 h-5 text-[#d3bb73]" />
                    <span>Osoby kontaktowe</span>
                    <span className="text-sm font-normal text-gray-400">(opcjonalne)</span>
                  </h3>

                  {loadingContacts ? (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-[#d3bb73] mx-auto" />
                    </div>
                  ) : (
                    <>
                      <div className="mb-4">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Szukaj kontaktu..."
                            className="w-full pl-10 pr-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                      </div>

                      <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
                        {filteredContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => toggleContactSelection(contact.id)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                              selectedContactIds.includes(contact.id)
                                ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                                : 'border-gray-700 hover:border-gray-600'
                            }`}
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                                <User className="w-5 h-5 text-[#d3bb73]" />
                              </div>
                              <div className="text-left">
                                <p className="text-white font-medium">{contact.full_name}</p>
                                {contact.email && (
                                  <p className="text-sm text-gray-400">{contact.email}</p>
                                )}
                              </div>
                            </div>
                            {selectedContactIds.includes(contact.id) && (
                              <Check className="w-5 h-5 text-[#d3bb73]" />
                            )}
                          </button>
                        ))}
                      </div>

                      {selectedContactIds.length > 0 && (
                        <div className="mb-4 p-3 bg-[#0f1119] rounded-lg">
                          <p className="text-sm text-gray-400 mb-2">Wybrane kontakty:</p>
                          <div className="flex flex-wrap gap-2">
                            {selectedContactIds.map((id) => {
                              const contact = availableContacts.find((c) => c.id === id);
                              return (
                                <span
                                  key={id}
                                  className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg text-sm flex items-center space-x-2"
                                >
                                  <span>{contact?.full_name}</span>
                                  <button
                                    type="button"
                                    onClick={() => toggleContactSelection(id)}
                                    className="hover:text-red-400 transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {!showNewContactForm ? (
                        <button
                          type="button"
                          onClick={() => setShowNewContactForm(true)}
                          className="w-full px-4 py-2 border-2 border-dashed border-gray-700 rounded-lg text-gray-400 hover:border-[#d3bb73] hover:text-[#d3bb73] transition-colors flex items-center justify-center space-x-2"
                        >
                          <Plus className="w-5 h-5" />
                          <span>Dodaj nowy kontakt</span>
                        </button>
                      ) : (
                        <div className="bg-[#0f1119] border border-gray-700 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-medium text-white">Nowy kontakt</h4>
                            <button
                              type="button"
                              onClick={() => setShowNewContactForm(false)}
                              className="text-gray-400 hover:text-white transition-colors"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-1">
                                Imię <span className="text-red-400">*</span>
                              </label>
                              <input
                                type="text"
                                value={newContact.firstName}
                                onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                                className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-1">
                                Nazwisko <span className="text-red-400">*</span>
                              </label>
                              <input
                                type="text"
                                value={newContact.lastName}
                                onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                                className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-1">Email</label>
                              <input
                                type="email"
                                value={newContact.email}
                                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                                className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-1">Telefon</label>
                              <input
                                type="tel"
                                value={newContact.phone}
                                onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                                className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                              />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleAddNewContact}
                            className="w-full px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center justify-center space-x-2"
                          >
                            <Save className="w-5 h-5" />
                            <span>Zapisz kontakt</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {(contactType === 'contact' || contactType === 'individual') && (
                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Dane osobowe</h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">
                          Imię <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={newContact.firstName}
                          onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                          className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">
                          Nazwisko <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={newContact.lastName}
                          onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                          className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                    </div>

                    {contactType === 'contact' && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">
                              Stanowisko <span className="text-gray-500 text-xs">(opcjonalne)</span>
                            </label>
                            <input
                              type="text"
                              value={newContact.position}
                              onChange={(e) => setNewContact({ ...newContact, position: e.target.value })}
                              className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                              placeholder="np. Kierownik sprzedaży"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">
                              NIP <span className="text-gray-500 text-xs">(dla JDG)</span>
                            </label>
                            <input
                              type="text"
                              value={newContact.nip}
                              onChange={(e) => setNewContact({ ...newContact, nip: e.target.value })}
                              className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                              placeholder="0000000000"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {contactType === 'individual' && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">
                              PESEL <span className="text-gray-500 text-xs">(opcjonalne)</span>
                            </label>
                            <input
                              type="text"
                              value={newContact.pesel}
                              onChange={(e) => setNewContact({ ...newContact, pesel: e.target.value })}
                              className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                              placeholder="00000000000"
                              maxLength={11}
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">
                              Numer dowodu <span className="text-gray-500 text-xs">(opcjonalne)</span>
                            </label>
                            <input
                              type="text"
                              value={newContact.idNumber}
                              onChange={(e) => setNewContact({ ...newContact, idNumber: e.target.value })}
                              className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                              placeholder="ABC123456"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm text-gray-400 mb-2">
                            Rodzaj uroczystości <span className="text-gray-500 text-xs">(opcjonalne)</span>
                          </label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {['wesele', 'urodziny', 'dodatki', 'inne'].map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setNewContact({ ...newContact, eventType: type })}
                                className={`px-4 py-2 rounded-lg border-2 transition-all capitalize ${
                                  newContact.eventType === type
                                    ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                                    : 'border-gray-700 text-gray-400 hover:border-gray-600'
                                }`}
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                        </div>

                        {newContact.eventType && (
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">
                              Szczegóły uroczystości <span className="text-gray-500 text-xs">(opcjonalne)</span>
                            </label>
                            <textarea
                              value={newContact.eventDetails}
                              onChange={(e) => setNewContact({ ...newContact, eventDetails: e.target.value })}
                              rows={3}
                              className="w-full px-3 py-2 bg-[#0f1119] border border-gray-700 rounded text-white focus:outline-none focus:border-[#d3bb73]"
                              placeholder="Dodatkowe informacje o uroczystości..."
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Dane kontaktowe</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={(contactType === 'contact' || contactType === 'individual') ? newContact.email : formData.email}
                      onChange={(e) => (contactType === 'contact' || contactType === 'individual')
                        ? setNewContact({ ...newContact, email: e.target.value })
                        : setFormData({ ...formData, email: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>

                  {(contactType === 'contact' || contactType === 'individual') ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Telefon prywatny {contactType === 'individual' && <span className="text-gray-500 text-xs">(opcjonalne)</span>}
                        </label>
                        <input
                          type="tel"
                          value={newContact.phone}
                          onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          placeholder="600 123 456"
                        />
                      </div>
                      {contactType === 'contact' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Telefon firmowy <span className="text-gray-500 text-xs">(opcjonalne)</span>
                          </label>
                          <input
                            type="tel"
                            value={newContact.businessPhone}
                            onChange={(e) => setNewContact({ ...newContact, businessPhone: e.target.value })}
                            className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                            placeholder="22 123 4567"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Telefon</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                  )}

                  {(contactType === 'contact' || contactType === 'individual') && formData.address && (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Adres <span className="text-gray-500 text-xs">(opcjonalne)</span>
                      </label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        placeholder="ul. Przykładowa 123"
                      />
                    </div>
                  )}
                </div>
              </div>

              {(contactType === 'organization' || contactType === 'subcontractor') && (
                <>
                  <div className="border-t border-gray-700 pt-6">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
                      <MapPin className="w-5 h-5 text-[#d3bb73]" />
                      <span>Lokalizacja</span>
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">URL Google Maps</label>
                        <div className="flex space-x-2">
                          <input
                            type="url"
                            value={formData.googleMapsUrl}
                            onChange={(e) => setFormData({ ...formData, googleMapsUrl: e.target.value })}
                            className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                            placeholder="https://maps.google.com/..."
                          />
                          <button
                            type="button"
                            onClick={handleParseGoogleMaps}
                            className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2"
                          >
                            <MapPin className="w-5 h-5" />
                            <span>Pobierz</span>
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Ulica i numer</label>
                        <input
                          type="text"
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">Miasto</label>
                          <input
                            type="text"
                            value={formData.city}
                            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                            className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">Kod pocztowy</label>
                          <input
                            type="text"
                            value={formData.postalCode}
                            onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                            className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                            placeholder="00-000"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {contactType === 'subcontractor' && (
                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Informacje dla podwykonawcy</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Stawka godzinowa (zł)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.hourlyRate}
                        onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Specjalizacje</label>
                      <div className="flex space-x-2 mb-2">
                        <input
                          type="text"
                          value={specializationInput}
                          onChange={(e) => setSpecializationInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSpecialization())}
                          className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          placeholder="Dodaj specjalizację i naciśnij Enter"
                        />
                        <button
                          type="button"
                          onClick={addSpecialization}
                          className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors"
                        >
                          Dodaj
                        </button>
                      </div>
                      {formData.specialization.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {formData.specialization.map((spec, index) => (
                            <span
                              key={index}
                              className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg text-sm flex items-center space-x-2"
                            >
                              <span>{spec}</span>
                              <button
                                type="button"
                                onClick={() => removeSpecialization(index)}
                                className="hover:text-red-400 transition-colors"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-700 pt-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">Notatki</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Dodatkowe informacje..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-4 mt-6 pt-6 border-t border-gray-700">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#0f1119] transition-colors"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                <span>{loading ? 'Zapisywanie...' : 'Zapisz'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
