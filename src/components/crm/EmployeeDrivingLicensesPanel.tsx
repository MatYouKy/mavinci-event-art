'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Shield,
  Edit,
  Save,
  X,
  AlertCircle,
  CheckCircle,
  Calendar,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import SearchCombobox from './SearchCombobox';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import { drivingLicenseCodeFromCertification, type LegacyDrivingLicenseCertificate } from '@/lib/CRM/employees/drivingLicenses';

function unwrapEmbedded<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

interface DrivingLicense {
  id: string;
  license_category_id: string;
  obtained_date: string | null;
  expiry_date: string | null;
  license_number: string | null;
  notes: string | null;
  license_category: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    order_index?: number;
  };
}

interface LicenseCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  order_index?: number;
}

interface EmployeeDrivingLicensesPanelProps {
  employeeId: string;
  canEdit: boolean;
  legacyCertificates?: LegacyDrivingLicenseCertificate[];
}

export default function EmployeeDrivingLicensesPanel({
  employeeId,
  canEdit,
  legacyCertificates = [],
}: EmployeeDrivingLicensesPanelProps) {
  const [licenses, setLicenses] = useState<DrivingLicense[]>([]);
  const [availableCategories, setAvailableCategories] = useState<LicenseCategory[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLicense, setEditingLicense] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { showSnackbar } = useSnackbar();
  const [obtainedDateValid, setObtainedDateValid] = useState(true);
  const [expiryDateValid, setExpiryDateValid] = useState(true);

  const [formData, setFormData] = useState({
    license_category_id: '',
    obtained_date: '',
    expiry_date: '',
    license_number: '',
    notes: '',
  });

  useEffect(() => {
    fetchLicenses();
    fetchCategories();
  }, [employeeId]);

  const fetchLicenses = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employee_driving_licenses')
        .select(
          `
          id,
          license_category_id,
          obtained_date,
          expiry_date,
          license_number,
          notes,
          license_category:driving_license_categories(id, code, name, description, order_index)
        `,
        )
        .eq('employee_id', employeeId);

      if (error) throw error;

      const normalized: DrivingLicense[] = (data ?? []).map((row) => {
        const cat = unwrapEmbedded(row.license_category);
        return {
          ...row,
          license_category:
            cat ?? {
              id: row.license_category_id,
              code: '—',
              name: '—',
              description: null,
            },
        };
      });

      const sorted = [...normalized].sort(
        (a, b) => (a.license_category.order_index ?? 0) - (b.license_category.order_index ?? 0),
      );

      setLicenses(sorted);
    } catch (error) {
      console.error('Error fetching licenses:', error);
      showSnackbar('Błąd podczas pobierania praw jazdy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('driving_license_categories')
        .select('*')
        .eq('is_active', true)
        .order('order_index');

      if (error) throw error;
      setAvailableCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const datesValid = () => {
    if (!obtainedDateValid || !expiryDateValid) {
      showSnackbar('Wpisz poprawne daty w formacie DD.MM.RRRR.', 'warning');
      return false;
    }
    if (formData.obtained_date && formData.expiry_date && formData.expiry_date < formData.obtained_date) {
      showSnackbar('Data ważności nie może być wcześniejsza niż data uzyskania.', 'warning');
      return false;
    }
    return true;
  };

  const handleAdd = async () => {
    if (!datesValid()) return;
    if (!formData.license_category_id) {
      showSnackbar('Wybierz kategorię prawa jazdy', 'warning');
      return;
    }

    try {
      const { error } = await supabase.from('employee_driving_licenses').insert({
        employee_id: employeeId,
        license_category_id: formData.license_category_id,
        obtained_date: formData.obtained_date || null,
        expiry_date: formData.expiry_date || null,
        license_number: formData.license_number || null,
        notes: formData.notes || null,
      });

      if (error) throw error;

      showSnackbar('Prawo jazdy dodane pomyślnie', 'success');
      window.dispatchEvent(new Event('employee-driving-licenses-changed'));
      setShowAddModal(false);
      resetForm();
      fetchLicenses();
    } catch (error: any) {
      console.error('Error adding license:', error);
      if (error.code === '23505') {
        showSnackbar('Ta kategoria jest już dodana', 'warning');
      } else {
        showSnackbar('Błąd podczas dodawania prawa jazdy', 'error');
      }
    }
  };

  const handleUpdate = async (licenseId: string) => {
    if (!datesValid()) return;
    try {
      const { error } = await supabase
        .from('employee_driving_licenses')
        .update({
          obtained_date: formData.obtained_date || null,
          expiry_date: formData.expiry_date || null,
          license_number: formData.license_number || null,
          notes: formData.notes || null,
        })
        .eq('id', licenseId);

      if (error) throw error;

      showSnackbar('Prawo jazdy zaktualizowane pomyślnie', 'success');
      window.dispatchEvent(new Event('employee-driving-licenses-changed'));
      setEditingLicense(null);
      resetForm();
      fetchLicenses();
    } catch (error) {
      console.error('Error updating license:', error);
      showSnackbar('Błąd podczas aktualizacji prawa jazdy', 'error');
    }
  };

  const handleDelete = async (licenseId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to prawo jazdy?')) return;

    try {
      const { error } = await supabase
        .from('employee_driving_licenses')
        .delete()
        .eq('id', licenseId);

      if (error) throw error;

      showSnackbar('Prawo jazdy usunięte pomyślnie', 'success');
      window.dispatchEvent(new Event('employee-driving-licenses-changed'));
      fetchLicenses();
    } catch (error) {
      console.error('Error deleting license:', error);
      showSnackbar('Błąd podczas usuwania prawa jazdy', 'error');
    }
  };

  const startEdit = (license: DrivingLicense) => {
    setEditingLicense(license.id);
    setFormData({
      license_category_id: license.license_category_id,
      obtained_date: license.obtained_date || '',
      expiry_date: license.expiry_date || '',
      license_number: license.license_number || '',
      notes: license.notes || '',
    });
  };

  const cancelEdit = () => {
    setEditingLicense(null);
    resetForm();
  };

  const resetForm = () => {
    setObtainedDateValid(true); setExpiryDateValid(true);
    setFormData({
      license_category_id: '',
      obtained_date: '',
      expiry_date: '',
      license_number: '',
      notes: '',
    });
  };

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const isExpired = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    return expiryDate < today;
  };

  const isExpiringSoon = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    const daysUntilExpiry = Math.floor(
      (new Date(expiryDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
  };

  const availableCategoriesForAdd = availableCategories.filter(
    (cat) => !licenses.some((lic) => lic.license_category_id === cat.id),
  );

  const legacyNeedsReview = legacyCertificates.some((cert) => {
    if (!cert.is_active) return false;
    const code = drivingLicenseCodeFromCertification(cert.certification_type.name);
    const current = licenses.find((license) => license.license_category.code === code);
    return !current || current.expiry_date !== cert.expiry_date
      || Boolean(cert.certification_number && current.license_number && cert.certification_number !== current.license_number);
  });
  const prepareLegacyLicense = (cert: LegacyDrivingLicenseCertificate) => {
    const code = drivingLicenseCodeFromCertification(cert.certification_type.name);
    const category = availableCategoriesForAdd.find((item) => item.code === code);
    if (!category) { showSnackbar('Wybierz właściwą kategorię w sekcji Prawa jazdy. Istniejącego wpisu nie nadpisujemy.', 'info'); return; }
    setObtainedDateValid(true); setExpiryDateValid(true);
    setFormData({ license_category_id: category.id, obtained_date: cert.issued_date || '', expiry_date: cert.expiry_date || '',
      license_number: cert.certification_number || '', notes: cert.notes || '' });
    setShowAddModal(true);
  };
  const displayDate = (value: string | null) => value ? value.split('-').reverse().join('.') : 'Nie podano';

  if (loading) {
    return <div className="py-8 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#d3bb73]" />
          <h3 className="text-lg font-medium text-[#e5e4e2]">Prawa jazdy</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
          >
            <Plus className="h-4 w-4" />
            Dodaj prawo jazdy
          </button>
        )}
      </div>

      <p className="text-sm text-[#e5e4e2]/60">Jedyne miejsce zapisu kategorii dla floty. Wybór kierowcy uwzględnia te wpisy, daty ważności oraz termin rezerwacji pojazdu.</p>
      {legacyNeedsReview && <p role="status" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">W historii certyfikatów są brakujące tutaj kategorie lub inne daty ważności. Porównaj je z dokumentem. Nie nadpisujemy ani nie przedłużamy uprawnień automatycznie.</p>}

      {licenses.length === 0 ? (
        <div className="py-8 text-center">
          <Shield className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-sm text-[#e5e4e2]/60">Brak praw jazdy</p>
        </div>
      ) : (
        <div className="space-y-3">
          {licenses.map((license) => {
            const isEditing = editingLicense === license.id;
            const expired = isExpired(license.expiry_date);
            const expiringSoon = isExpiringSoon(license.expiry_date);

            return (
              <div
                key={license.id}
                className={`rounded-lg border p-4 transition-colors ${
                  expired
                    ? 'border-red-500/30 bg-red-500/5'
                    : expiringSoon
                      ? 'border-orange-500/30 bg-orange-500/5'
                      : 'border-[#d3bb73]/10 bg-[#0f1119]'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <SellerDatePicker label="Data uzyskania" value={formData.obtained_date}
                        onChange={(value) => setFormData((previous) => ({ ...previous, obtained_date: value }))} onValidityChange={setObtainedDateValid} />
                      <SellerDatePicker label="Data ważności" value={formData.expiry_date}
                        onChange={(value) => setFormData((previous) => ({ ...previous, expiry_date: value }))} onValidityChange={setExpiryDateValid} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[#e5e4e2]/60">
                        Numer prawa jazdy
                      </label>
                      <input
                        type="text"
                        value={formData.license_number}
                        onChange={(e) =>
                          setFormData({ ...formData, license_number: e.target.value })
                        }
                        className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[#e5e4e2]/60">Notatki</label>
                      <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="w-full resize-none rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdate(license.id)}
                        className="flex items-center gap-1 rounded bg-[#d3bb73] px-3 py-1.5 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                      >
                        <Save className="h-3 w-3" />
                        Zapisz
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1 rounded bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                      >
                        <X className="h-3 w-3" />
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm font-bold text-[#d3bb73]">
                          {license.license_category.code}
                        </span>
                        <span className="font-medium text-[#e5e4e2]">
                          {license.license_category.name}
                        </span>
                        {expired && (
                          <span className="flex items-center gap-1 text-xs text-red-400">
                            <AlertCircle className="h-3 w-3" />
                            Wygasło
                          </span>
                        )}
                        {!expired && expiringSoon && (
                          <span className="flex items-center gap-1 text-xs text-orange-400">
                            <AlertCircle className="h-3 w-3" />
                            Wygasa wkrótce
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {license.obtained_date && (
                          <div>
                            <span className="text-[#e5e4e2]/60">Uzyskano:</span>
                            <span className="ml-2 text-[#e5e4e2]">
                              {new Date(license.obtained_date).toLocaleDateString('pl-PL')}
                            </span>
                          </div>
                        )}
                        {license.expiry_date && (
                          <div>
                            <span className="text-[#e5e4e2]/60">Ważne do:</span>
                            <span
                              className={`ml-2 ${
                                expired
                                  ? 'text-red-400'
                                  : expiringSoon
                                    ? 'text-orange-400'
                                    : 'text-[#e5e4e2]'
                              }`}
                            >
                              {new Date(license.expiry_date).toLocaleDateString('pl-PL')}
                            </span>
                          </div>
                        )}
                      </div>
                      {license.license_number && (
                        <div className="mt-2 text-sm">
                          <span className="text-[#e5e4e2]/60">Numer:</span>
                          <span className="ml-2 text-[#e5e4e2]">{license.license_number}</span>
                        </div>
                      )}
                      {license.notes && (
                        <p className="mt-2 text-xs text-[#e5e4e2]/60">{license.notes}</p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(license)}
                          className="rounded p-1.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(license.id)}
                          className="rounded p-1.5 text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {legacyCertificates.length > 0 && <details className="rounded-lg bg-white/[0.035] p-4 text-sm">
        <summary className="cursor-pointer text-[#e5e4e2]/60">Poprzednie wpisy z certyfikatów — historia ({legacyCertificates.length})</summary>
        <p className="mt-3 text-xs text-[#e5e4e2]/50">Zachowaliśmy oryginalne dane. Wpisy poniżej nie są drugim źródłem uprawnień i nie kwalifikują kierowcy do pojazdu. Kategorie edytujesz wyłącznie powyżej. Przed uzupełnieniem brakującej kategorii sprawdź daty z dokumentem.</p>
        <div className="mt-3 space-y-3">{legacyCertificates.map((cert) => {
          const code = drivingLicenseCodeFromCertification(cert.certification_type.name);
          const canImport = cert.is_active && availableCategoriesForAdd.some((item) => item.code === code);
          return <div key={cert.id} className="rounded-lg bg-black/10 p-3 text-xs text-[#e5e4e2]/60">
            <p className="font-medium text-[#e5e4e2]">{cert.certification_type.name} · {cert.is_active ? 'dawny wpis' : 'dawny wpis nieaktywny'}</p>
            <p className="mt-1">Wydano: {displayDate(cert.issued_date)} · Ważne do: {displayDate(cert.expiry_date)}</p>
            {cert.certification_number && <p>Numer: {cert.certification_number}</p>}
            {cert.issuing_authority && <p>Wystawca: {cert.issuing_authority}</p>}
            {cert.notes && <p className="mt-1 whitespace-pre-wrap">{cert.notes}</p>}
            {cert.document_url && /^https?:\/\//i.test(cert.document_url) && <a href={cert.document_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[#d3bb73] underline">Otwórz dokument historyczny</a>}
            {canEdit && canImport && <button type="button" onClick={() => prepareLegacyLicense(cert)} className="mt-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/20">Sprawdź dane i uzupełnij kategorię</button>}
          </div>;
        })}</div>
      </details>}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
              <Shield className="h-5 w-5 text-[#d3bb73]" />
              Dodaj prawo jazdy
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Kategoria prawa jazdy *
                </label>
                <SearchCombobox
                  ariaLabel="Kategoria prawa jazdy"
                  value={formData.license_category_id}
                  onChange={(value) => setFormData((previous) => ({ ...previous, license_category_id: value }))}
                  options={availableCategoriesForAdd.map((cat) => ({ id: cat.id, label: `${cat.code} — ${cat.name}` }))}
                  placeholder="Wyszukaj kategorię…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SellerDatePicker label="Data uzyskania" value={formData.obtained_date}
                  onChange={(value) => setFormData((previous) => ({ ...previous, obtained_date: value }))} onValidityChange={setObtainedDateValid} />
                <SellerDatePicker label="Data ważności" value={formData.expiry_date}
                  onChange={(value) => setFormData((previous) => ({ ...previous, expiry_date: value }))} onValidityChange={setExpiryDateValid} />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer prawa jazdy</label>
                <input
                  type="text"
                  value={formData.license_number}
                  onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                  placeholder="np. ABC123456"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Dodatkowe informacje..."
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                  rows={3}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleAdd}
                className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Dodaj
              </button>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="flex-1 rounded-lg bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
