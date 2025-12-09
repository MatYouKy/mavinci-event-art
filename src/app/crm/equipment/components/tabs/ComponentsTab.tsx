import { useState, useEffect } from 'react';
import { Plus, Trash2, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface EquipmentItem {
  id: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
}

export function ComponentsTab({ equipment, isEditing, onAdd, onDelete }: any) {
  const [isAdding, setIsAdding] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<EquipmentItem[]>([]);
  const [componentType, setComponentType] = useState<'from_warehouse' | 'custom'>('from_warehouse');
  const [newComponent, setNewComponent] = useState({
    component_equipment_id: '',
    component_name: '',
    quantity: 1,
    description: ''
  });

  useEffect(() => {
    if (isAdding) {
      fetchAvailableEquipment();
    }
  }, [isAdding]);

  const fetchAvailableEquipment = async () => {
    const { data, error } = await supabase
      .from('equipment_items')
      .select('id, name, model, manufacturer')
      .order('name');

    if (data) {
      setAvailableEquipment(data);
    }
  };

  const handleAdd = async () => {
    if (componentType === 'from_warehouse' && !newComponent.component_equipment_id) {
      return;
    }
    if (componentType === 'custom' && !newComponent.component_name.trim()) {
      return;
    }

    const selectedEquipment = availableEquipment.find(e => e.id === newComponent.component_equipment_id);

    await onAdd({
      equipment_id: equipment.id,
      component_equipment_id: componentType === 'from_warehouse' ? newComponent.component_equipment_id : null,
      component_name: componentType === 'from_warehouse'
        ? (selectedEquipment ? `${selectedEquipment.name}${selectedEquipment.model ? ` ${selectedEquipment.model}` : ''}` : '')
        : newComponent.component_name,
      quantity: newComponent.quantity,
      description: newComponent.description || null,
      is_included: true,
    });
    setNewComponent({ component_equipment_id: '', component_name: '', quantity: 1, description: '' });
    setComponentType('from_warehouse');
    setIsAdding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Skład zestawu</h3>
        {isEditing && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
          >
            <Plus className="w-4 h-4" />
            Dodaj komponent
          </button>
        )}
      </div>

      {isAdding && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 space-y-4">
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={componentType === 'from_warehouse'}
                onChange={() => setComponentType('from_warehouse')}
                className="w-4 h-4 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-[#e5e4e2]">Z magazynu</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={componentType === 'custom'}
                onChange={() => setComponentType('custom')}
                className="w-4 h-4 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-[#e5e4e2]">Własna nazwa</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {componentType === 'from_warehouse' ? (
              <select
                value={newComponent.component_equipment_id}
                onChange={(e) => setNewComponent((p) => ({ ...p, component_equipment_id: e.target.value }))}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="">Wybierz sprzęt z magazynu</option>
                {availableEquipment.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.model ? ` ${item.model}` : ''}{item.manufacturer ? ` (${item.manufacturer})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newComponent.component_name}
                onChange={(e) => setNewComponent((p) => ({ ...p, component_name: e.target.value }))}
                placeholder="Nazwa komponentu"
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            )}
            <input
              type="number"
              min={1}
              value={newComponent.quantity}
              onChange={(e) => setNewComponent((p) => ({ ...p, quantity: parseInt(e.target.value) || 1 }))}
              placeholder="Ilość"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
            <input
              type="text"
              value={newComponent.description}
              onChange={(e) => setNewComponent((p) => ({ ...p, description: e.target.value }))}
              placeholder="Opis (opcjonalnie)"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setComponentType('from_warehouse');
                setNewComponent({ component_equipment_id: '', component_name: '', quantity: 1, description: '' });
              }}
              className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20"
            >
              Anuluj
            </button>
            <button onClick={handleAdd} className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90">
              Zapisz
            </button>
          </div>
        </div>
      )}

      {equipment.equipment_components?.length ? (
        <div className="space-y-3">
          {equipment.equipment_components.map((c: any) => (
            <div key={c.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-[#e5e4e2] font-medium">{c.component_name}</div>
                  {c.component_equipment_id && (
                    <span className="text-xs px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                      Z magazynu
                    </span>
                  )}
                </div>
                {c.description && <div className="text-sm text-[#e5e4e2]/60 mt-1">{c.description}</div>}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[#d3bb73] font-medium">x{c.quantity}</div>
                {isEditing && (
                  <button onClick={() => onDelete(c.id)} className="p-2 text-red-400 hover:text-red-300">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak komponentów w zestawie</p>
        </div>
      )}
    </div>
  );
}