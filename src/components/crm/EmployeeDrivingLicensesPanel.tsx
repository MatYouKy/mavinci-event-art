'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, Edit, Save, X, AlertCircle, CheckCircle, Calendar } from 'lucide-react';
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
        .select(`
          id,
          license_category_id,
          obtained_date,
          expiry_date,
          license_number,
          notes,
          license_category:driving_license_categories(id, code, name, description, order_index)
        `)
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
      const { error } = await supabase
        .from('employee_driving_licenses')
        .insert({
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
      (new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
  };

  const availableCategoriesForAdd = availableCategories.filter(
    (cat) => !licenses.some((lic) => lic.license_category_id === cat.id)
  );

  if (loading) {
    return <div className="text-[#e5e4e2]/60 text-center py-8">Ładowanie...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#d3bb73]" />
          <h3 className="text-lg font-medium text-[#e5e4e2]">Prawa jazdy</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73]/10 hover:bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj prawo jazdy
          </button>
        )}
      </div>

      {licenses.length === 0 ? (
        <div className="text-center py-8">
          <Shield className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
          <p className="text-[#e5e4e2]/60 text-sm">Brak praw jazdy</p>
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
                className={`p-4 rounded-lg border transition-colors ${
                  expired
                    ? 'bg-red-500/5 border-red-500/30'
                    : expiringSoon
                    ? 'bg-orange-500/5 border-orange-500/30'
                    : 'bg-[#0f1119] border-[#d3bb73]/10'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[#e5e4e2]/60 mb-1">
                          Data uzyskania
                        </label>
                        <input
                          type="date"
                          value={formData.obtained_date}
                          onChange={(e) =>
                            setFormData({ ...formData, obtained_date: e.target.value })
                          }
                          className="w-full px-2 py-1.5 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/40"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#e5e4e2]/60 mb-1">
                          Data ważności
                        </label>
                        <input
                          type="date"
                          value={formData.expiry_date}
                          onChange={(e) =>
                            setFormData({ ...formData, expiry_date: e.target.value })
                          }
                          className="w-full px-2 py-1.5 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/40"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[#e5e4e2]/60 mb-1">
                        Numer prawa jazdy
                      </label>
                      <input
                        type="text"
                        value={formData.license_number}
                        onChange={(e) =>
                          setFormData({ ...formData, license_number: e.target.value })
                        }
                        className="w-full px-2 py-1.5 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/40"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#e5e4e2]/60 mb-1">Notatki</label>
                      <textarea
                        value={formData.notes}
                        onChange={(e) =>
                          setFormData({ ...formData, notes: e.target.value })
                        }
                        className="w-full px-2 py-1.5 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/40 resize-none"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdate(license.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#1c1f33] rounded text-sm transition-colors"
                      >
                        <Save className="w-3 h-3" />
                        Zapisz
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#0f1119] hover:bg-[#0f1119]/80 text-[#e5e4e2] rounded text-sm transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg text-sm font-bold">
                          {license.license_category.code}
                        </span>
                        <span className="text-[#e5e4e2] font-medium">
                          {license.license_category.name}
                        </span>
                        {expired && (
                          <span className="flex items-center gap-1 text-xs text-red-400">
                            <AlertCircle className="w-3 h-3" />
                            Wygasło
                          </span>
                        )}
                        {!expired && expiringSoon && (
                          <span className="flex items-center gap-1 text-xs text-orange-400">
                            <AlertCircle className="w-3 h-3" />
                            Wygasa wkrótce
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {license.obtained_date && (
                          <div>
                            <span className="text-[#e5e4e2]/60">Uzyskano:</span>
                            <span className="text-[#e5e4e2] ml-2">
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
                        <div className="text-sm mt-2">
                          <span className="text-[#e5e4e2]/60">Numer:</span>
                          <span className="text-[#e5e4e2] ml-2">{license.license_number}</span>
                        </div>
                      )}
                      {license.notes && (
                        <p className="text-xs text-[#e5e4e2]/60 mt-2">{license.notes}</p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(license)}
                          className="p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(license.id)}
                          className="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#d3bb73]" />
              Dodaj prawo jazdy
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Kategoria prawa jazdy *
                </label>
                <select
                  value={formData.license_category_id}
                  onChange={(e) =>
                    setFormData({ ...formData, license_category_id: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40"
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
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Data uzyskania
                  </label>
                  <input
                    type="date"
                    value={formData.obtained_date}
                    onChange={(e) =>
                      setFormData({ ...formData, obtained_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Data ważności
                  </label>
                  <input
                    type="date"
                    value={formData.expiry_date}
                    onChange={(e) =>
                      setFormData({ ...formData, expiry_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Numer prawa jazdy
                </label>
                <input
                  type="text"
                  value={formData.license_number}
                  onChange={(e) =>
                    setFormData({ ...formData, license_number: e.target.value })
                  }
                  placeholder="np. ABC123456"
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Dodatkowe informacje..."
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40 resize-none"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAdd}
                className="flex-1 px-4 py-2 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#1c1f33] rounded-lg font-medium transition-colors"
              >
                Dodaj
              </button>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="flex-1 px-4 py-2 bg-[#0f1119] hover:bg-[#0f1119]/80 text-[#e5e4e2] rounded-lg transition-colors"
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
