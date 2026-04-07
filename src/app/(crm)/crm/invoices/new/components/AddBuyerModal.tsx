'use client';

import { useState } from 'react';
import { X, Search, Loader2, Building2, User } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { fetchCompanyDataFromGUS } from '@/lib/gus';

interface AddBuyerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (buyerId: string) => void;
}

export default function AddBuyerModal({ isOpen, onClose, onSuccess }: AddBuyerModalProps) {
  const { showSnackbar } = useSnackbar();
  const [clientType, setClientType] = useState<'individual' | 'business'>('business');
  const [loading, setLoading] = useState(false);
  const [gusLoading, setGusLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    nip: '',
    street: '',
    postal_code: '',
    city: '',
    first_name: '',
    last_name: '',
  });

  if (!isOpen) return null;

  const handleGUSLookup = async () => {
    if (!formData.nip || formData.nip.length < 10) {
      showSnackbar('Wprowadź poprawny NIP (10 cyfr)', 'error');
      return;
    }

    try {
      setGusLoading(true);

      const gusData = await fetchCompanyDataFromGUS(formData.nip);

      if (!gusData) {
        showSnackbar('Nie znaleziono firmy w rejestrze VAT', 'warning');
        return;
      }

      // Parse address to extract street, postal code, and city
      const address = gusData.address || '';
      const addressMatch = address.match(/^(.+?),?\s*(\d{2}-\d{3})\s+(.+)$/);

      let street = '';
      let postalCode = '';
      let city = '';

      if (addressMatch) {
        street = addressMatch[1].trim();
        postalCode = addressMatch[2];
        city = addressMatch[3].trim();
      }

      setFormData((prev) => ({
        ...prev,
        name: gusData.name || prev.name,
        street: street || prev.street,
        postal_code: postalCode || prev.postal_code,
        city: city || prev.city,
      }));

      showSnackbar('Dane pobrane z rejestru VAT', 'success');
    } catch (err: any) {
      console.error('GUS lookup error:', err);
      showSnackbar(err.message || 'Błąd podczas pobierania danych', 'error');
    } finally {
      setGusLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (clientType === 'business') {
      if (!formData.name || !formData.nip) {
        showSnackbar('Wypełnij nazwę firmy i NIP', 'error');
        return;
      }
    } else {
      if (!formData.first_name || !formData.last_name) {
        showSnackbar('Wypełnij imię i nazwisko', 'error');
        return;
      }
    }

    try {
      setLoading(true);

      if (clientType === 'business') {
        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .insert({
            name: formData.name,
            nip: formData.nip,
            street: formData.street,
            postal_code: formData.postal_code,
            city: formData.city,
          })
          .select()
          .single();

        if (orgError) throw orgError;

        showSnackbar('Firma dodana pomyślnie', 'success');
        onSuccess(org.id);
      } else {
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            first_name: formData.first_name,
            last_name: formData.last_name,
            contact_type: 'individual',
            street: formData.street,
            postal_code: formData.postal_code,
            city: formData.city,
          })
          .select()
          .single();

        if (contactError) throw contactError;

        showSnackbar('Kontakt dodany pomyślnie', 'success');
        onSuccess(contact.id);
      }

      onClose();
    } catch (err: any) {
      console.error('Error adding buyer:', err);
      showSnackbar(err.message || 'Błąd podczas dodawania nabywcy', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-medium text-[#e5e4e2]">Dodaj nowego nabywcę</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6 flex gap-4">
            <button
              onClick={() => setClientType('business')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                clientType === 'business'
                  ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                  : 'border-[#d3bb73]/20 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40'
              }`}
            >
              <Building2 className="h-5 w-5" />
              <span className="font-medium">Firma</span>
            </button>
            <button
              onClick={() => setClientType('individual')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                clientType === 'individual'
                  ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                  : 'border-[#d3bb73]/20 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40'
              }`}
            >
              <User className="h-5 w-5" />
              <span className="font-medium">Osoba</span>
            </button>
          </div>

          <div className="space-y-4">
            {clientType === 'business' ? (
              <>
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">NIP *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.nip}
                      onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                      placeholder="1234567890"
                      className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={handleGUSLookup}
                      disabled={gusLoading || !formData.nip}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-3 text-[#d3bb73] hover:bg-[#d3bb73]/30 disabled:opacity-50"
                    >
                      {gusLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Search className="h-5 w-5" />
                      )}
                      <span className="hidden sm:inline">GUS</span>
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                    Wpisz NIP i kliknij GUS aby pobrać dane z Białej Listy VAT
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa firmy *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="np. MAVINCI Sp. z o.o."
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Imię *</label>
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      placeholder="Jan"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwisko *</label>
                    <input
                      type="text"
                      value={formData.last_name}
                      onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      placeholder="Kowalski"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ulica i numer</label>
              <input
                type="text"
                value={formData.street}
                onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                placeholder="ul. Przykładowa 123"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kod</label>
                <input
                  type="text"
                  value={formData.postal_code}
                  onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                  placeholder="00-000"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Miasto</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="Warszawa"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
              <div className="text-xs text-blue-400">
                <strong>Podpowiedź:</strong> Dla firm możesz użyć funkcji pobierania danych z Białej
                Listy VAT - wystarczy wpisać NIP i kliknąć przycisk GUS
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 px-6 py-3 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : 'Dodaj nabywcę'}
          </button>
        </div>
      </div>
    </div>
  );
}
