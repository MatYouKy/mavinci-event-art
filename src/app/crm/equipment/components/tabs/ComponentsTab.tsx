import { useState, useEffect } from 'react';
import { Plus, Trash2, Package, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface EquipmentItem {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  thumbnail_url: string | null;
  warehouse_categories?: {
    name: string;
  };
}

export function ComponentsTab({ equipment, isEditing, onAdd, onDelete }: any) {
  const [isAdding, setIsAdding] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<EquipmentItem[]>([]);
  const [filteredEquipment, setFilteredEquipment] = useState<EquipmentItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [componentType, setComponentType] = useState<'from_warehouse' | 'custom'>('from_warehouse');
  const [newComponent, setNewComponent] = useState({
    component_equipment_id: '',
    component_name: '',
    quantity: 1,
    description: ''
  });

  console.log('ComponentsTab render - equipment:', equipment);
  console.log('ComponentsTab render - equipment_components:', equipment?.equipment_components);

  useEffect(() => {
    if (isAdding || showEquipmentModal) {
      fetchAvailableEquipment();
    }
  }, [isAdding, showEquipmentModal]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredEquipment(availableEquipment);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredEquipment(
        availableEquipment.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.model?.toLowerCase().includes(query) ||
            item.brand?.toLowerCase().includes(query) ||
            item.warehouse_categories?.name.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, availableEquipment]);

  const fetchAvailableEquipment = async () => {
    const { data, error } = await supabase
      .from('equipment_items')
      .select('id, name, model, brand, thumbnail_url, warehouse_categories(name)')
      .is('deleted_at', null)
      .neq('id', equipment.id)
      .order('name');

    if (data) {
      setAvailableEquipment(data);
      setFilteredEquipment(data);
    }
  };

  const handleSelectEquipment = (equipmentId: string) => {
    const selected = availableEquipment.find((e) => e.id === equipmentId);
    if (selected) {
      setNewComponent((p) => ({
        ...p,
        component_equipment_id: equipmentId,
        component_name: `${selected.name}${selected.model ? ` ${selected.model}` : ''}`,
      }));
    }
    setShowEquipmentModal(false);
    setSearchQuery('');
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
              <button
                type="button"
                onClick={() => setShowEquipmentModal(true)}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] text-left hover:border-[#d3bb73]/30 flex items-center justify-between"
              >
                <span className={newComponent.component_name ? '' : 'text-[#e5e4e2]/50'}>
                  {newComponent.component_name || 'Wybierz sprzęt z magazynu'}
                </span>
                <Search className="w-4 h-4" />
              </button>
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

      {showEquipmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] rounded-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-[#d3bb73]/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-[#e5e4e2]">Wybierz sprzęt z magazynu</h3>
                <button
                  onClick={() => {
                    setShowEquipmentModal(false);
                    setSearchQuery('');
                  }}
                  className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg"
                >
                  <X className="w-5 h-5 text-[#e5e4e2]" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj po nazwie, modelu, marce lub kategorii..."
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {filteredEquipment.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredEquipment.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelectEquipment(item.id)}
                      className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 hover:border-[#d3bb73]/30 transition-colors text-left"
                    >
                      <div className="flex gap-4">
                        {item.thumbnail_url ? (
                          <img
                            src={item.thumbnail_url}
                            alt={item.name}
                            className="w-20 h-20 object-cover rounded-lg"
                          />
                        ) : (
                          <div className="w-20 h-20 bg-[#0f1119] rounded-lg flex items-center justify-center">
                            <Package className="w-8 h-8 text-[#e5e4e2]/20" />
                          </div>
                        )}
                        <div className="flex-1">
                          <h4 className="text-[#e5e4e2] font-medium">{item.name}</h4>
                          {item.model && (
                            <p className="text-sm text-[#e5e4e2]/60 mt-0.5">{item.model}</p>
                          )}
                          {item.brand && (
                            <p className="text-xs text-[#e5e4e2]/40 mt-1">{item.brand}</p>
                          )}
                          {item.warehouse_categories && (
                            <span className="inline-block mt-2 text-xs px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                              {item.warehouse_categories.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}