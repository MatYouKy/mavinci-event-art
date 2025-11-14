import { useState } from 'react';
import { Plus, Trash2, Package } from 'lucide-react';

export function ComponentsTab({ equipment, isEditing, onAdd, onDelete }: any) {
  const [isAdding, setIsAdding] = useState(false);
  const [newComponent, setNewComponent] = useState({
    component_name: '',
    quantity: 1,
    description: '',
  });

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
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj komponent
          </button>
        )}
      </div>

      {isAdding && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <input
              type="text"
              value={newComponent.component_name}
              onChange={(e) => setNewComponent((p) => ({ ...p, component_name: e.target.value }))}
              placeholder="Nazwa komponentu"
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
            <input
              type="number"
              min={1}
              value={newComponent.quantity}
              onChange={(e) =>
                setNewComponent((p) => ({ ...p, quantity: parseInt(e.target.value) || 1 }))
              }
              placeholder="Ilość"
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
            <input
              type="text"
              value={newComponent.description}
              onChange={(e) => setNewComponent((p) => ({ ...p, description: e.target.value }))}
              placeholder="Opis (opcjonalnie)"
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2]"
            >
              Anuluj
            </button>
            <button
              onClick={handleAdd}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33]"
            >
              Zapisz
            </button>
          </div>
        </div>
      )}

      {equipment.equipment_components?.length ? (
        <div className="space-y-3">
          {equipment.equipment_components.map((c: any) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
            >
              <div>
                <div className="font-medium text-[#e5e4e2]">{c.component_name}</div>
                {c.description && (
                  <div className="mt-1 text-sm text-[#e5e4e2]/60">{c.description}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="font-medium text-[#d3bb73]">x{c.quantity}</div>
                {isEditing && (
                  <button
                    onClick={() => onDelete(c.id)}
                    className="p-2 text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] py-12 text-center">
          <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak komponentów w zestawie</p>
        </div>
      )}
    </div>
  );
}
