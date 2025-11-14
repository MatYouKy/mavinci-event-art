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
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

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
}

export default function EmployeeDrivingLicensesPanel({
  employeeId,
  canEdit,
}: EmployeeDrivingLicensesPanelProps) {
  const [licenses, setLicenses] = useState<DrivingLicense[]>([]);
  const [availableCategories, setAvailableCategories] = useState<LicenseCategory[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLicense, setEditingLicense] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { showSnackbar } = useSnackbar();

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

      const sorted = (data || []).sort((a, b) => {
        return (a.license_category.order_index || 0) - (b.license_category.order_index || 0);
      });

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

  const handleAdd = async () => {
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
    setFormData({
      license_category_id: '',
      obtained_date: '',
      expiry_date: '',
      license_number: '',
      notes: '',
    });
  };

  const isExpired = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    return new Date(expiryDate) < new Date();
  };

  const isExpiringSoon = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    const daysUntilExpiry = Math.floor(
      (new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
  };

  const availableCategoriesForAdd = availableCategories.filter(
    (cat) => !licenses.some((lic) => lic.license_category_id === cat.id),
  );

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
                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">
                          Data uzyskania
                        </label>
                        <input
                          type="date"
                          value={formData.obtained_date}
                          onChange={(e) =>
                            setFormData({ ...formData, obtained_date: e.target.value })
                          }
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">
                          Data ważności
                        </label>
                        <input
                          type="date"
                          value={formData.expiry_date}
                          onChange={(e) =>
                            setFormData({ ...formData, expiry_date: e.target.value })
                          }
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                        />
                      </div>
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
                <select
                  value={formData.license_category_id}
                  onChange={(e) =>
                    setFormData({ ...formData, license_category_id: e.target.value })
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                >
                  <option value="">Wybierz kategorię</option>
                  {availableCategoriesForAdd.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.code} - {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data uzyskania</label>
                  <input
                    type="date"
                    value={formData.obtained_date}
                    onChange={(e) => setFormData({ ...formData, obtained_date: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data ważności</label>
                  <input
                    type="date"
                    value={formData.expiry_date}
                    onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                  />
                </div>
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
