'use client';

import { useState, useEffect } from 'react';
import { Building2, Plus, CreditCard as Edit, Trash2, Check, Star, Save, X, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import Image from 'next/image';

export interface MyCompany {
  id: string;
  name: string;
  legal_name: string;
  nip: string;
  regon?: string;
  krs?: string;
  street: string;
  building_number: string;
  apartment_number?: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  bank_account?: string;
  bank_name: string;
  logo_url?: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
}

export default function MyCompaniesPage() {
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<MyCompany | null>(null);

  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('my_companies')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      setCompanies(data || []);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd wczytywania firm', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (companyId: string) => {
    try {
      const { error } = await supabase
        .from('my_companies')
        .update({ is_default: true })
        .eq('id', companyId);

      if (error) throw error;
      showSnackbar('Ustawiono domyślną firmę', 'success');
      await loadCompanies();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd ustawiania domyślnej firmy', 'error');
    }
  };

  const handleToggleActive = async (companyId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('my_companies')
        .update({ is_active: !isActive })
        .eq('id', companyId);

      if (error) throw error;
      showSnackbar(
        !isActive ? 'Firma aktywowana' : 'Firma dezaktywowana',
        'success'
      );
      await loadCompanies();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd zmiany statusu firmy', 'error');
    }
  };

  const handleDelete = async (companyId: string, companyName: string) => {
    const confirmed = await showConfirm({
      title: 'Usuń firmę',
      message: `Czy na pewno chcesz usunąć firmę "${companyName}"? Wszystkie powiązane dane zostaną zachowane, ale firma nie będzie już dostępna.`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });

    if (!confirmed) {
      return;
    }

    try {
      const { error } = await supabase
        .from('my_companies')
        .delete()
        .eq('id', companyId);

      if (error) throw error;
      showSnackbar('Firma usunięta', 'success');
      await loadCompanies();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd usuwania firmy', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">Moje firmy</h1>
            <p className="text-[#e5e4e2]/60">
              Zarządzaj swoimi działalnościami i ich danymi
            </p>
          </div>
          <button
            onClick={() => {
              setEditingCompany(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            Dodaj firmę
          </button>
        </div>

        {/* Companies list */}
        <div className="grid gap-6">
          {companies.map((company) => (
            <div
              key={company.id}
              className={`rounded-xl border bg-[#1c1f33] p-6 transition-colors ${
                company.is_default
                  ? 'border-[#d3bb73]'
                  : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/20'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex gap-4">
                  {company.logo_url ? (
                    <Image
                      src={company.logo_url}
                      alt={company.name}
                      className="h-16 w-16 rounded-lg object-cover"
                      width={64}
                      height={64}
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                      <Building2 className="h-8 w-8 text-[#d3bb73]" />
                    </div>
                  )}
                  <div>
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-xl font-medium text-[#e5e4e2]">
                        {company.name}
                      </h3>
                      {company.is_default && (
                        <span className="flex items-center gap-1 rounded-lg bg-[#d3bb73]/20 px-2 py-1 text-xs font-medium text-[#d3bb73]">
                          <Star className="h-3 w-3 fill-current" />
                          Domyślna
                        </span>
                      )}
                      {!company.is_active && (
                        <span className="rounded-lg bg-red-400/20 px-2 py-1 text-xs font-medium text-red-400">
                          Nieaktywna
                        </span>
                      )}
                    </div>
                    <p className="mb-3 text-sm text-[#e5e4e2]/60">
                      {company.legal_name}
                    </p>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <div>
                        <span className="text-[#e5e4e2]/40">NIP:</span>{' '}
                        <span className="text-[#e5e4e2]">{company.nip}</span>
                      </div>
                      {company.regon && (
                        <div>
                          <span className="text-[#e5e4e2]/40">REGON:</span>{' '}
                          <span className="text-[#e5e4e2]">{company.regon}</span>
                        </div>
                      )}
                      {company.krs && (
                        <div>
                          <span className="text-[#e5e4e2]/40">KRS:</span>{' '}
                          <span className="text-[#e5e4e2]">{company.krs}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-[#e5e4e2]/40">Email:</span>{' '}
                        <span className="text-[#e5e4e2]">{company.email}</span>
                      </div>
                      <div>
                        <span className="text-[#e5e4e2]/40">Telefon:</span>{' '}
                        <span className="text-[#e5e4e2]">{company.phone}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[#e5e4e2]/40">Adres:</span>{' '}
                        <span className="text-[#e5e4e2]">
                          {company.street} {company.building_number}
                          {company.apartment_number && `/${company.apartment_number}`}, {company.postal_code} {company.city}
                        </span>
                      </div>
                      {company.bank_account && (
                        <div className="col-span-2">
                          <span className="text-[#e5e4e2]/40">Konto bankowe:</span>{' '}
                          <span className="text-[#e5e4e2]">{company.bank_account}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {!company.is_default && (
                    <button
                      onClick={() => handleSetDefault(company.id)}
                      className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                      title="Ustaw jako domyślną"
                    >
                      <Star className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleToggleActive(company.id, company.is_active)}
                    className={`rounded-lg p-2 transition-colors ${
                      company.is_active
                        ? 'text-green-400 hover:bg-green-400/10'
                        : 'text-[#e5e4e2]/60 hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]'
                    }`}
                    title={company.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                  >
                    <Check className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingCompany(company);
                      setShowModal(true);
                    }}
                    className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                    title="Edytuj"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(company.id, company.name)}
                    className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-red-400/10 hover:text-red-400"
                    title="Usuń"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {companies.length === 0 && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
              <Building2 className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
              <p className="mb-4 text-[#e5e4e2]/60">Nie masz jeszcze żadnej firmy</p>
              <button
                onClick={() => {
                  setEditingCompany(null);
                  setShowModal(true);
                }}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80"
              >
                Dodaj pierwszą firmę
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <CompanyModal
          company={editingCompany}
          onClose={() => {
            setShowModal(false);
            setEditingCompany(null);
          }}
          onSave={() => {
            setShowModal(false);
            setEditingCompany(null);
            loadCompanies();
          }}
        />
      )}
    </div>
  );
}

function CompanyModal({
  company,
  onClose,
  onSave,
}: {
  company: MyCompany | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    name: company?.name || '',
    legal_name: company?.legal_name || '',
    nip: company?.nip || '',
    regon: company?.regon || '',
    krs: company?.krs || '',
    street: company?.street || '',
    building_number: company?.building_number || '',
    apartment_number: company?.apartment_number || '',
    city: company?.city || '',
    postal_code: company?.postal_code || '',
    country: company?.country || 'Polska',
    email: company?.email || '',
    phone: company?.phone || '',
    bank_account: company?.bank_account || '',
    bank_name: company?.bank_name || '',
    is_default: company?.is_default || false,
  });
  const [loading, setLoading] = useState(false);

  const { showSnackbar } = useSnackbar();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.legal_name || !formData.nip) {
      showSnackbar('Wypełnij wszystkie wymagane pola', 'error');
      return;
    }

    setLoading(true);
    try {
      if (company) {
        const { error } = await supabase
          .from('my_companies')
          .update(formData)
          .eq('id', company.id);

        if (error) throw error;
        showSnackbar('Firma zaktualizowana', 'success');
      } else {
        const { error } = await supabase.from('my_companies').insert(formData);

        if (error) throw error;
        showSnackbar('Firma dodana', 'success');
      }

      onSave();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">
            {company ? 'Edytuj firmę' : 'Dodaj firmę'}
          </h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Nazwa skrócona <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="np. Mavinci"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Pełna nazwa prawna <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.legal_name}
                onChange={(e) =>
                  setFormData({ ...formData, legal_name: e.target.value })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Mavinci Spółka z ograniczoną odpowiedzialnością"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                NIP <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.nip}
                onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="1234567890"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">REGON</label>
              <input
                type="text"
                value={formData.regon}
                onChange={(e) => setFormData({ ...formData, regon: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]">KRS</label>
              <input
                type="text"
                value={formData.krs}
                onChange={(e) => setFormData({ ...formData, krs: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Adres
              </label>
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Ulica <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.street}
                onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Przykładowa"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Numer budynku <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.building_number}
                onChange={(e) => setFormData({ ...formData, building_number: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="1"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Numer lokalu
              </label>
              <input
                type="text"
                value={formData.apartment_number}
                onChange={(e) => setFormData({ ...formData, apartment_number: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="opcjonalnie"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Kod pocztowy <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.postal_code}
                onChange={(e) =>
                  setFormData({ ...formData, postal_code: e.target.value })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="00-001"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Miasto <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Warszawa"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="biuro@firma.pl"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">
                Telefon <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="+48 123 456 789"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]">Numer konta bankowego</label>
              <input
                type="text"
                value={formData.bank_account}
                onChange={(e) =>
                  setFormData({ ...formData, bank_account: e.target.value })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="PL 12 3456 7890 1234 5678 9012 3456"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]">Nazwa banku</label>
              <input
                type="text"
                value={formData.bank_name}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="Bank Polski"
              />
            </div>

            <div className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="is_default"
                checked={formData.is_default}
                onChange={(e) =>
                  setFormData({ ...formData, is_default: e.target.checked })
                }
                className="h-4 w-4 rounded border-[#d3bb73]/20"
              />
              <label htmlFor="is_default" className="text-sm text-[#e5e4e2]">
                Ustaw jako domyślną firmę
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 pt-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/20 px-6 py-2 text-[#e5e4e2] hover:bg-[#0a0d1a]"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {loading ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
