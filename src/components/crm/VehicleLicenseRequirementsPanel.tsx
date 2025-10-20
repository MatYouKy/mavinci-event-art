'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Shield, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface LicenseCategory {
  id: string;
  code: string;
  name: string;
  description: string;
  order_index?: number;
}

interface VehicleLicenseRequirement {
  id: string;
  license_category_id: string;
  is_required: boolean;
  notes: string;
  license_category: LicenseCategory;
}

interface VehicleLicenseRequirementsPanelProps {
  vehicleId: string;
  canEdit: boolean;
}

export default function VehicleLicenseRequirementsPanel({
  vehicleId,
  canEdit,
}: VehicleLicenseRequirementsPanelProps) {
  const [requirements, setRequirements] = useState<VehicleLicenseRequirement[]>([]);
  const [allCategories, setAllCategories] = useState<LicenseCategory[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isRequired, setIsRequired] = useState(true);
  const [notes, setNotes] = useState('');
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    fetchRequirements();
    fetchCategories();
  }, [vehicleId]);

  const fetchRequirements = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_license_requirements')
        .select(`
          id,
          license_category_id,
          is_required,
          notes,
          license_category:driving_license_categories(id, code, name, description, order_index)
        `)
        .eq('vehicle_id', vehicleId);

      if (error) throw error;

      const sorted = (data || []).sort((a, b) => {
        return (a.license_category.order_index || 0) - (b.license_category.order_index || 0);
      });

      setRequirements(sorted);
    } catch (error) {
      console.error('Error fetching requirements:', error);
      showSnackbar('Błąd podczas pobierania wymagań', 'error');
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
      setAllCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const handleAdd = async () => {
    if (!selectedCategory) {
      showSnackbar('Wybierz kategorię prawa jazdy', 'warning');
      return;
    }

    try {
      const { error } = await supabase
        .from('vehicle_license_requirements')
        .insert({
          vehicle_id: vehicleId,
          license_category_id: selectedCategory,
          is_required: isRequired,
          notes: notes || null,
        });

      if (error) throw error;

      showSnackbar('Wymaganie dodane pomyślnie', 'success');
      setShowAddModal(false);
      setSelectedCategory('');
      setIsRequired(true);
      setNotes('');
      fetchRequirements();
    } catch (error: any) {
      console.error('Error adding requirement:', error);
      if (error.code === '23505') {
        showSnackbar('Ta kategoria jest już dodana', 'warning');
      } else {
        showSnackbar('Błąd podczas dodawania wymagania', 'error');
      }
    }
  };

  const handleRemove = async (requirementId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to wymaganie?')) return;

    try {
      const { error } = await supabase
        .from('vehicle_license_requirements')
        .delete()
        .eq('id', requirementId);

      if (error) throw error;

      showSnackbar('Wymaganie usunięte pomyślnie', 'success');
      fetchRequirements();
    } catch (error) {
      console.error('Error removing requirement:', error);
      showSnackbar('Błąd podczas usuwania wymagania', 'error');
    }
  };

  const availableCategories = allCategories.filter(
    (cat) => !requirements.some((req) => req.license_category_id === cat.id)
  );

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">
            Wymagane kategorie prawa jazdy
          </h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73]/10 hover:bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj
          </button>
        )}
      </div>

      {requirements.length === 0 ? (
        <div className="text-center py-8">
          <Shield className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
          <p className="text-[#e5e4e2]/60 text-sm">
            Brak wymagań dotyczących prawa jazdy
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {requirements.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between p-3 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-sm font-medium">
                    {req.license_category.code}
                  </span>
                  <span className="text-[#e5e4e2]">
                    {req.license_category.name}
                  </span>
                  {req.is_required && (
                    <Check className="w-4 h-4 text-green-400" />
                  )}
                </div>
                {req.notes && (
                  <p className="text-xs text-[#e5e4e2]/60 mt-1">{req.notes}</p>
                )}
              </div>
              {canEdit && (
                <button
                  onClick={() => handleRemove(req.id)}
                  className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
              Dodaj wymaganie prawa jazdy
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Kategoria prawa jazdy
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/40"
                >
                  <option value="">Wybierz kategorię</option>
                  {availableCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.code} - {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_required"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  className="rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/40"
                />
                <label htmlFor="is_required" className="text-sm text-[#e5e4e2]">
                  Wymagane
                </label>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Notatki (opcjonalnie)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
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
                  setSelectedCategory('');
                  setIsRequired(true);
                  setNotes('');
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
