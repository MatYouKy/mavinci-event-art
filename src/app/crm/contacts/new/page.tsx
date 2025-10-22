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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

type ContactType = 'organization' | 'subcontractor' | 'individual';
type BusinessType = 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';

export default function NewContactPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [contactType, setContactType] = useState<ContactType | null>(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    businessType: 'company' as BusinessType,
    nip: '',
    address: '',
    city: '',
    postalCode: '',
    email: '',
    phone: '',
    website: '',
    notes: '',
    firstName: '',
    lastName: '',
    position: '',
    mobile: '',
    hourlyRate: '',
    specialization: [] as string[],
  });

  const [specializationInput, setSpecializationInput] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contactType) {
      showSnackbar('Wybierz typ kontaktu', 'error');
      return;
    }

    try {
      setLoading(true);

      if (contactType === 'individual') {
        if (!formData.firstName || !formData.lastName) {
          showSnackbar('Wprowadź imię i nazwisko', 'error');
          return;
        }

        const orgData = {
          organization_type: 'client',
          business_type: 'other' as const,
          name: `${formData.firstName} ${formData.lastName}`,
          email: formData.email || null,
          phone: formData.phone || null,
          city: formData.city || null,
          notes: formData.notes || null,
          status: 'active' as const,
        };

        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .insert([orgData])
          .select()
          .single();

        if (orgError) throw orgError;

        const personData = {
          organization_id: org.id,
          first_name: formData.firstName,
          last_name: formData.lastName,
          position: formData.position || null,
          email: formData.email || null,
          phone: formData.phone || null,
          mobile: formData.mobile || null,
          is_primary: true,
          is_decision_maker: true,
        };

        const { error: personError } = await supabase
          .from('contact_persons')
          .insert([personData]);

        if (personError) throw personError;

        showSnackbar('Kontakt dodany pomyślnie', 'success');
        router.push(`/crm/contacts/${org.id}`);
      } else {
        if (!formData.name) {
          showSnackbar('Wprowadź nazwę', 'error');
          return;
        }

        const orgData = {
          organization_type: contactType === 'organization' ? 'client' : 'subcontractor',
          business_type: formData.businessType,
          name: formData.name,
          nip: formData.nip || null,
          address: formData.address || null,
          city: formData.city || null,
          postal_code: formData.postalCode || null,
          email: formData.email || null,
          phone: formData.phone || null,
          website: formData.website || null,
          notes: formData.notes || null,
          status: 'active' as const,
          specialization: contactType === 'subcontractor' ? formData.specialization : null,
          hourly_rate: contactType === 'subcontractor' && formData.hourlyRate ? parseFloat(formData.hourlyRate) : null,
        };

        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .insert([orgData])
          .select()
          .single();

        if (orgError) throw orgError;

        if (formData.firstName && formData.lastName) {
          const personData = {
            organization_id: org.id,
            first_name: formData.firstName,
            last_name: formData.lastName,
            position: formData.position || null,
            email: formData.email || null,
            phone: formData.phone || null,
            mobile: formData.mobile || null,
            is_primary: true,
            is_decision_maker: true,
          };

          const { error: personError } = await supabase
            .from('contact_persons')
            .insert([personData]);

          if (personError) throw personError;
        }

        showSnackbar(
          contactType === 'organization' ? 'Organizacja dodana pomyślnie' : 'Podwykonawca dodany pomyślnie',
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

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-4xl mx-auto">
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
                onClick={() => {
                  setContactType(null);
                  setFormData({
                    name: '',
                    businessType: 'company',
                    nip: '',
                    address: '',
                    city: '',
                    postalCode: '',
                    email: '',
                    phone: '',
                    website: '',
                    notes: '',
                    firstName: '',
                    lastName: '',
                    position: '',
                    mobile: '',
                    hourlyRate: '',
                    specialization: [],
                  });
                }}
                className="text-gray-400 hover:text-white transition-colors text-sm"
              >
                Zmień typ
              </button>
            </div>

            <div className="space-y-6">
              {contactType === 'individual' ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Imię <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Nazwisko <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Stanowisko</label>
                    <input
                      type="text"
                      value={formData.position}
                      onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nazwa {contactType === 'organization' ? 'organizacji' : 'firmy/freelancera'}{' '}
                      <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      placeholder="np. Hotel Grand, Mavinci Sp. z o.o."
                    />
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">NIP</label>
                      <input
                        type="text"
                        value={formData.nip}
                        onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                        className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                      />
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
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Osoba kontaktowa (opcjonalnie)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Imię</label>
                        <input
                          type="text"
                          value={formData.firstName}
                          onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Nazwisko</label>
                        <input
                          type="text"
                          value={formData.lastName}
                          onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Stanowisko</label>
                        <input
                          type="text"
                          value={formData.position}
                          onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Telefon komórkowy</label>
                        <input
                          type="tel"
                          value={formData.mobile}
                          onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                          className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="border-t border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Dane kontaktowe</h3>
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
                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Adres</h3>
                  <div className="space-y-4">
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
                <Save className="w-5 h-5" />
                <span>{loading ? 'Zapisywanie...' : 'Zapisz'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
