'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Shield, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
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
        .select(
          `
          id,
          license_category_id,
          is_required,
          notes,
          license_category:driving_license_categories(id, code, name, description, order_index)
        `,
        )
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
      const { error } = await supabase.from('vehicle_license_requirements').insert({
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
    (cat) => !requirements.some((req) => req.license_category_id === cat.id),
  );

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">Wymagane kategorie prawa jazdy</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
          >
            <Plus className="h-4 w-4" />
            Dodaj
          </button>
        )}
      </div>

      {requirements.length === 0 ? (
        <div className="py-8 text-center">
          <Shield className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-sm text-[#e5e4e2]/60">Brak wymagań dotyczących prawa jazdy</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requirements.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#d3bb73]/20 px-2 py-1 text-sm font-medium text-[#d3bb73]">
                    {req.license_category.code}
                  </span>
                  <span className="text-[#e5e4e2]">{req.license_category.name}</span>
                  {req.is_required && <Check className="h-4 w-4 text-green-400" />}
                </div>
                {req.notes && <p className="mt-1 text-xs text-[#e5e4e2]/60">{req.notes}</p>}
              </div>
              {canEdit && (
                <button
                  onClick={() => handleRemove(req.id)}
                  className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Dodaj wymaganie prawa jazdy</h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Kategoria prawa jazdy
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
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
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Notatki (opcjonalnie)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
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
                  setSelectedCategory('');
                  setIsRequired(true);
                  setNotes('');
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
