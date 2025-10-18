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

export default function VehicleAttributesPanel({ vehicleId, canEdit }: VehicleAttributesPanelProps) {
  const [attributes, setAttributes] = useState<VehicleAttribute[]>([]);
  const [availableTypes, setAvailableTypes] = useState<AttributeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, [vehicleId]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([
      fetchAttributes(),
      fetchAvailableTypes(),
    ]);
    setLoading(false);
  };

  const fetchAttributes = async () => {
    const { data, error } = await supabase
      .from('vehicle_attributes')
      .select(`
        *,
        attribute_type:vehicle_attribute_types(*)
      `)
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
    const { error } = await supabase
      .from('vehicle_attributes')
      .insert([{
        vehicle_id: vehicleId,
        ...formData,
      }]);

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

    const { error } = await supabase
      .from('vehicle_attributes')
      .delete()
      .eq('id', id);

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
    return (
      <div className="p-6 text-center text-[#e5e4e2]/60">
        Ładowanie...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">Właściwości pojazdu</h3>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Dodaj właściwość
          </button>
        )}
      </div>

      <div className="grid gap-3">
        {attributes.length === 0 ? (
          <div className="text-center py-8 text-[#e5e4e2]/40 bg-[#252842] border border-[#d3bb73]/10 rounded-lg">
            Brak właściwości. Dodaj właściwości aby określić cechy pojazdu.
          </div>
        ) : (
          attributes.map((attr) => (
            <div
              key={attr.id}
              className="bg-[#252842] border border-[#d3bb73]/10 rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium text-[#e5e4e2]">
                      {attr.attribute_type.name}
                    </h4>
                    {attr.attribute_type.category && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${getCategoryColor(attr.attribute_type.category)}`}>
                        {getCategoryLabel(attr.attribute_type.category)}
                      </span>
                    )}
                    {attr.attribute_type.category === 'license_requirement' && (
                      <span className="flex items-center gap-1 text-xs text-orange-400">
                        <AlertCircle className="w-3 h-3" />
                        Wymaga certyfikatu
                      </span>
                    )}
                  </div>

                  <div className="text-sm space-y-1">
                    <p className="text-[#d3bb73] font-medium">
                      {formatValue(attr)}
                    </p>
                    {attr.attribute_type.description && (
                      <p className="text-[#e5e4e2]/60">
                        {attr.attribute_type.description}
                      </p>
                    )}
                    {attr.notes && (
                      <p className="text-[#e5e4e2]/40 italic mt-2">
                        {attr.notes}
                      </p>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <button
                    onClick={() => handleDeleteAttribute(attr.id)}
                    className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
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

  const selectedType = availableTypes.find(t => t.id === selectedTypeId);

  // Filtruj już dodane właściwości
  const availableTypesFiltered = availableTypes.filter(
    type => !existingAttributes.some(attr => attr.attribute_type.id === type.id)
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
            className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
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
              className="flex-1 px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
              placeholder="Wartość"
            />
            {selectedType.unit && (
              <span className="px-3 py-2 bg-[#252842]/50 border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]/60">
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
            className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
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
            className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
            placeholder="Wartość"
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-lg w-full">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Dodaj właściwość</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-1">Typ właściwości *</label>
            <select
              required
              value={selectedTypeId}
              onChange={(e) => {
                setSelectedTypeId(e.target.value);
                setValue('');
              }}
              className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
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
                <label className="block text-sm text-[#e5e4e2]/60 mb-1">Wartość *</label>
                {renderValueInput()}
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-1">Notatki</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-[#252842] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]"
                  placeholder="Dodatkowe informacje..."
                />
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#252842] text-[#e5e4e2] rounded-lg hover:bg-[#2a2f4a] transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!selectedType || !value}
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
