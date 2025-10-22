'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { fetchCompanyDataFromGUS, parseGoogleMapsUrl } from '@/lib/gus';

type ContactType = 'organization' | 'subcontractor' | 'individual';
type BusinessType = 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';

interface ContactPerson {
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  phone: string;
  mobile: string;
  isPrimary: boolean;
  isDecisionMaker: boolean;
}

export default function NewContactPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [contactType, setContactType] = useState<ContactType | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGUS, setLoadingGUS] = useState(false);

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

  const [contactPersons, setContactPersons] = useState<ContactPerson[]>([
    {
      firstName: '',
      lastName: '',
      position: '',
      email: '',
      phone: '',
      mobile: '',
      isPrimary: true,
      isDecisionMaker: false,
    },
  ]);

  const [specializationInput, setSpecializationInput] = useState('');

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

  const addContactPerson = () => {
    setContactPersons([
      ...contactPersons,
      {
        firstName: '',
        lastName: '',
        position: '',
        email: '',
        phone: '',
        mobile: '',
        isPrimary: false,
        isDecisionMaker: false,
      },
    ]);
  };

  const removeContactPerson = (index: number) => {
    if (contactPersons.length === 1) {
      showSnackbar('Musi pozostać przynajmniej jedna osoba kontaktowa', 'error');
      return;
    }
    setContactPersons(contactPersons.filter((_, i) => i !== index));
  };

  const updateContactPerson = (index: number, field: keyof ContactPerson, value: any) => {
    const updated = [...contactPersons];
    updated[index] = { ...updated[index], [field]: value };

    if (field === 'isPrimary' && value === true) {
      updated.forEach((person, i) => {
        if (i !== index) person.isPrimary = false;
      });
    }

    setContactPersons(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contactType) {
      showSnackbar('Wybierz typ kontaktu', 'error');
      return;
    }

    if (contactType !== 'individual' && !formData.name) {
      showSnackbar('Wprowadź nazwę organizacji', 'error');
      return;
    }

    const validPersons = contactPersons.filter(
      (p) => p.firstName.trim() && p.lastName.trim()
    );

    if (validPersons.length === 0) {
      showSnackbar('Dodaj przynajmniej jedną osobę kontaktową', 'error');
      return;
    }

    try {
      setLoading(true);

      const orgData = {
        organization_type: contactType === 'subcontractor' ? 'subcontractor' : 'client',
        business_type: formData.businessType,
        name: contactType === 'individual'
          ? `${validPersons[0].firstName} ${validPersons[0].lastName}`
          : formData.name,
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

      const personsData = validPersons.map((person) => ({
        organization_id: org.id,
        first_name: person.firstName,
        last_name: person.lastName,
        position: person.position || null,
        email: person.email || null,
        phone: person.phone || null,
        mobile: person.mobile || null,
        is_primary: person.isPrimary,
        is_decision_maker: person.isDecisionMaker,
      }));

      const { error: personsError } = await supabase
        .from('contact_persons')
        .insert(personsData);

      if (personsError) throw personsError;

      showSnackbar(
        contactType === 'organization'
          ? 'Organizacja dodana pomyślnie'
          : contactType === 'subcontractor'
          ? 'Podwykonawca dodany pomyślnie'
          : 'Kontakt dodany pomyślnie',
        'success'
      );
      router.push(`/crm/contacts/${org.id}`);
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => setContactType('organization')}
              className="bg-[#1a1d2e] border-2 border-gray-700 hover:border-[#d3bb73] rounded-lg p-8 transition-all group"
            >
              <Building2 className="w-16 h-16 text-[#d3bb73] mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-semibold text-white mb-2">Organizacja</h3>
              <p className="text-gray-400 text-sm">Firma, hotel, restauracja, sala eventowa</p>
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
                {contactType === 'subcontractor' && <UserCheck className="w-8 h-8 text-[#d3bb73]" />}
                {contactType === 'individual' && <User className="w-8 h-8 text-[#d3bb73]" />}
                <h2 className="text-2xl font-bold text-white">
                  {contactType === 'organization' && 'Nowa organizacja'}
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
              {contactType !== 'individual' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nazwa pełna{' '}
                      <span className="text-red-400">*</span>
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

              <div className="border-t border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
                  <User className="w-5 h-5 text-[#d3bb73]" />
                  <span>Osoby kontaktowe</span>
                  <span className="text-sm font-normal text-gray-400">(przynajmniej jedna wymagana)</span>
                </h3>

                <div className="space-y-4">
                  {contactPersons.map((person, index) => (
                    <div key={index} className="bg-[#0f1119] border border-gray-700 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium text-white">
                          Osoba {index + 1}
                          {person.isPrimary && (
                            <span className="ml-2 text-xs px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                              Główna
                            </span>
                          )}
                        </h4>
                        {contactPersons.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeContactPerson(index)}
                            className="text-red-400 hover:text-red-300 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">
                            Imię <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={person.firstName}
                            onChange={(e) => updateContactPerson(index, 'firstName', e.target.value)}
                            className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">
                            Nazwisko <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={person.lastName}
                            onChange={(e) => updateContactPerson(index, 'lastName', e.target.value)}
                            className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">Stanowisko</label>
                          <input
                            type="text"
                            value={person.position}
                            onChange={(e) => updateContactPerson(index, 'position', e.target.value)}
                            className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">Email</label>
                          <input
                            type="email"
                            value={person.email}
                            onChange={(e) => updateContactPerson(index, 'email', e.target.value)}
                            className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">Telefon</label>
                          <input
                            type="tel"
                            value={person.phone}
                            onChange={(e) => updateContactPerson(index, 'phone', e.target.value)}
                            className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-1">Telefon komórkowy</label>
                          <input
                            type="tel"
                            value={person.mobile}
                            onChange={(e) => updateContactPerson(index, 'mobile', e.target.value)}
                            className="w-full px-3 py-2 bg-[#1a1d2e] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                          />
                        </div>
                      </div>

                      <div className="flex items-center space-x-6">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={person.isPrimary}
                            onChange={(e) => updateContactPerson(index, 'isPrimary', e.target.checked)}
                            className="w-4 h-4 rounded border-gray-700 bg-[#1a1d2e] text-[#d3bb73] focus:ring-[#d3bb73]"
                          />
                          <span className="text-sm text-gray-300">Główna osoba kontaktowa</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={person.isDecisionMaker}
                            onChange={(e) => updateContactPerson(index, 'isDecisionMaker', e.target.checked)}
                            className="w-4 h-4 rounded border-gray-700 bg-[#1a1d2e] text-[#d3bb73] focus:ring-[#d3bb73]"
                          />
                          <span className="text-sm text-gray-300">Osoba decyzyjna</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addContactPerson}
                  className="mt-4 px-4 py-2 border-2 border-dashed border-gray-700 rounded-lg text-gray-400 hover:border-[#d3bb73] hover:text-[#d3bb73] transition-colors flex items-center space-x-2 w-full justify-center"
                >
                  <Plus className="w-5 h-5" />
                  <span>Dodaj kolejną osobę</span>
                </button>
              </div>

              <div className="border-t border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Dane kontaktowe organizacji</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Telefon</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                </div>
              </div>

              {contactType !== 'individual' && (
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
                        <p className="text-xs text-gray-500 mt-1">
                          Otwórz miejsce w Google Maps, skopiuj PEŁNY URL z paska adresu (nie skrócony link!)
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">Szerokość geograficzna</label>
                          <input
                            type="text"
                            value={formData.latitude}
                            onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                            className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                            placeholder="52.2297"
                            readOnly
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">Długość geograficzna</label>
                          <input
                            type="text"
                            value={formData.longitude}
                            onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                            className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                            placeholder="21.0122"
                            readOnly
                          />
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

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Dodatkowe informacje o lokalizacji</label>
                        <textarea
                          value={formData.locationNotes}
                          onChange={(e) => setFormData({ ...formData, locationNotes: e.target.value })}
                          rows={2}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                          placeholder="np. wejście od podwórka, parking z tyłu budynku..."
                        />
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
