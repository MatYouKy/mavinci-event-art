import { useState } from 'react';
import { Plus, Trash2, Package } from 'lucide-react';

export function ComponentsTab({ equipment, isEditing, onAdd, onDelete }: any) {
  const [isAdding, setIsAdding] = useState(false);
  const [newComponent, setNewComponent] = useState({ component_name: '', quantity: 1, description: '' });

  const handleAdd = async () => {
    if (!newComponent.component_name.trim()) return;
    await onAdd({
      equipment_id: equipment.id,
      component_name: newComponent.component_name,
      quantity: newComponent.quantity,
      description: newComponent.description || null,
      is_included: true,
    });
    setNewComponent({ component_name: '', quantity: 1, description: '' });
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
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <input
              type="text"
              value={newComponent.component_name}
              onChange={(e) => setNewComponent((p) => ({ ...p, component_name: e.target.value }))}
              placeholder="Nazwa komponentu"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
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
            <button onClick={() => setIsAdding(false)} className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg">
              Anuluj
            </button>
            <button onClick={handleAdd} className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg">
              Zapisz
            </button>
          </div>
        </div>
      )}

      {equipment.equipment_components?.length ? (
        <div className="space-y-3">
          {equipment.equipment_components.map((c: any) => (
            <div key={c.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="text-[#e5e4e2] font-medium">{c.component_name}</div>
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