'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Settings, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface VehicleAttribute {
  id: string;
  value: string;
  notes: string | null;
  attribute_type: {
    id: string;
    name: string;
    description: string | null;
    data_type: 'boolean' | 'number' | 'text' | 'select';
    unit: string | null;
    options: string[] | null;
    category: string | null;
  };
}

interface AttributeType {
  id: string;
  name: string;
  description: string | null;
  data_type: 'boolean' | 'number' | 'text' | 'select';
  unit: string | null;
  options: string[] | null;
  category: string | null;
}

interface VehicleAttributesPanelProps {
  vehicleId: string;
  canEdit: boolean;
}

export default function VehicleAttributesPanel({
  vehicleId,
  canEdit,
}: VehicleAttributesPanelProps) {
  const [attributes, setAttributes] = useState<VehicleAttribute[]>([]);
  const [availableTypes, setAvailableTypes] = useState<AttributeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, [vehicleId]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchAttributes(), fetchAvailableTypes()]);
    setLoading(false);
  };

  const fetchAttributes = async () => {
    const { data, error } = await supabase
      .from('vehicle_attributes')
      .select(
        `
        *,
        attribute_type:vehicle_attribute_types(*)
      `,
      )
      .eq('vehicle_id', vehicleId);

    if (error) {
      console.error('Error fetching attributes:', error);
      return;
    }

    setAttributes(data || []);
  };

  const fetchAvailableTypes = async () => {
    const { data, error } = await supabase
      .from('vehicle_attribute_types')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (!error) {
      setAvailableTypes(data || []);
    }
  };

  const handleAddAttribute = async (formData: any) => {
    const { error } = await supabase.from('vehicle_attributes').insert([
      {
        vehicle_id: vehicleId,
        ...formData,
      },
    ]);

    if (error) {
      console.error('Error adding attribute:', error);
      alert('Błąd podczas dodawania właściwości');
      return;
    }

    fetchAttributes();
    setShowAddModal(false);
  };

  const handleDeleteAttribute = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę właściwość?')) return;

    const { error } = await supabase.from('vehicle_attributes').delete().eq('id', id);

    if (error) {
      console.error('Error deleting attribute:', error);
      alert('Błąd podczas usuwania właściwości');
      return;
    }

    fetchAttributes();
  };

  const formatValue = (attr: VehicleAttribute) => {
    const { data_type, unit, options } = attr.attribute_type;
    const { value } = attr;

    switch (data_type) {
      case 'boolean':
        return value === 'true' ? 'Tak' : 'Nie';
      case 'number':
        return `${value}${unit ? ` ${unit}` : ''}`;
      case 'select':
        return value;
      case 'text':
      default:
        return value;
    }
  };

  const getCategoryColor = (category: string | null) => {
    const colors: Record<string, string> = {
      equipment: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      capacity: 'bg-green-500/20 text-green-400 border-green-500/30',
      license_requirement: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      technical: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    };
    return colors[category || ''] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  const getCategoryLabel = (category: string | null) => {
    const labels: Record<string, string> = {
      equipment: 'Wyposażenie',
      capacity: 'Pojemność',
      license_requirement: 'Wymagania prawne',
      technical: 'Parametry techniczne',
    };
    return labels[category || ''] || category;
  };

  if (loading) {
    return <div className="p-6 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">Właściwości pojazdu</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj właściwość
          </button>
        )}
      </div>

      <div className="grid gap-3">
        {attributes.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#252842] py-8 text-center text-[#e5e4e2]/40">
            Brak właściwości. Dodaj właściwości aby określić cechy pojazdu.
          </div>
        ) : (
          attributes.map((attr) => (
            <div key={attr.id} className="rounded-lg border border-[#d3bb73]/10 bg-[#252842] p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <h4 className="font-medium text-[#e5e4e2]">{attr.attribute_type.name}</h4>
                    {attr.attribute_type.category && (
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${getCategoryColor(attr.attribute_type.category)}`}
                      >
                        {getCategoryLabel(attr.attribute_type.category)}
                      </span>
                    )}
                    {attr.attribute_type.category === 'license_requirement' && (
                      <span className="flex items-center gap-1 text-xs text-orange-400">
                        <AlertCircle className="h-3 w-3" />
                        Wymaga certyfikatu
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-[#d3bb73]">{formatValue(attr)}</p>
                    {attr.attribute_type.description && (
                      <p className="text-[#e5e4e2]/60">{attr.attribute_type.description}</p>
                    )}
                    {attr.notes && <p className="mt-2 italic text-[#e5e4e2]/40">{attr.notes}</p>}
                  </div>
                </div>

                {canEdit && (
                  <button
                    onClick={() => handleDeleteAttribute(attr.id)}
                    className="rounded-lg p-2 text-red-400 transition-colors hover:bg-[#1c1f33]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <AddAttributeModal
          availableTypes={availableTypes}
          existingAttributes={attributes}
          onSave={handleAddAttribute}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function AddAttributeModal({
  availableTypes,
  existingAttributes,
  onSave,
  onClose,
}: {
  availableTypes: AttributeType[];
  existingAttributes: VehicleAttribute[];
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');

  const selectedType = availableTypes.find((t) => t.id === selectedTypeId);

  // Filtruj już dodane właściwości
  const availableTypesFiltered = availableTypes.filter(
    (type) => !existingAttributes.some((attr) => attr.attribute_type.id === type.id),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      attribute_type_id: selectedTypeId,
      value: value,
      notes: notes || null,
    });
  };

  const renderValueInput = () => {
    if (!selectedType) return null;

    switch (selectedType.data_type) {
      case 'boolean':
        return (
          <select
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
          >
            <option value="">Wybierz...</option>
            <option value="true">Tak</option>
            <option value="false">Nie</option>
          </select>
        );

      case 'number':
        return (
          <div className="flex gap-2">
            <input
              type="number"
              step="any"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
              placeholder="Wartość"
            />
            {selectedType.unit && (
              <span className="rounded-lg border border-[#d3bb73]/10 bg-[#252842]/50 px-3 py-2 text-[#e5e4e2]/60">
                {selectedType.unit}
              </span>
            )}
          </div>
        );

      case 'select':
        return (
          <select
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
          >
            <option value="">Wybierz...</option>
            {selectedType.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'text':
      default:
        return (
          <input
            type="text"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
            placeholder="Wartość"
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-xl font-light text-[#e5e4e2]">Dodaj właściwość</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/60">Typ właściwości *</label>
            <select
              required
              value={selectedTypeId}
              onChange={(e) => {
                setSelectedTypeId(e.target.value);
                setValue('');
              }}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
            >
              <option value="">Wybierz...</option>
              {availableTypesFiltered.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} {type.description && `- ${type.description}`}
                </option>
              ))}
            </select>
          </div>

          {selectedType && (
            <>
              <div>
                <label className="mb-1 block text-sm text-[#e5e4e2]/60">Wartość *</label>
                {renderValueInput()}
              </div>

              <div>
                <label className="mb-1 block text-sm text-[#e5e4e2]/60">Notatki</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#252842] px-3 py-2 text-[#e5e4e2]"
                  placeholder="Dodatkowe informacje..."
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#252842] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#2a2f4a]"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!selectedType || !value}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
